# 自分のCloudflareアカウントを連携する

利用者が自分のCloudflareアカウントにWorker・D1・private R2・Queueを作り、そのサーバーをアプリから利用する構成です。予約・画像・暗号化したXセッションは、その利用者のCloudflare環境に保存されます。Cloudflareのログイン情報をIPAや運営のサーバーに送る機能はありません。

## iPhoneからの連携

1. Xの投稿画面の `✦ → Cloudflare連携・接続先` を開きます。
2. 「Cloudflareでサーバーを作成」を選び、Cloudflare公式の配置画面をブラウザで開きます。
3. 自分のCloudflareとGitHub/GitLabへログインし、配置先とリソース名を確認します。コードのコピーとリソースの作成はCloudflareの公式フローが行います。
4. VPN中継の `X_EGRESS_URL`、Secret `X_EGRESS_TOKEN` を設定します。共通出口の場合は `X_EXIT_MODE=shared`、`X_EXIT_IP`、`X_EXIT_COUNTRY` も中継・端末と一致させます。
5. 完了後のWorker URL（`https://…workers.dev`）をコピーし、アプリの「作成済みサーバーに接続」へ入力します。
6. アプリが `/api/instance` を確認してから接続先を保存します。Xへのログインは、そのサーバーの管理画面で行います。

現段階ではCloudflare公式の配置とURL入力の2段階です。アプリ独自のCloudflare OAuth、自動コールバックやワンタップでの無操作配置は実装していません。公式フローのアカウント作成・契約設定・ログイン・承認は利用者自身の操作が必要です。

現在の開発版の配置リンクは [Deploy to Cloudflare](https://deploy.workers.cloudflare.com/?url=https%3A%2F%2Fgithub.com%2Fmnaoki20081106-afk%2FX-Nekama%2Ftree%2Fcodex%2Fserver-calendar-vpn-20261003) です。mainへの統合後に正式配布先へ変更します。リンクはリポジトリ全体を指定します（cloudflareサブディレクトリだけでは、親フォルダの依存ファイルが欠けます）。

## PCでの配置

既存の `node cloudflare/setup.mjs` も、自分のCloudflareへの配置に対応します。Wranglerのブラウザログイン後、アクセス可能なアカウントが1つなら自動選択します。複数ある場合は、先に `CLOUDFLARE_ACCOUNT_ID` を指定してください。

```sh
export CLOUDFLARE_ACCOUNT_ID="自分の32桁アカウントID"
export X_EGRESS_URL="https://自分の中継/fetch"
export X_EGRESS_TOKEN="中継と同じ24文字以上のSecret"
node cloudflare/setup.mjs
```

選択したアカウントIDを配置設定へ保存し、D1・R2・Queue・Worker・Secretの各コマンドへ同じIDを渡します。再セットアップや診断で別のアカウントへ切り替わる場合は停止します。別アカウントへ新規配置する場合は別の作業フォルダを使ってください。

## 接続解除と費用

アプリの「接続を解除」は端末のURL設定を消します。サーバー上の予約は続きます。投稿を停止するには管理画面で予約を解除するか、Cloudflare側のCron/Queue/Workerを停止してください。サーバーやデータの削除もCloudflare側で操作します。

リソースの使用量・契約・料金は配置先の利用者アカウントに属します。無料で無制限に動く保証はありません。Cloudflareの個人アカウント連携だけではVPN出口を作れません。[共通VPN出口](SHARED_EXIT_JA.md)の別サーバーが引き続き必要です。

接続先の種類を確認するAPIはCloudflareアカウントの所有権を証明するものではありません。必ず自分のダッシュボードに表示されたURLを入力してください。実際の個人アカウントでの初回配置、iPhoneからの認証・復帰、自動投稿は未検証です。
