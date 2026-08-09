use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

#[cfg(target_os = "ios")]
use objc2::MainThreadMarker;
#[cfg(target_os = "ios")]
use objc2::runtime::AnyObject;
#[cfg(target_os = "ios")]
use objc2_foundation::{NSDictionary, NSString, NSURL};
#[cfg(target_os = "ios")]
use objc2_ui_kit::{UIApplication, UIApplicationOpenExternalURLOptionsKey};

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

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct SchoolEvent {
    date: String,
    grade: String,
    category: String,
    title: String,
    source: String,
}

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct TokenResponse {
    #[serde(rename(serialize = "accessToken", deserialize = "access_token"))]
    access_token: String,
    #[serde(rename(serialize = "expiresIn", deserialize = "expires_in"))]
    expires_in: u64,
    #[serde(rename(serialize = "idToken", deserialize = "id_token"))]
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
                    { "properties": { "title": "TimeMarkSchedule" } },
                    { "properties": { "title": "SchoolEvents" } },
                    { "properties": { "title": "SchoolEventsExample" } }
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
                    { "range": "TimeMarkSchedule!A1:C1", "values": [["date", "hours", "note"]] },
                    { "range": "SchoolEvents!A1:E1", "values": [["date", "grade", "category", "title", "source"]] },
                    { "range": "SchoolEventsExample!A1:E4", "values": [
                        ["date", "grade", "category", "title", "source"],
                        ["2026/04/09", "m1", "term", "始業式", "記載例"],
                        ["2026/04/25", "m1", "vacation", "土曜休日", "記載例"],
                        ["2026/06/05", "m1", "exam", "定期試験", "記載例"]
                    ] }
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

fn normalize_sheet_date(value: &str) -> Option<String> {
    let normalized = value.trim().replace('/', "-").replace('.', "-");
    let mut parts = normalized.split('-');
    let year = parts.next()?.parse::<u32>().ok()?;
    let month = parts.next()?.parse::<u32>().ok()?;
    let day = parts.next()?.parse::<u32>().ok()?;
    if !(1..=12).contains(&month) || !(1..=31).contains(&day) {
        return None;
    }
    Some(format!("{year:04}-{month:02}-{day:02}"))
}

#[tauri::command]
async fn load_school_events(
    access_token: String,
    spreadsheet_id: String,
) -> Result<Vec<SchoolEvent>, String> {
    let values = match google_json(
        reqwest::Client::new()
            .get(format!("{}/{}/values/SchoolEvents!A1:E1000", SHEETS_API, spreadsheet_id))
            .bearer_auth(access_token),
    )
    .await {
        Ok(values) => values,
        // An older TimeMark sheet can legitimately omit this optional tab.
        Err(error) if error.contains("Unable to parse range") => return Ok(Vec::new()),
        Err(error) => return Err(error),
    };
    let rows = values.get("values").and_then(Value::as_array).cloned().unwrap_or_default();
    let entries = rows
        .into_iter()
        .skip(1)
        .filter_map(|row| {
            let cells = row.as_array()?;
            let date = normalize_sheet_date(cells.first()?.as_str()?);
            let grade = cells.get(1).and_then(Value::as_str).unwrap_or_default().trim().to_owned();
            let category = cells.get(2).and_then(Value::as_str).unwrap_or_default().trim().to_owned();
            let title = cells.get(3).and_then(Value::as_str).unwrap_or_default().trim().to_owned();
            let source = cells.get(4).and_then(Value::as_str).unwrap_or_default().trim().to_owned();
            let date = date?;
            (!title.is_empty()).then_some(SchoolEvent { date, grade, category, title, source })
        })
        .collect();
    Ok(entries)
}

#[tauri::command]
fn open_timemark_sheet(_window: tauri::WebviewWindow, spreadsheet_url: String) -> Result<(), String> {
    let url = tauri::Url::parse(&spreadsheet_url).map_err(|error| error.to_string())?;
    if url.scheme() != "https" || url.host_str() != Some("docs.google.com") {
        return Err("TimeMarkシートのGoogle URLだけを開けます".to_string());
    }

    #[cfg(target_os = "ios")]
    {
        let external_url = spreadsheet_url.clone();
        _window
            .run_on_main_thread(move || {
                let marker = unsafe { MainThreadMarker::new_unchecked() };
                let application = UIApplication::sharedApplication(marker);
                let url_text = NSString::from_str(&external_url);
                let url = NSURL::URLWithString(&url_text).expect("validated Google Sheets URL");
                let options: objc2::rc::Retained<NSDictionary<UIApplicationOpenExternalURLOptionsKey, AnyObject>> =
                    NSDictionary::new();
                // This is the current UIKit API. It hands the URL to iOS rather
                // than navigating the TimeMark webview itself.
                unsafe {
                    application.openURL_options_completionHandler(&url, &options, None);
                }
            })
            .map_err(|error| error.to_string())?;
        return Ok(());
    }

    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open")
            .arg(spreadsheet_url)
            .spawn()
            .map_err(|error| error.to_string())?;
        return Ok(());
    }

    #[allow(unreachable_code)]
    Err("このOSでシートを外部アプリへ開く機能はまだ準備中です".to_string())
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
            load_timemark_schedule,
            load_school_events,
            open_timemark_sheet
        ])
        .run(tauri::generate_context!())
        .expect("TimeMark を起動できませんでした");
}
