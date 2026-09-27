# Public Release Privacy Checklist

X-Nekamaを一般公開する前の必須チェックです。

## 1. GitHub identity

現在の開発リポジトリの過去commit metadataは、公開配布用履歴として再利用しないでください。

公開前に:

1. GitHub Settings > Emails で **Keep my email addresses private** を有効化
2. 今後のcommit authorをGitHub noreply addressへ変更
3. 公開配布用は新しいクリーンなrepositoryへ、現在の最新treeだけを1つの初期commitとして移す
4. 古い `.git` 履歴、ローカル設定、CIログ、ビルド成果物をコピーしない
5. 可能なら個人名を含まないOrganization/ブランド名を配布元に使う

`.mailmap`だけでは元commit objectのemailを削除できないため、公開履歴の匿名化には使わないでください。

## 2. Secrets

次の値はIPA、JavaScript、D1、R2、GitHub repositoryへ入れません。

- XAI_API_KEY
- TOKEN_ENCRYPTION_KEY
- Cloudflare API token
- X Web session cookie

Cloudflare Worker runtimeでは、`XAI_API_KEY` と `TOKEN_ENCRYPTION_KEY` だけを **Workers Secrets** として設定します。

X Web session CookieはWorkerが受け取り、TOKEN_ENCRYPTION_KEYでAES-256-GCM暗号化したciphertextだけをD1へ保存します。

## 3. Tenant isolation

公開版の全データは `owner_id` 単位で分離します。

本番公開前に最低2つのテスト利用者を作り、以下を確認してください。

- User AがUser Bのaccount IDを指定しても404/拒否
- User AがUser Bのdraft IDを指定しても404/拒否
- User AがUser Bのasset IDを指定しても画像を取得できない
- ref / ref_postも同様
- API responseにowner_id / encrypted Cookie / R2 keyが含まれない

## 4. R2

R2 bucketはprivateのまま使います。

- Public Development URL (r2.dev): Disabled
- Public Custom Domain: None
- objectはWorker binding経由だけで取得
- keyは `owner_id/random-id.ext`
- WorkerはD1で所有権確認してからR2を読む

## 5. X session connection

X Developer / OAuth 2.0は使用しません。

- XActionsでユーザー自身のX Webセッションを検証
- パスワードは保存しない
- CookieだけAES-256-GCM暗号化してD1へ保存
- 追加認証が必要な場合はログイン済みCookie接続へ切り替える
- 接続CookieはAPI responseやログへ出さない

## 6. Data deletion

公開版には `DELETE /api/me` とアプリ内の「データを削除」を用意しています。

削除対象:

- users
- sessions
- connected X accounts / encrypted Cookie
- drafts
- refs / ref_posts
- jobs
- usage counters
- audit events
- R2 assets

## 7. Cost / abuse protection

shared XAI_API_KEYを利用者へ配布しません。

Worker側で1ユーザー・1日あたりの上限を強制します。

Default:

- text generation: 20 API requests/day
- image generation: 10 API requests/day

`TEXT_GENERATION_DAILY_LIMIT` / `IMAGE_GENERATION_DAILY_LIMIT` で変更できます。

UIを書き換えてもWorker側のD1 counterで拒否します。

## 8. Logs

本番では以下をconsoleへ出しません。

- X Web session Cookie
- Xパスワード
- XAI_API_KEY
- 投稿本文
- 画像base64
- user email

Cloudflare Observabilityを有効化する場合は、request bodyを記録しない設定を確認してください。

## 9. Release gate

一般公開OKと判断する条件:

- root CI: green
- `node --check cloudflare/src/index.mjs`: green
- `wrangler deploy --dry-run`: green
- production D1 migration成功
- R2 public access disabled
- 2-user tenant isolation E2E成功
- self-delete E2E成功
- XActionsによるtext-only実投稿E2E成功
- XActionsによる画像付き実投稿E2E成功
- public release repositoryにpersonal emailを含む過去履歴がない
