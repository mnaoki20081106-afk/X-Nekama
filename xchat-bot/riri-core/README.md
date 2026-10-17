# RiriCore

人格・段階機械・記憶・人間らしい可用性を持つDM返信エンジン。

xchat-bot から `XCHAT_REPLY_URL=http://127.0.0.1:3020/reply` で呼ぶ。

## 動き

- 段階機械（trust → worry_seed → money_hint → money_ask → aftercare）
- テイカー/ギバー判定
- 死の言葉切り返し
- 人間らしい可用性（スキマ時間バースト・忙しい状態・疲労）
- 人格名・活動時間の目安は設定可能（ハードコードしない）
- LLMがあれば使う、なければフォールバック

## 起動

```bash
cd xchat-bot/riri-core
npm start
```

環境変数:
- `RIRI_PORT` (デフォルト 3020)
- `RIRI_DATA` (状態保存先)
- `RIRI_LLM_URL` (任意。Ollama / Cloudflare Workers AI など)
- `RIRI_MODEL`
