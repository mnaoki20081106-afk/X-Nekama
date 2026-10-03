# X-Nekama VPN egress セットアップ

予約投稿をサーバー側から実行しつつ、X向け通信をCloudflare WARP経由に限定するための構成です。

## 仕組み

- Node版: X-Nekama本体を動かすホスト自身をWARPへ接続します。XActionsの各HTTPリクエスト直前にCloudflare traceを確認し、`warp=on` / `warp=plus` を確認できなければXへ送信しません。
- Cloudflare版: WorkerのCron/Queueは直接Xへ出ません。WARP接続済みの別ホストに置いた `vpn-egress.mjs` へ送り、そのホストからXへ出ます。
- VPN不足で予約時刻を迎えた場合は、投稿を失敗扱いにせず予約状態へ戻して60秒後に再確認します。VPN不足では通常の投稿再試行回数を消費しません。
- Xへ送信を開始した後に結果が不明になった場合は、重複投稿を避けるため自動再送しません。

## 1. WARP egress ホストを用意する

常時起動でき、Cloudflare WARPを接続できるLinux/Windows/macOSホストを1台用意します。

このホストでX-Nekamaを配置し、Node.js 24以上を使います。

WARP接続後、まずCloudflare traceが `warp=on` または `warp=plus` を返すことを確認してください。

## 2. egress用Secretを決める

24文字以上の十分長いランダム値を使います。例:

```sh
node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"
```

生成した値を `X_EGRESS_TOKEN` として保存します。GitHubにはコミットしません。

## 3. egressを起動する

```sh
export X_EGRESS_TOKEN='ここにSecret'
export X_EGRESS_HOST='127.0.0.1'
export X_EGRESS_PORT='8788'
npm run egress
```

サービス本体は `http://127.0.0.1:8788` で待ち受けます。

Cloudflare Workerから利用する場合は、このローカルHTTPサービスをCloudflare TunnelやHTTPSリバースプロキシで外部公開し、最終的に次のようなHTTPS URLを用意します。

```text
https://vpn.example.com/fetch
```

egressは転送先を `x.com` / `twitter.com` / `twimg.com` 系HTTPSホストに限定し、`X_EGRESS_TOKEN` が一致しない要求を拒否します。

## 4. WARP確認

公開URLが `https://vpn.example.com/fetch` の場合、ヘルスチェックは `/healthz` です。

```sh
curl -H "x-xnekama-egress-token: $X_EGRESS_TOKEN" \
  https://vpn.example.com/healthz
```

正常時:

```json
{"ok":true,"warp":"verified"}
```

WARPが切れている場合はHTTP 503になります。

## 5. Cloudflare版へ設定

セットアップスクリプトを実行する前に、egress URLと同じSecretを渡します。

macOS/Linux:

```sh
cd cloudflare
export X_EGRESS_URL='https://vpn.example.com/fetch'
export X_EGRESS_TOKEN='ここにSecret'
node setup.mjs
```

PowerShell:

```powershell
cd cloudflare
$env:X_EGRESS_URL='https://vpn.example.com/fetch'
$env:X_EGRESS_TOKEN='ここにSecret'
node setup.mjs
```

`setup.mjs` は最初に `/healthz` を確認し、WARP未接続ならCloudflareリソース作成へ進みません。WorkerにはURLを通常変数、SecretをWrangler Secretとして登録します。

既存Workerへ手動設定する場合:

```sh
npx wrangler secret put X_EGRESS_TOKEN --config wrangler.toml
```

そして `wrangler.toml` の `X_EGRESS_URL` を実際の `https://.../fetch` へ変更します。

## Node版だけで使う場合

Cloudflare Workerを使わず `npm start` だけで運用する場合、別のegressプロセスは不要です。X-Nekama本体を実行しているホストをWARPへ接続してください。

Node版のXActions通信も各リクエスト直前にWARPを確認し、未確認時は送信しません。

## 漏れ防止について

この実装はアプリ層で「WARP確認に成功した直後だけX向けリクエストを開始する」fail-closed設計です。ただし、確認と実リクエストの間の瞬間的な経路変化までOSレベルで完全に封じるものではありません。

より厳密にする場合は、egressホスト側でもWARPインターフェース以外からX向け通信を出せないルーティング/ファイアウォールを併用してください。
