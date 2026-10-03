# NOCTURNE / X-Nekama

架空AIキャラクターのX運用を補助するツールです。

利用者ごとに自分のCloudflareアカウントへサーバーを配置し、アプリの「Cloudflare連携・接続先」から利用できます。[個人Cloudflareの連携手順](docs/PERSONAL_CLOUDFLARE_JA.md) を参照してください。

## VPN必須のサーバー予約投稿（最新）

iOSの投稿画面 `✦` →「投稿予約・カレンダー・生成設定」から、Xに近い黒・白・青の管理画面を開けます。カレンダーは日本時間の投稿時刻と日別一覧を表示します。口調・絵文字・カスタム指示・選択したお手本の取得済み投稿を生成プロンプトへ含めます。

自動投稿は常時稼働Linuxサーバーで行い、VPNが未接続なら予約を待機させます。起動方法と未検証の範囲は [サーバーVPN設定](docs/SERVER_VPN_JA.md) を参照してください。通常のNode起動ではVPN設定が必要です。Cloudflare版は別サーバーのWARP確認済みゲートウェイ経由でXへ接続します。

Cloudflareを管理・予約バックエンドにし、iPhoneと投稿側の出口を同じ固定IPv4へ揃えるWireGuardモードも利用できます。[共通VPN出口の設定](docs/SHARED_EXIT_JA.md) に設定生成・中継起動・Cloudflare配置・端末設定をまとめています。通常WARPモードと共通出口モードは別の構成です。実サーバー配置・実機確認は未完了です。

## 現在の基本方針

**運営側がX API代・xAI API代を負担する構成は採用しません。**

- Xへの接続・参考投稿取得・画像アップロード・投稿: XActionsのWebセッション経路
- X向けサーバー通信: WARP確認済み、またはGluetun＋固定出口IP・国の一致を確認できる経路のみ許可
- 投稿文/文体分析/画像生成: 利用者自身の端末にあるX/Grokへプロンプトと参照画像を渡す
- X Developer / 有料X API: 不要
- XAI_API_KEY: 不要
- 運営の共有AIキー: 不要

X-NekamaはGrokへ直接課金APIを呼ばず、キャラクター設定・参考投稿・浮上頻度・参考画像から **Grok用生成パック** を作ります。

### 文章生成

1. X-Nekamaでキャラクターと件数を選ぶ
2. X-NekamaがGrok用プロンプトを生成
3. 端末のX/Grokへ共有またはコピー
4. GrokのJSON返答をX-Nekamaへ貼り戻す
5. 投稿案として検証・保存

### 画像生成

1. 投稿ごとに画像タイプを決める
2. X-Nekamaが画像プロンプトを作成
3. 顔基準・スマホケース・服装・背景・撮影スタイルなどから最大5枚の参照画像を選ぶ
4. 端末のX/Grokへプロンプト＋参考画像を渡す
5. Grokで生成した画像をX-Nekamaへ戻す
6. 予約/投稿へ進む

標準共有シートが画像共有に対応する環境では、プロンプトと参照画像をまとめて渡します。対応しない場合はプロンプトコピー＋参照画像保存で利用します。

## X投稿

X Developer / 有料X APIは使用しません。

XActionsのHTTPクライアントとGraphQL更新追従コードを `vendor/xactions/` に収録しています（Apache-2.0）。

- 接続: XパスワードによるXActionsログイン、またはログイン済みCookie
- パスワード: 保存しない
- 保存するもの: 成功後のX WebセッションCookieを暗号化
- プロフィール確認: XActions
- 参考投稿取得: XActions
- 画像アップロード: XActions
- 投稿: XActions CreateTweet経路
- 2FA/captcha/追加認証: ログイン済みCookie方式へ切替

XのWeb実装が変わった場合はXActions側の追従が必要です。

## 実装済み

