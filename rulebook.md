# TimeMark 変更規則

1. 保存済みデータ、既存の計算、Google同期、編集操作を壊さない。
2. LISTとTime Roadのターゲット順序は常に同じ `state.targets` を使う。
3. PWAシェルを変更したら `service-worker.js` のキャッシュ名を更新し、関連資産をキャッシュ対象へ含める。
4. Apps Scriptの変更はローカルファイル・デプロイ済みスクリプトの両方を一致させる。
