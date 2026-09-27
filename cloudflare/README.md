# X-Nekama Cloudflare Public Edition

一般公開向けの **任意バックエンド** です。

Cloudflare版もX DeveloperやxAI APIを使いません。

## 役割

Cloudflare側が担当するのは次だけです。

- 利用者ごとのデータ分離
- X WebセッションCookieの暗号化保存
- D1/R2保存
- 参考投稿取得
- 予約投稿キュー
- XActionsによるX投稿

投稿文・文体分析・画像生成は **利用者端末のX/Grok** で行います。

## X接続

- X Developer / 有料X API: 不要
- XユーザーID + パスワードでXActionsログイン
- 追加認証/2FA/captcha等が必要ならログイン済みCookie方式
- パスワードは保存しない
- 接続成功後のCookieだけAES-256-GCM暗号化してD1保存
- アカウント追加ごとのCloudflare環境変数は不要

## Grok生成

共有AIキーはありません。

- WorkerはxAIへ通信しない
- XAI_API_KEYは不要
- 生成クォータテーブルも不要
- X-NekamaがGrok用プロンプト/参照画像パックを返す
- 利用者が端末のX/Grokで生成
- JSONまたは生成画像をX-Nekamaへ戻す

## Security model

- X-Nekama session: 256-bit random token
- D1へはsession tokenのSHA-256 hashだけ保存
- X Web session Cookie: TOKEN_ENCRYPTION_KEYでAES-256-GCM暗号化
- 全データ: owner_idで分離
- R2: public access無効
- R2 key: owner_id/random-id.ext
- 画像取得: Workerで所有権確認後のみ
- Browser mutation: exact Origin check
- Cookies: HttpOnly + Secure + SameSite=Lax
- responseへX Cookie / encryption key / R2 key / owner_idを返さない
- Worker logへパスワード/Cookie/投稿本文/画像base64を出さない

## Cloudflare resources

```sh
cd cloudflare
npm install
npx wrangler login

npx wrangler d1 create x-nekama-public
npx wrangler r2 bucket create x-nekama-media
npx wrangler queues create x-nekama-tasks
npx wrangler queues create x-nekama-dlq
```

`wrangler.toml.example` を `wrangler.toml` にコピーし、D1のdatabase_idとPUBLIC_BASE_URLだけ設定します。

## Required secret

### TOKEN_ENCRYPTION_KEY

```sh
openssl rand -base64 32
npx wrangler secret put TOKEN_ENCRYPTION_KEY
```

X WebセッションCookieの暗号化だけに使います。

## Deploy

```sh
npm run check
npm run db:migrate:remote
npm run deploy
```

## R2

- Public Development URL (r2.dev): Disabled
- Public Custom Domain: None
- 画像はWorker API経由のみ

## Cron / Queue

CronはAI生成を行いません。

- 期限切れX-Nekama session削除
- 予約時刻を迎えた投稿をQueueへ投入
- QueueでXActions投稿

参考投稿取得もQueueで処理します。

## 費用について

このCloudflare版は運営のX API/xAI API費用を発生させません。

ただしCloudflare自体の利用量・契約プランによる費用可能性は別です。**厳密に運営費0を要求する配布形態では、Cloudflare版を必須にはしません。**

## Production checklist

- TOKEN_ENCRYPTION_KEYをGitへcommitしない
- R2 public access無効
- staging/production分離
- Workers LogsへCookie/パスワードを出さない
- User AからUser Bのaccount/draft/asset/refへアクセス不可
- 退会時にD1 row/R2 object削除
- XActions text-only実投稿確認
- XActions画像付き実投稿確認
- Grokパック生成/JSON取込確認