- 複数Xアカウント
- アカウントごとの人格/口調/年齢/職業/場所/趣味/一人称/NG話題
- 浮上頻度を「N日に1回」で数値設定
- 顔基準画像
- スマホケース
- 服装
- アクセサリー
- 背景
- プリクラ/BeReal風/自撮り/鏡撮り/他撮り
- お手本アカウント取得
- 取得したお手本投稿を最大500件まで全文体分析し、生成時は分析要約＋均等抽出した生投稿本文を情報源として利用
- Grok用文体分析パック
- Grok用週次投稿パック
- Grok用画像生成パック
- Grok JSON結果の検証/取込
- Grok生成画像の取込
- 投稿レビュー
- 投稿予約
- 重複投稿防止
- 投稿結果不明時の自動再送停止
- XActionsによる自動投稿
- Node版のWARP fail-closed送信
- Cloudflare Cron/QueueからWARP egress経由の自動投稿

## 投稿キューの安全設計

- 同一アカウントの投稿処理を直列化
- 同じ本文の予約/送信中/直近24時間投稿済みを検知
- 429や投稿送信前の一時通信障害だけ安全な範囲で再試行
- 投稿送信後の通信断・5xx・投稿ID不明は自動再送しない
- WARP未接続は送信前に遮断し、予約状態のまま60秒後に再確認
- 送信結果が曖昧なら利用者確認へ送る

## Node版の起動

Node.js 24以上。

```sh
cp .env.node.example .env
npm start
```

必要な環境変数:

| 変数 | 用途 |
|---|---|
| `ADMIN_PASSWORD` | 管理画面パスワード |
| `APP_SECRET` | Xセッション暗号化の材料 |
| `DATA_DIR` | SQLite/画像保存先 |
| `HOST`, `PORT` | 待受先 |

xAI APIキーは不要です。

Node版でXActions通信を使うホストはCloudflare WARPへ接続してください。各X向けHTTPリクエスト直前にWARPを確認し、未接続なら送信しません。

## Cloudflare版について

`cloudflare/` は一般公開向けの任意バックエンドです。

Cloudflare版もAI生成は行わず、以下だけを担当します。

- 利用者分離
- Xセッションの暗号化保存
- D1/R2保存
- 参考投稿取得
- 予約投稿キュー
- XActions投稿
- WARP egress経由のX通信

Cloudflare Worker自身は端末のWARP経路を使えないため、Cloudflare版のX通信には **WARP接続済みのegressホスト** が1台必要です。WorkerのCron/Queueはそのegressだけを経由します。設定方法は `docs/VPN_EGRESS_JA.md` を参照してください。

**厳密に運営費0を優先する場合、Cloudflare版を必須構成にはしません。** ホスティングやストレージの利用量によって費用が発生し得るためです。

## プライバシー

GitHubや配布物へ以下を入れません。

- X Cookie
- Xパスワード
- TOKEN_ENCRYPTION_KEY
- Cloudflare credential

Xパスワードは接続処理時だけ使い、保存しません。

## 検証

`npm test` では以下を確認します。

- XActions以外の有料X API経路が混入していない
- 共有xAI API呼び出しが存在しない
- Grok生成パックの構造
- Grok JSON取込の検証
- 認証/保存/AI表記
- 投稿キューの再試行/曖昧送信処理
- WARP未接続時のfail-closed処理
- XActions画像アップロードのINIT/APPEND/FINALIZE回帰テスト
- 本文フィンガープリント


## Deploy to Cloudflare ボタン

一般公開時はCloudflare公式の **Deploy to Cloudflare** ボタンを第一導線にします。なお、予約自動投稿を有効にするにはデプロイ後に `X_EGRESS_URL` と `X_EGRESS_TOKEN` の設定が必要です。

このリポジトリには既にDeploy Button用の `wrangler.toml` と `npm run deploy` を用意してあります。Cloudflare側がD1 / R2 / Queuesを自動プロビジョニングし、D1 migrationもdeploy scriptから適用します。

公開用クリーンrepositoryを作成した後、READMEへ次の形式のボタンを追加します。

```md
[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/OWNER/X-Nekama)
```

現在の開発repositoryは過去commit metadataに個人メールが含まれるため、**配布用ボタンはクリーンrepo作成後に有効化**します。

ボタン方式で問題が起きた場合は `docs/CLOUDFLARE_SETUP_JA.md` の完全自動セットアップスクリプトを使用できます。
