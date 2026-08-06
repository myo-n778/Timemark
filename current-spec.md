# TimeMark 現行仕様

## 提供形態

- TimeMarkは端末内へ画面・計算・データ形式を同梱するパッケージアプリとして提供する。最初の配布対象はiPhone、iPad、Macで、同じコード基盤からAndroidとWindowsにも展開する。
- アプリの起動・端末内保存・JSONのインポート／エクスポートはWeb公開やGitHub Pagesに依存しない。
- PWAファイルはブラウザ用フォールバックとして残すが、パッケージアプリではService Workerを登録しない。

## データ

- 端末内データは各OSのアプリWebViewが保持する `localStorage` に保存する。アプリを削除する前にはJSONエクスポートで復旧用バックアップを作成できる。
- Googleスプレッドシート同期は、ユーザーごとのTimeMarkバックアップを `TimeMarkData` シートへ保存・読込する。
- 予定表読込は `TimeMarkSchedule`（設定画面で変更可）の `date`、`hours` 列を読み、例外日の稼働時間へ反映する。同一日付は上書きする。

## 並び順

- ターゲットの順序は `state.targets` を正本とし、LISTとTime Roadで共通に表示する。
- 両画面でのドラッグ並び替えは保存され、再読み込み後も維持する。
