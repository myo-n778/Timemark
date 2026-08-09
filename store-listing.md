# TimeMark Planner — App Store / TestFlight 掲載文

更新日: 2026-08-09  
対象バージョン: iOS / iPadOS 0.1.1

## App Store Connect 基本情報

| 項目 | 登録文 |
| --- | --- |
| App名 | TimeMark Planner |
| サブタイトル | Your Time, Your Goal |
| プロモーション用テキスト | 目標日までの時間を見える化して、今日の学習計画へ。自分の予定と学校予定を分けて管理できます。 |
| キーワード | 学習計画,目標管理,受験,勉強,カウントダウン,予定,時間管理,学校予定,スプレッドシート |

## App Store 説明（日本語）

TimeMark Planner は、目標日までに使える時間を見える化し、無理のない学習計画へつなげるためのアプリです。

受験、試験、資格、学校行事などの目標を登録すると、残り日数と学習目標を一覧とTime Roadで確認できます。ターゲットの順番はドラッグまたは上下ボタンで自由に整理でき、並び順は再起動後も保たれます。

主な機能

- 目標日までの残日数と学習時間の見通し
- LISTとTime Roadでの共通ターゲット管理
- 自分の予定と学校予定（SchoolEvents）を分けた読み込み
- 例外日・休校日・試験日を含めた可処分時間の調整
- 終了した目標をアーカイブして、必要なときだけ確認・復元
- 端末内保存とJSONによるインポート／エクスポート
- 任意のGoogleスプレッドシート同期

Googleスプレッドシート同期は必要な人だけが利用できます。アプリから自分用のTimeMarkシートを作成するか、既存の対応シートを接続してください。Googleのログイン情報は端末へ通常保存せず、アプリを閉じた後や有効期限後には再接続が必要です。

TimeMark Planner は、計画を詰め込むためではなく、目標までの時間を落ち着いて見通すための道具です。

## TestFlight テスト情報

### テスト内容

TimeMark Planner 0.1.1 は、iPhone／iPad向けの初回TestFlightビルドです。目標の登録・編集、LIST／Time Roadでの並び替え、アーカイブ、端末内保存、JSONのインポート／エクスポートを確認してください。

Googleスプレッドシート同期は任意です。利用する場合は、Google接続後にTimeMarkシートを作成し、「自分のデータを保存」「自分のデータを読み込む」「自分の予定を読み込む」「学校予定を読み込む」を試してください。

### 特に確認してほしい点

1. iPhoneとiPadで文字やボタンが見切れず操作できるか
2. ターゲットのドラッグ・上下ボタンによる並び替えがLISTとTime Roadで一致するか
3. 長押し編集とドラッグ操作が競合しないか
4. アーカイブしたターゲットを下部の「アーカイブ」から復元できるか
5. アプリを閉じて開き直した後も、データと順序が保たれるか
6. Google同期を使う場合、ログイン後にTimeMarkの画面へ戻れるか

### フィードバック時に添えてほしい情報

- 使用した機種（例: iPhone 17、iPad Air）
- iOS／iPadOSのバージョン
- 操作手順
- 期待した動きと実際の動き
- 可能であればスクリーンショット

## プライバシー説明の草案

TimeMark Planner は、目標、予定、学習時間、アーカイブ状態などのデータを、まず利用者の端末内に保存します。開発者の独自サーバーへ、これらのデータを送信・保管することはありません。

Googleスプレッドシート同期を利用者が選択した場合に限り、利用者自身のGoogleアカウントで指定または作成したスプレッドシートへ、TimeMarkデータと学校予定データを保存・読み込みます。Googleのアクセストークンはアプリの実行中だけメモリに保持し、通常の端末保存領域には記録しません。

TimeMark Planner は、広告表示、利用者追跡、行動分析、第三者広告ネットワークへのデータ提供を行いません。

> 公開前に必要な項目
>
> App Storeでは到達可能な「プライバシーポリシーURL」と「サポートURL」が必要です。この草案には連絡先をまだ入れていません。公開先URLと問い合わせ用メールアドレスまたはフォームを決めてから、ポリシーとして公開します。

## 英語の短い説明（英語ストア向け）

TimeMark Planner helps you see the time remaining until your goals and turn it into a realistic study plan. Manage goals, personal schedules, and school events in separate views. Keep your data on your device, export it as JSON, or optionally sync it with your own Google Spreadsheet.
