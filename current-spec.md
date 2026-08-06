# TimeMark 現行仕様

## 提供形態

- 静的WebアプリをPWAとして提供する。iPhone、iPad、Mac、Android、Windowsでインストールして利用できる。
- インストールとService Workerの利用にはHTTPS公開が必要。ローカルホストは開発確認用。

## データ

- 端末内データは `localStorage` に保存する。
- Googleスプレッドシート同期は、ユーザーごとのTimeMarkバックアップを `TimeMarkData` シートへ保存・読込する。
- 予定表読込は `TimeMarkSchedule`（設定画面で変更可）の `date`、`hours` 列を読み、例外日の稼働時間へ反映する。同一日付は上書きする。

## 並び順

- ターゲットの順序は `state.targets` を正本とし、LISTとTime Roadで共通に表示する。
- 両画面でのドラッグ並び替えは保存され、再読み込み後も維持する。
