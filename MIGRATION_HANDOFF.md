# TimeMark 同期・移行メモ

## Current Project

- Source: `/Users/myo-n778/Library/Mobile Documents/com~apple~CloudDocs/CODEX CLI/TimeMark`
- Local preview URL: `http://localhost:4173`

## Recent Work

- Added JSON import/export for full TimeMark data migration.
- Added Google Apps Script based spreadsheet sync and schedule import.
- Added `google-apps-script.js` for the spreadsheet-side web app.
- Set the default Apps Script endpoint in `app.js`:
  `https://script.google.com/macros/s/AKfycbzwVWyj8-LVBgjMNPKqDLkJtX8YZyUhYzyeMTcO5KlVH9W2Yac0lTPjuACBrLRot6Je/exec`

## Spreadsheet

- Spreadsheet:
  `https://docs.google.com/spreadsheets/d/1yo-HbLO80Zciql2h8rQJqIszyrln6CPqLpjc_QrJNAY/edit?gid=0#gid=0`
- Apps Script Web App:
  `https://script.google.com/macros/s/AKfycbzwVWyj8-LVBgjMNPKqDLkJtX8YZyUhYzyeMTcO5KlVH9W2Yac0lTPjuACBrLRot6Je/exec`
- Data sheet: `TimeMarkData`
- Columns: `userId`, `userName`, `dataJson`, `updatedAt`
- Schedule sheet: `TimeMarkSchedule` (configurable in the app)
- Schedule columns: `date`, `hours` (optional: `note`)

## Verification Already Done

- `node --check app.js`
- `node --check google-apps-script.js`
- Local server loaded:
  - `/`
  - `/style.css`
  - `/app.js`
  - `/syukujitsu.csv`

## ローカルバックアップ

`timemark-backup-*.json` は端末の復旧用バックアップであり、Gitには含めない。
