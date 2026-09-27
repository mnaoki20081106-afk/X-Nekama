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

## 2. Secrets

次の値はIPA、JavaScript、D1、R2、GitHub repositoryへ入れません。

- Cloudflare API token
- X Web session cookie
- Xパスワード

**XAI_API_KEYは使用しません。**

## 3. Tenant isolation

公開版の全データは `owner_id` 単位で分離します。

- User AがUser Bのaccount IDを指定しても404/拒否
- User AがUser Bのdraft IDを指定しても404/拒否
- User AがUser Bのasset IDを指定しても取得不可
- ref / ref_postも同様
- responseにowner_id / encrypted Cookie / R2 keyを含めない

## 4. R2

- Public Development URL (r2.dev): Disabled
- Public Custom Domain: None
- Workerで所有権確認後のみR2を読む
- keyは `owner_id/random-id.ext`

## 5. X session connection

- X Developer / OAuth 2.0は使用しない
- XActionsでユーザー自身のX Webセッションを検証
- パスワードは保存しない
- CookieだけAES-256-GCM暗号化。master keyはprivate R2内部で自動生成
- 2FA/captcha等はログイン済みCookie方式
- CookieをAPI response/logへ出さない

## 6. Grok generation

- 運営共有xAI APIキーなし
- Worker/Node serverからapi.x.aiへ通信しない
- 投稿文生成は端末のX/Grok
- 文体分析は端末のX/Grok
- 画像生成は端末のX/Grok
- X-Nekamaはプロンプト/参照画像パックだけ作る
- GrokのJSON/画像をX-Nekamaへ戻して検証・保存

## 7. Data deletion

削除対象:

- users
- sessions
- connected X accounts / encrypted Cookie
- drafts
- refs / ref_posts
- jobs
- audit events
- R2 assets

## 8. Logs

本番では以下をconsoleへ出しません。

- X Web session Cookie
- Xパスワード
- 投稿本文
- 画像base64
- user email

## 9. Cost rule

運営者がユーザーのために購入する以下の有料APIは使用しません。

- X Developer API
- xAI API

Cloudflare版は任意です。Cloudflare自体の利用料が発生し得るため、厳密な運営費0構成では必須にしません。

## 10. Release gate

- root CI: green
- `node --check cloudflare/src/index.mjs`: green
- `wrangler deploy --dry-run`: green
- runtimeにXAI_API_KEY/api.x.aiが存在しない
- runtimeにX Developer有料API経路が存在しない
- R2 public access disabled
- 2-user tenant isolation E2E成功
- self-delete E2E成功
- XActions text-only実投稿成功
- XActions画像付き実投稿成功
- Grok週次プロンプト → JSON取込成功
- Grok画像パック → 画像取込成功
- public release repositoryにpersonal emailを含む過去履歴がない
