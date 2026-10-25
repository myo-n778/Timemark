# 依存更新の記録（2026-10-24）

ネイティブ版のRust tauriを2.11.5から2.11.6へ更新し、Cargo.tomlに修正下限を指定しました。Node22.23.4とNode24対応Actionsへ変更し、WindowsのPRビルドを追加しました。

Web版のapp.js・UI・保存データ・service workerとGoogle同期コードは変更していません。今回の対象はTauri IPCを持つnative版です。nativeの署名・リリースは別の承認段階です。

## 検証

cargo update -p tauri --precise 2.11.6、npm run prepare:desktop、cargo check --locked --offline、workflow YAMLを確認しました。iOS preflightはERROR=0 / WARN=1でした。

## 未確認と反映境界

Windows/iOS/Androidの実機起動・Google認証同期・署名・配布は未確認です。WindowsビルドはPRのCIで確認します。iOS preflightの警告は既存のプライバシーポリシー原稿未検出です。公開前の確認事項として残します。

本記録はブランチ上の変更です。main merge、GitHub Pages本番deploy、nativeリリースは実施していません。

根拠: https://github.com/tauri-apps/tauri/security/advisories/GHSA-w28w-mhc8-qvjv
