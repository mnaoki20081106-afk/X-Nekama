# Cloudflare完全自動予約 — 初回セットアップ（WARP egress必須）

この機能は **完全自動の予約投稿が欲しい人だけ** 設定します。

通常のX-Nekama利用、Grok文章生成、Grok画像生成にはCloudflareは不要です。

予約投稿をサーバー側から実行する場合、X向け通信は直接Workerから出さず、**WARP接続済みのVPN egressホスト**を必ず経由します。先に `docs/VPN_EGRESS_JA.md` の手順で `https://.../fetch` を用意してください。

## 何が自動化される？

セットアップスクリプトが自動で以下を行います。

- Cloudflareログイン確認
- D1データベース作成
- R2画像保存領域作成
- R2の `r2.dev` 公開URLをOFF
- Queue作成
- Dead Letter Queue作成
- 予約投稿Cron設定
- VPN egressのWARP接続確認
- VPN egress共有SecretのWrangler Secret登録
- Xセッション暗号化鍵を安全に生成
- D1 migration
- Workerデプロイ
- `workers.dev` URLを自動取得
- PUBLIC_BASE_URLへ自動反映
- 再デプロイ
- 最終疎通確認

**D1 IDをコピーしたり、R2 bindingを書いたり、Xセッション暗号鍵を手で作る必要はありません。** ただしVPN egressのURLと共有Secretは必要です。

## 必要なもの

1. Cloudflareアカウント
2. WindowsまたはMacのPC
3. Node.js 24以上
4. 常時起動できるWARP接続済みegressホスト
5. egressのHTTPS URL（`https://.../fetch`）
6. 24文字以上の `X_EGRESS_TOKEN`

X DeveloperアカウントやxAI APIキーは不要です。

---

# 一番簡単な方法

## 0. VPN egressを起動

`docs/VPN_EGRESS_JA.md` の手順でegressを起動し、次の2つを控えます。

```text
X_EGRESS_URL=https://vpn.example.com/fetch
X_EGRESS_TOKEN=十分長いランダムSecret
```

`/healthz` が `{"ok":true,"warp":"verified"}` を返してからCloudflareセットアップへ進みます。

## 1. X-NekamaをPCへ保存

GitHubからX-NekamaをZIPで取得して展開します。

## 2. `cloudflare` フォルダを開く

### Windows

`setup-windows.cmd` をダブルクリック。

### macOS

初回だけターミナルで:

```sh
cd X-Nekama/cloudflare
chmod +x setup-macos.command
./setup-macos.command
```

またはWindows/macOS共通で、egress設定を環境変数へ入れてから実行します。

macOS/Linux:

```sh
cd X-Nekama/cloudflare
export X_EGRESS_URL='https://vpn.example.com/fetch'
export X_EGRESS_TOKEN='共有Secret'
node setup.mjs
```

PowerShell:

```powershell
cd X-Nekama/cloudflare
$env:X_EGRESS_URL='https://vpn.example.com/fetch'
$env:X_EGRESS_TOKEN='共有Secret'
node setup.mjs
```

## 3. Cloudflareへログイン

ブラウザが自動で開きます。

Cloudflareで:

1. ログイン
2. X-NekamaのWranglerアクセスを許可
3. ブラウザを閉じてOK

ここだけ利用者の操作が必要です。

Wranglerは対応環境ではOSキーチェーンを使う安全なログイン方式を優先します。

## 4. あとは自動

ターミナルに以下のような表示が出るまで操作不要です。

```text
[X-Nekama] セットアップ完了

公開URL:
  https://x-nekama-xxxx.example.workers.dev
```

セットアップ成功時は、このURLを自動でクリップボードへコピーします。改造Xの **✦ Nekama → Cloudflare連携・接続先 → 作成済みサーバーに接続** に貼り付けます。以後は **✦ Nekama → 投稿予約・カレンダー・生成設定** から自分のCloudflare環境へ入れます。

---

# 自動作成されるもの

ユーザーごとにランダムなsuffixを付けるため、既存Cloudflareリソースと衝突しにくくしています。

例:

