use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

const SHEETS_API: &str = "https://sheets.googleapis.com/v4/spreadsheets";

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct CreatedSpreadsheet {
    spreadsheet_id: String,
    spreadsheet_url: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ScheduleEntry {
    date: String,
    hours: f64,
    note: String,
}

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct TokenResponse {
    access_token: String,
    expires_in: u64,
    id_token: Option<String>,
}

fn google_error(status: reqwest::StatusCode, body: String) -> String {
    let detail = serde_json::from_str::<Value>(&body)
        .ok()
        .and_then(|value| value.get("error")?.get("message")?.as_str().map(str::to_owned))
        .unwrap_or(body);
    format!("Google Sheets API error ({}): {}", status, detail)
}

async fn google_json(
    request: reqwest::RequestBuilder,
) -> Result<Value, String> {
    let response = request.send().await.map_err(|error| error.to_string())?;
    let status = response.status();
    let body = response.text().await.map_err(|error| error.to_string())?;
    if !status.is_success() {
        return Err(google_error(status, body));
    }
    serde_json::from_str(&body).map_err(|error| error.to_string())
}

#[tauri::command]
async fn exchange_google_code(
    code: String,
    code_verifier: String,
    client_id: String,
    redirect_uri: String,
) -> Result<TokenResponse, String> {
    let response = reqwest::Client::new()
        .post("https://oauth2.googleapis.com/token")
        .form(&[
            ("code", code),
            ("code_verifier", code_verifier),
            ("client_id", client_id),
            ("redirect_uri", redirect_uri),
            ("grant_type", "authorization_code".to_string()),
        ])
        .send()
        .await
        .map_err(|error| error.to_string())?;
    let status = response.status();
    let body = response.text().await.map_err(|error| error.to_string())?;
    if !status.is_success() {
        return Err(google_error(status, body));
    }
    serde_json::from_str(&body).map_err(|error| error.to_string())
}

#[tauri::command]
async fn create_timemark_sheet(access_token: String) -> Result<CreatedSpreadsheet, String> {
    let client = reqwest::Client::new();
    let created = google_json(
        client
            .post(SHEETS_API)
            .bearer_auth(&access_token)
            .json(&json!({
                "properties": { "title": "TimeMark" },
                "sheets": [
                    { "properties": { "title": "TimeMarkData" } },
                    { "properties": { "title": "TimeMarkSchedule" } }
                ]
            })),
    )
    .await?;
    let spreadsheet_id = created
        .get("spreadsheetId")
        .and_then(Value::as_str)
        .ok_or("Google Sheets API response did not include spreadsheetId")?
        .to_owned();
    let spreadsheet_url = created
        .get("spreadsheetUrl")
        .and_then(Value::as_str)
        .ok_or("Google Sheets API response did not include spreadsheetUrl")?
        .to_owned();

    google_json(
        client
            .post(format!("{}/{}/values:batchUpdate", SHEETS_API, spreadsheet_id))
            .bearer_auth(access_token)
            .json(&json!({
                "valueInputOption": "RAW",
                "data": [
                    { "range": "TimeMarkData!A1:B1", "values": [["key", "value"]] },
                    { "range": "TimeMarkSchedule!A1:C1", "values": [["date", "hours", "note"]] }
                ]
            })),
    )
    .await?;

    Ok(CreatedSpreadsheet { spreadsheet_id, spreadsheet_url })
}

#[tauri::command]
async fn save_timemark_backup(
    access_token: String,
    spreadsheet_id: String,
    backup_json: String,
) -> Result<(), String> {
    let request = reqwest::Client::new()
        .put(format!("{}/{}/values/TimeMarkData!A2:B2", SHEETS_API, spreadsheet_id))
        .bearer_auth(access_token)
        .query(&[("valueInputOption", "RAW")])
        .json(&json!({ "values": [["timemarkBackup", backup_json]] }));
    google_json(request).await?;
    Ok(())
}

#[tauri::command]
async fn load_timemark_backup(
    access_token: String,
    spreadsheet_id: String,
) -> Result<Option<String>, String> {
    let values = google_json(
        reqwest::Client::new()
            .get(format!("{}/{}/values/TimeMarkData!A2:B100", SHEETS_API, spreadsheet_id))
            .bearer_auth(access_token),
    )
    .await?;
    let backup = values
        .get("values")
        .and_then(Value::as_array)
        .and_then(|rows| {
            rows.iter().find_map(|row| {
                let cells = row.as_array()?;
                (cells.first()?.as_str()? == "timemarkBackup")
                    .then(|| cells.get(1)?.as_str().map(str::to_owned))
                    .flatten()
            })
        });
    Ok(backup)
}

#[tauri::command]
async fn load_timemark_schedule(
    access_token: String,
    spreadsheet_id: String,
) -> Result<Vec<ScheduleEntry>, String> {
    let values = google_json(
        reqwest::Client::new()
            .get(format!("{}/{}/values/TimeMarkSchedule!A1:C1000", SHEETS_API, spreadsheet_id))
            .bearer_auth(access_token),
    )
    .await?;
    let rows = values.get("values").and_then(Value::as_array).cloned().unwrap_or_default();
    let entries = rows
        .into_iter()
        .skip(1)
        .filter_map(|row| {
            let cells = row.as_array()?;
            let date = cells.first()?.as_str()?.trim().to_owned();
            let hours = cells.get(1)?.as_str()?.trim().parse::<f64>().ok()?;
            let note = cells.get(2).and_then(Value::as_str).unwrap_or_default().to_owned();
            (!date.is_empty()).then_some(ScheduleEntry { date, hours, note })
        })
        .collect();
    Ok(entries)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_auth_session::init())
        .invoke_handler(tauri::generate_handler![
            exchange_google_code,
            create_timemark_sheet,
            save_timemark_backup,
            load_timemark_backup,
            load_timemark_schedule
        ])
        .run(tauri::generate_context!())
        .expect("TimeMark を起動できませんでした");
}
