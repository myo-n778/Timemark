const SHEET_NAME = 'TimeMarkData';
const TOKEN_PROPERTY = 'TIMEMARK_TOKEN';

function doGet() {
  return jsonOutput({
    ok: true,
    app: 'TimeMark',
    message: 'TimeMark sync endpoint is running.'
  });
}

function doPost(e) {
  try {
    const body = JSON.parse((e.postData && e.postData.contents) || '{}');
    verifyToken(body.token || '');

    switch (body.action) {
      case 'listUsers':
        return jsonOutput({ ok: true, users: listUsers() });
      case 'saveUser':
        return jsonOutput({ ok: true, user: saveUser(body) });
      case 'loadUser':
        return jsonOutput(loadUser(body.userId));
      case 'loadSchedule':
        return jsonOutput(loadSchedule(body.sheetName));
      default:
        throw new Error('Unknown action: ' + body.action);
    }
  } catch (err) {
    return jsonOutput({ ok: false, error: err.message });
  }
}

function verifyToken(token) {
  const expected = PropertiesService.getScriptProperties().getProperty(TOKEN_PROPERTY);
  if (expected && token !== expected) {
    throw new Error('共有トークンが一致しません');
  }
}

function getSheet() {
  const spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = spreadsheet.getSheetByName(SHEET_NAME);
  if (!sheet) {
    sheet = spreadsheet.insertSheet(SHEET_NAME);
  }

  const headers = ['userId', 'userName', 'dataJson', 'updatedAt'];
  const current = sheet.getRange(1, 1, 1, headers.length).getValues()[0];
  if (current.join('') === '') {
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
    sheet.setFrozenRows(1);
  }
  return sheet;
}

function getRows() {
  const sheet = getSheet();
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return [];
  return sheet.getRange(2, 1, lastRow - 1, 4).getValues().map((row, index) => ({
    rowNumber: index + 2,
    userId: row[0],
    userName: row[1],
    dataJson: row[2],
    updatedAt: row[3]
  }));
}

function listUsers() {
  return getRows()
    .filter(row => row.userId && row.userName)
    .map(row => ({
      userId: row.userId,
      userName: row.userName,
      updatedAt: row.updatedAt ? new Date(row.updatedAt).toISOString() : ''
    }));
}

function saveUser(body) {
  const userName = String(body.userName || '').trim();
  if (!userName) throw new Error('ユーザー名がありません');
  if (!body.backup || typeof body.backup !== 'object') throw new Error('保存データがありません');

  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const sheet = getSheet();
    const rows = getRows();
    const existing = rows.find(row => row.userId === body.userId) || rows.find(row => row.userName === userName);
    const userId = existing ? existing.userId : Utilities.getUuid();
    const now = new Date();
    const values = [userId, userName, JSON.stringify(body.backup), now];

    if (existing) {
      sheet.getRange(existing.rowNumber, 1, 1, values.length).setValues([values]);
    } else {
      sheet.appendRow(values);
    }

    return {
      userId,
      userName,
      updatedAt: now.toISOString()
    };
  } finally {
    lock.releaseLock();
  }
}

function loadUser(userId) {
  if (!userId) throw new Error('ユーザーIDがありません');

  const row = getRows().find(item => item.userId === userId);
  if (!row) throw new Error('指定ユーザーが見つかりません');

  return {
    ok: true,
    user: {
      userId: row.userId,
      userName: row.userName,
      updatedAt: row.updatedAt ? new Date(row.updatedAt).toISOString() : ''
    },
    backup: JSON.parse(row.dataJson || '{}')
  };
}

function loadSchedule(sheetName) {
  const name = String(sheetName || 'TimeMarkSchedule').trim();
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(name);
  if (!sheet) throw new Error(`予定表シート「${name}」が見つかりません`);

  const values = sheet.getDataRange().getValues();
  if (values.length < 2) return { ok: true, sheetName: name, entries: [] };

  const headers = values[0].map(value => String(value).trim().toLowerCase());
  const dateIndex = headers.indexOf('date');
  const hoursIndex = headers.indexOf('hours');
  if (dateIndex === -1 || hoursIndex === -1) {
    throw new Error('予定表シートの1行目に date と hours 列が必要です');
  }

  const entries = [];
  values.slice(1).forEach((row, index) => {
    const rawDate = row[dateIndex];
    const hours = Number(row[hoursIndex]);
    if (rawDate === '' && row[hoursIndex] === '') return;
    if (!(rawDate instanceof Date) || Number.isNaN(rawDate.getTime())) {
      throw new Error(`${index + 2}行目の日付が正しくありません`);
    }
    if (!Number.isFinite(hours) || hours < 0) {
      throw new Error(`${index + 2}行目のhoursは0以上の数値にしてください`);
    }
    entries.push({
      date: Utilities.formatDate(rawDate, Session.getScriptTimeZone(), 'yyyy-MM-dd'),
      hours
    });
  });

  return { ok: true, sheetName: name, entries };
}

function jsonOutput(value) {
  return ContentService
    .createTextOutput(JSON.stringify(value))
    .setMimeType(ContentService.MimeType.JSON);
}
