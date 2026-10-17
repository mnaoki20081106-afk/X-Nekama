# xchat-bot + RiriCore

DMの送受信はこのボットが担当する。

## 動かし方

1. RiriCoreを動かす（`node riri-core/index.mjs` またはクラウド）
2. 環境変数を設定
   ```
   XCHAT_REPLY_URL=http://riri-core:3020/reply
   ```
3. xchat-botを起動
   ```
   node index.mjs
   ```

## クラウドで動かす場合（PCなし）

- Modalの無料クレジットまたはCloudflare WorkersでRiriCoreを動かす
- 取得したURLを `XCHAT_REPLY_URL` に設定
- xchat-botも同じクラウドまたは別サービスで動かす

IPA側は設定画面でこのURLを入れるだけで良い。
