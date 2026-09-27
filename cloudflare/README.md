# X-Nekama Cloudflare Public Edition

一般公開向けの X-Nekama Core です。Cloudflare Workers + D1 + R2 + Queues + Cron で動きます。

## X接続方式

**X Developer / 有料X APIは使用しません。**

Xへの接続・参考投稿取得・プロフィール確認・画像アップロード・投稿は、リポジトリに同梱している XActions のWebセッション経路を使用します。

- XユーザーID + パスワードでXActionsログイン
- 追加認証・2FA・captcha等で資格情報ログインが通らない場合は、ログイン済みCookieを入力
- パスワードは保存しない
- 接続成功後のCookieだけをAES-256-GCMで暗号化してD1へ保存
- アカウントを追加するたびにCloudflare環境変数を増やす必要はない

X Web実装が変わると非公式クライアント側の追従が必要になるため、XActions上流とquery ID更新機構を利用して保守します。

## Security model

公開版では単一の ADMIN_PASSWORD を利用者へ共有しません。

- 初回X接続でXユーザーIDをX-Nekama利用者IDとして登録
- X-Nekamaセッション: 256-bit random token。D1にはSHA-256 hashのみ保存
- X Web session Cookie: TOKEN_ENCRYPTION_KEYでAES-256-GCM暗号化
- 全テーブル: owner_idでテナント分離
- 全API: ログイン利用者のowner_idを条件に含める
- R2: public accessを有効化しない
- R2 object key: owner_id/random-id.ext
- 画像取得: Workerが所有権確認後だけR2 bindingから返す
- Browser mutation: exact Origin check
- Cookies: HttpOnly + Secure + SameSite=Lax
- responseにX Cookie / xAI key / Cloudflare credential / R2 key / owner_idを返さない
- Audit: 投稿本文やCookieを保存せずevent kind + object idのみ
- Queue: 投稿・参考投稿取得・自動補充をHTTP requestから分離
- DLQ: 3回失敗後にdead-letter queue
- Cron: 1分ごとに予約投稿と自動補充を確認
- xAI利用量: userごとの日次上限をD1で強制

## Cloudflare resources

一度だけ以下を作ります。

```sh
cd cloudflare
npm install
npx wrangler login

npx wrangler d1 create x-nekama-public
npx wrangler r2 bucket create x-nekama-media
npx wrangler queues create x-nekama-tasks
npx wrangler queues create x-nekama-dlq
```

`wrangler.toml.example` を `wrangler.toml` にコピーし、D1作成時に表示された `database_id` と公開URLを設定してください。

## Required secrets

### XAI_API_KEY

Grok文章生成 / Grok Imagine用。xAI APIを利用する場合に設定します。

```sh
npx wrangler secret put XAI_API_KEY
```

### TOKEN_ENCRYPTION_KEY

利用者のX Web session Cookieを暗号化するマスター鍵です。32 random bytesをbase64で保存します。

```sh
openssl rand -base64 32
npx wrangler secret put TOKEN_ENCRYPTION_KEY
```

この値を失うと保存済みXセッションを復号できません。GitHub、IPA、D1、R2には保存しません。

Cloudflare API TokenはWorker runtimeには不要です。CI/CDに使う場合だけGitHub Actions Secretへ設定します。

## D1 migration

```sh
cp wrangler.toml.example wrangler.toml
# database_id と PUBLIC_BASE_URL を置換
npm run db:migrate:remote
```

## Deploy

```sh
npm run check
npm run deploy
```

## Xアカウント追加

セットアップ後はアプリ側だけで完結します。

1. 初回画面でXユーザーID + パスワード、またはログイン済みCookieを入力
2. XActionsがXセッションを検証
3. X-Nekama用ログインsessionを発行
4. X Cookieを暗号化してD1保存
5. 追加アカウントもアプリ内の「キャラクターを追加」から同じ方式で接続

パスワードは接続処理にだけ使い、保存しません。

## R2

R2の Public Development URL (r2.dev) は有効化しないでください。Custom DomainもR2 bucketへ直接接続しません。画像はWorker API経由だけで配信します。

## Default xAI quotas

- text generation: 20 requests / user / day
- image generation: 10 requests / user / day

`TEXT_GENERATION_DAILY_LIMIT` と `IMAGE_GENERATION_DAILY_LIMIT` で変更できます。

## Production checklist

- .dev.vars / .env / wrangler.tomlの秘密値をGitへcommitしない
- R2 Public Development URL = Disabled
- R2 custom public domain = None
- stagingとproductionのD1/R2/Queueを分離
- TOKEN_ENCRYPTION_KEYを安全にバックアップ
- Cloudflare API Tokenは最小権限
- GitHub Actions secretをfork PRへ渡さない
- Workers LogsへCookie、パスワード、投稿本文、画像base64をlogしない
- 利用者Aから利用者Bのaccount/draft/asset/refへアクセスできないことをE2E確認
- 退会時にD1 rowとR2 objectが削除されることを確認

Cloudflare Workersは2026-08以降の互換日付でNode.js互換が既定有効で、node:fs / node:crypto等が利用できます。XActionsのNode依存部分はWorker内の一時VFSを使って動作し、永続データはD1/R2へ保存します。
