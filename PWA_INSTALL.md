# TimeMark のインストールと公開

TimeMark は PWA（Progressive Web App）です。HTTPS で公開された URL を開けば、同じ版を iPhone、iPad、Mac、Android、Windows で利用できます。

## 最初に使う Apple 端末

- **iPhone / iPad**: Safari で URL を開き、共有ボタンから「ホーム画面に追加」を選びます。
- **Mac**: Safari で URL を開き、共有メニューから「Dockに追加」を選びます。Chrome / Edge ではアドレスバーのインストール操作でも追加できます。

## Android / Windows

- **Android**: Chrome のメニューから「アプリをインストール」または「ホーム画面に追加」を選びます。
- **Windows**: Edge または Chrome のアドレスバーにあるインストール操作から追加します。

## データと同期

- 端末内の作業データは各端末のブラウザ領域に保存されます。
- 端末をまたいで同じデータを使うときは、設定画面のGoogleスプレッドシート同期を使います。
- アプリ本体と祝日データは、初回起動後に端末へキャッシュされ、通信がない状況でも起動できます。Googleスプレッドシート同期には通信が必要です。

## 予定表シートの読込

設定画面の「予定表を読み込み」は、Apps Scriptと同じスプレッドシートにある `TimeMarkSchedule`（変更可）を読みます。1行目を `date`, `hours` とし、2行目以降へ日付とその日に使える時間を入力します。読み込んだ値はTimeMarkの例外日設定として保存され、同じ日付の既存設定は上書きされます。

## 公開条件

インストール機能とService Workerは HTTPS が必須です。GitHub Pages、Cloudflare Pages、Netlifyなどの静的ホスティングで公開できます。ローカルの `http://localhost` は開発確認用です。
