# RiriCore

人格・段階機械・記憶・人間らしい可用性を持つDM返信エンジン。

## デフォルトLLM

**Cloudflare Workers AI `@cf/qwen/qwen3.8-27b`**

- 日本語の自然さが強い
- X-NekamaのCloudflare前提と相性が良い
- 毎日無料Neurons框内で現実的

## 起動に必要な環境変数

```bash
CLOUDFLARE_ACCOUNT_ID=your_account_id
CLOUDFLARE_API_TOKEN=your_token_with_Workers_AI_permission
```

任意:
- `RIRI_MODEL` で上書き可能
- `RIRI_LLM_URL` で別エンドポイントに変更可能

## 起動

```bash
cd xchat-bot/riri-core
npm start
```

xchat-bot 側:
```
XCHAT_REPLY_URL=http://127.0.0.1:3020/reply
```
