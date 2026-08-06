# 変更履歴

## 2026-08-06

- PWAのmanifest、Service Worker、アイコンを追加し、キャッシュをv2へ更新。
- Time RoadへLISTと共通のターゲット並び替えと保存を追加。
- Googleスプレッドシート予定表の `date`、`hours` 列を例外日として取り込む機能を追加。
- ユーザー所有の新しいTimeMarkスプレッドシート／Apps Scriptへ同期先を移行。旧既定URLを保存済みの端末も、新しい同期先へ自動で切り替える。
- Web公開に依存しないパッケージアプリ化の基盤として、Tauri 2のmacOS／iOS／Android／Windows対応プロジェクトを追加。画面資産をアプリに同梱し、パッケージ版ではService Workerを使わない構成へ変更。
- macOSパッケージ設定へTimeMarkアイコンを明示的に登録し、`TimeMark.app` とDMGへ `icon.icns` を同梱するよう修正。