```text
Worker: x-nekama-a1b2c3
D1:     x-nekama-db-a1b2c3
R2:     x-nekama-media-a1b2c3
Queue:  x-nekama-tasks-a1b2c3
DLQ:    x-nekama-dlq-a1b2c3
```

## D1

保存:

- X-Nekama利用者情報
- 暗号化済みXセッション
- キャラクター設定
- 投稿案
- 予約
- お手本分析
- ジョブ状態

## R2

保存:

- 顔基準画像
- スマホケース
- 服装/背景
- お手本画像
- Grok生成画像

R2は公開URLを自動でOFFにします。

## Queue

- 予約時刻を迎えた投稿
- XActionsによる投稿
- 参考投稿取得

## Cron

1分ごとに予約投稿を確認します。

AI生成はCloudflare上で行いません。

---

# 暗号鍵について

利用者が暗号鍵を作ったり保存したりする必要はありません。

初回利用時にWorkerが32バイトのランダム鍵を生成し、**公開されていないR2内部オブジェクト**へ保存します。

- D1には暗号化済みXセッションだけを保存
- 暗号鍵はD1とは別のprivate R2へ保存
- その内部オブジェクトを取得する公開APIは作らない
- R2のr2.dev公開URLもセットアップ時にOFF

CloudflareアカウントやR2 bucket自体を削除すると保存済みXセッションは復号できなくなります。その場合はXアカウントを再接続してください。

---

# エラーが出た場合

まず:

```sh
cd X-Nekama/cloudflare
node setup.mjs --doctor
```

を実行します。

診断内容:

- Cloudflareログイン
- wrangler.toml
- D1
- R2
- Queue
- 公開Worker URL
- X-Nekama API応答
- X_EGRESS_TOKEN Secretの存在
- `X_EGRESS_TOKEN`を環境変数でも渡した場合はegressのWARP状態

すべて正常なら:

```text
[X-Nekama] OK: https://...
```

と表示されます。

---

# 再セットアップ

同じフォルダで再度:

```sh
node setup.mjs
```

を実行して構いません。

既存の:

- resource名
- D1
- R2
- Queue
- 暗号鍵

をできる限り再利用します。

**暗号鍵は勝手にローテーションしません。**

---

# Cloudflareを使わない場合

何もしなくてOKです。

利用可能:

- Xアカウント管理
- キャラ設定
- 浮上頻度
- お手本画像
- 端末X/Grokで文章生成
- 端末X/Grokで画像生成
- XActions投稿

制限:

iOSのバックグラウンド制約により、アプリを閉じた状態で指定時刻ぴったりの予約投稿は保証できません。

Cloudflare self-hostとWARP egressを設定すると、端末が閉じていても予約投稿を実行できます。WARP未接続中は投稿せず、予約状態を維持して復旧後に再試行します。

---

## 現在のCloudflare Free枠の目安

2026年9月時点の公式Free枠:

- Workers: 100,000 requests / day
- D1: 5,000,000 rows read / day
- D1: 100,000 rows written / day
- D1 storage: 5 GB
- Queues: 10,000 operations / day
- R2 Standard storage: 10 GB-month / month
- R2 Class A: 1,000,000 operations / month
- R2 Class B: 10,000,000 operations / month
- R2 egress: free

この用途の個人運用では通常かなり小さい利用量になりますが、**無料を永久保証するものではありません**。Cloudflareの料金・無料枠は今後変更される可能性があります。

Workers Free / D1 Freeは上限到達時に処理が失敗・停止する方式です。R2はアカウントの課金設定と超過利用量によっては料金が発生し得るため、Cloudflare DashboardのUsageも確認してください。

# 費用

X-Nekamaは以下を要求しません。

- X Developer API
- xAI API
- 運営者所有の有料投稿API

Cloudflare自体の料金体系・無料枠はCloudflare側で変更される可能性があります。
セットアップスクリプトが有料プランへ勝手に変更することはありません。

---

# アンインストール/停止

アプリ側の接続解除だけでは、サーバーへ保存した予約は停止しません。管理画面で予約を解除するか、Cloudflare側でCron/Queue/Workerを停止してください。

Cloudflareリソース自体を削除する場合は、誤操作でデータを失わないよう**自動削除機能は用意していません**。
Cloudflare Dashboardから本人が確認して削除してください。
