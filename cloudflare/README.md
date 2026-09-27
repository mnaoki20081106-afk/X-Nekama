# X-Nekama Cloudflare Public Edition

一般公開向けの X-Nekama Core です。既存の Node.js 版とは別に、Cloudflare Workers + D1 + R2 + Queues + Cron で動きます。

## Security model

公開版では単一の `ADMIN_PASSWORD` を使用しません。

- 利用者ログイン: X OAuth 2.0 Authorization Code + PKCE
- セッション: 256-bit random token。D1 には SHA-256 hash のみ保存
- X access/refresh token: AES-256-GCM で暗号化して D1 保存
- 暗号化 AAD: `owner_id + account_id + token type`
- 全テーブル: `owner_id` でテナント分離
- 全API: ログイン利用者の `owner_id` を条件に含めて取得・更新
- R2: public access を有効化しない
- R2 object key: `owner_id/random-id.ext`
- 画像取得: Worker が所有権を確認した後だけ R2 binding から返す
- Browser mutation: exact Origin check
- Cookies: HttpOnly + Secure + SameSite=Lax
- レスポンス: X token / xAI key / Cloudflare credential / R2 key / owner_id を返さない
- Audit: 投稿本文やtokenを保存せず、event kind + object id のみ
- Queue: 投稿・自動補充をHTTPリクエストから分離
- DLQ: 3回失敗後に dead-letter queue へ
- Cron: 1分ごと。予約投稿確認と不足分の補充をQueueへ投入

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

`wrangler.toml.example` を `wrangler.toml` にコピーし、D1作成時に表示された `database_id`、公開URL、X OAuth Client ID を設定してください。

## Required secrets

### XAI_API_KEY
xAI API key。Grok文章生成 / Grok Imagine用。

### TOKEN_ENCRYPTION_KEY
利用者のX OAuth tokenを暗号化するマスター鍵。32 random bytes をbase64で保存します。

例:

```sh
openssl rand -base64 32
npx wrangler secret put TOKEN_ENCRYPTION_KEY
```

この値を失うと保存済みX tokenを復号できません。GitHub、IPA、D1、R2には保存しません。

### X_CLIENT_SECRET
X OAuth appをConfidential Clientとして作る場合だけSecretに保存します。

```sh
npx wrangler secret put XAI_API_KEY
npx wrangler secret put TOKEN_ENCRYPTION_KEY
npx wrangler secret put X_CLIENT_SECRET
```

Cloudflare API TokenはWorker runtimeには不要です。CI/CDに使う場合だけGitHub Actions Secretへ設定します。

## X OAuth

Callback URL:

```
https://YOUR_DOMAIN/auth/x/callback
```

要求scope:

```
users.read tweet.read tweet.write media.write offline.access
```

初回ログインで本人用workspaceを作り、追加Xアカウントはアプリ内の「キャラクターを追加」から同じOAuthフローで追加します。アカウント追加ごとにCloudflare環境変数を増やす必要はありません。

## D1 migration

```sh
cp wrangler.toml.example wrangler.toml
# database_id を置換
npm run db:migrate:remote
```

## Deploy

```sh
npm run check
npm run deploy
```

デプロイ後はR2の **Public Development URL (r2.dev) を有効化しないでください**。Custom DomainもR2 bucketへ直接接続せず、画像はWorker API経由だけで配信します。

## Production checklist

- `.dev.vars`, `.env`, `wrangler.toml` の秘密値をGitへcommitしない
- R2 Public Development URL = Disabled
- R2 custom public domain = None
- D1/R2/Queueはproduction用とstaging用を分離
- X OAuth callback URLはproduction domainだけ登録
- TOKEN_ENCRYPTION_KEYをパスワードマネージャ等でバックアップ
- Cloudflare API Tokenは最小権限
- GitHub Actions secretをfork PRへ渡さない
- Cloudflare Workers Logsへtoken、OAuth code、投稿本文、画像データを明示的にlogしない
- 定期的に失効sessionとOAuth flowを削除（WorkerがCronで実行）
- 退会処理ではD1 rowとR2 objectを削除する
