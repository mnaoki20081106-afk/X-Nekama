# Riri self-hosted Qwen 3.8

Cloudflare Workers AIの代わりに、自分のGPUサーバー上でQwen 3.8を動かすバックエンドです。
既存の`riri-tweak`が使う`/setup-check`、`/ingest`、`/claim`、`/ack`と互換なので、tweakのDMフック本体は変更しません。

構成: `X tweak -> HTTPS(Caddy) -> Node bridge + SQLite -> private vLLM -> Qwen/Qwen3.8-27B-FP8`

## 起動

Linux + Docker/Compose + NVIDIA Container Toolkitが必要です。

```bash
cd riri-qwen-server
cp env.example .env
# BOT_SECRET / OWN_USER_ID / RIRI_PUBLIC_HOST を編集
docker compose up -d
```

`RIRI_PUBLIC_HOST`のDNSをこのサーバーへ向けるとCaddyがHTTPSを終端します。vLLMの8000番ポートは外部公開しません。

X内の`Riri設定`で「既存の接続先を設定」を選び、`https://RIRI_PUBLIC_HOST`と`BOT_SECRET`を入力してください。`/setup-check`は実際にQwenへ短い推論を行ってから接続を保存します。

既定モデルは`Qwen/Qwen3.8-27B-FP8`、vLLM上のモデル名は`qwen3.8`です。会話はSQLiteへ保存し、直近12件を文脈として推論します。`chat_template_kwargs.enable_thinking=false`でDM返信ではthinkingを返しません。

人格は`.env`の`SYSTEM_PROMPT`、または認証付き`POST /profile`の`{"prompt":"..."}`で変更できます。
