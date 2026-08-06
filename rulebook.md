# TimeMark 変更規則

1. 保存済みデータ、既存の計算、Google同期、編集操作を壊さない。
2. LISTとTime Roadのターゲット順序は常に同じ `state.targets` を使う。
3. パッケージアプリに同梱する資産は `scripts/prepare-tauri-assets.mjs` で `dist/` へ生成し、外部フォントやWeb公開を起動条件にしない。PWAシェルを変更した場合だけ `service-worker.js` のキャッシュ名を更新する。
4. Apps Scriptの変更はローカルファイル・デプロイ済みスクリプトの両方を一致させる。
