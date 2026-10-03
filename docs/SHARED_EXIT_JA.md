# iPhoneとCloudflare投稿の共通VPN出口

通常のWARPと別に、固定IPv4のWireGuard出口へiPhoneと中継サーバーが接続するモードを追加しています。Cloudflare Workersは管理画面・D1・R2・Cron・Queueを担当し、X通信は認証付きHTTPS中継からVPNを通します。

## 必要なもの

- 日本の固定公開IPv4を持つWireGuard出口。LinuxとWireGuard、iptables/ip6tablesを使用します。
- Docker/Gluetunを動かす中継先。中継の出口は上記WireGuardです。中継自体の所在地を揃えるだけでなく、両者を同じVPN出口へ接続します。
- 中継を公開するHTTPS URL。`/fetch`と`/healthz`を同じホストから公開します。認証ヘッダーはリバースプロキシで保持してください。8788はホストの127.0.0.1にのみ公開します。
- iPhoneのWireGuardアプリ。WARPは共通出口モードでは使いません。
- CloudflareのアカウントとD1/R2/Queuesが使える環境。

WorkersだけでVPN出口まで提供する構成ではありません。配置先・公開IP・認証情報がないため、実サーバーの作成や公開はまだ行っていません。無料枠や多数ユーザーでの容量を保証するものでもありません。

## 1. 接続設定を生成

Node.js 24以上で、次を実行します。例示のIPは実際の固定公開IPv4に置き換えます。`eth0`もVPN出口Linuxの外向きインターフェースに合わせます。

```bash
node tools/create-shared-exit.mjs --endpoint-ip 203.0.113.8 --exit-ip 203.0.113.8 --country JP --public-interface eth0 --out shared-exit-config
```

`wg0.conf`（出口）、`iphone.conf`（端末）、`gateway.conf`（中継）、`.env.shared-exit`（中継環境変数）、転送設定、iPhoneの出口照合設定を生成します。端末と中継は別の秘密鍵・別のトンネルIPを使います。既存の出力先は上書きしません。ファイルは0600、ディレクトリは0700です。秘密鍵と認証トークンをGitや公開URLへ置かないでください。

## 2. WireGuard出口を起動

VPN出口LinuxにWireGuardとiptables/ip6tablesを導入し、`wg0.conf`を`/etc/wireguard/wg0.conf`へ0600で配置します。生成した`99-xnekama-forward.conf`を`/etc/sysctl.d/`へ配置して`sysctl --system`を適用し、`wg-quick@wg0`を起動します。サーバー側・クラウド側のファイアウォールでUDP 51820を許可します。既存のファイアウォール方針と転送ルールの適合は配置先で確認してください。

この構成はIPv4の共通出口です。端末・中継はIPv6のデフォルト経路もトンネルへ送り、出口側でそのIPv6転送を破棄して別のIPv6出口に流れないようにします。IPv6接続先のフォールバックやiOSの実経路は実機で検証が必要です。実際に同じIP・国が返らない場合はXを解除せず、投稿もしません。

## 3. VPN中継を起動

`.env.vpn.example`を`.env`へコピーし、生成した`.env.shared-exit`の値を反映します。`ADMIN_PASSWORD`と`APP_SECRET`（32文字以上）も設定します。

```bash
docker compose --env-file .env -f compose.vpn.yml --profile gateway up -d --build vpn egress
```

VPN中継はGluetunとネットワーク名前空間を共有し、ファイアウォールでトンネル外への送信を遮断します。`X_EXIT_MODE=shared`では、tun0・Gluetunのヘルス・HTTPS Cloudflare traceのIPv4と国を確認します。IPの変化や他国の出口、確認失敗ではXを送信しません。HTTPS公開後、認証ヘッダー付き`GET /healthz`が`ok:true,mode:shared,ip:設定IP,country:JP`になることを確認します。認証トークンなしでは401です。

## 4. Cloudflareへ配置

中継と同じトークン・固定IP・国コードを環境変数に設定します。`X_EGRESS_URL`は公開した中継の`https://.../fetch`です。

```text
X_EGRESS_URL=https://your-gateway.example/fetch
X_EGRESS_TOKEN=生成したトークン
X_EXIT_MODE=shared
X_EXIT_IP=実際の固定公開IPv4
X_EXIT_COUNTRY=JP
```

`node cloudflare/setup.mjs`は中継の出口一致を確認してからCloudflareの資源を作成・配置します。自動生成されるWorker設定にも出口モード・IP・国を保存します。既存の配置では同じ変数をwrangler設定へ反映して再配置してください。`--doctor`は保存済み設定を使いますが、実行環境に中継トークンがない場合は実接続確認を省略した旨を表示します。

各Xリクエスト前にWorkerから中継のヘルスも確認します。中継でも送信直前にVPNと出口を検査します。失敗時の予約は既存のVPN待機処理で再開を待ちます。

## 5. iPhoneを接続

WireGuardアプリへ`iphone.conf`を安全に転送して取り込み、初回のVPN構成追加を許可します。接続をONにします。Xの黒いロック画面の「共通VPN出口を設定」、または投稿画面の✦から、生成した`iphone-settings.json`と同じ固定IPv4・国コードを入力します。

共有出口の確認では、HTTPS traceのIP・国一致と稼働中utunが必要です。設定変更時は以前の確認を失効します。不一致・確認待ち・失敗中は黒い画面と通信保留を維持します。初回に画面が隠れていても出口設定は変更できます。通常WARPモードへ戻す操作もあり、自動でVPNをONにする機能ではありません。

## 実運用前の確認

- iPhoneと中継で同じIPv4・JPが観測されること。どちらかのIPが変わった際に解除されないこと。
- WireGuard切断・出口停止・国不一致で、画面のロックと投稿待機が維持されること。
- 中継トンネルを落として、Gluetunのトンネル外通信遮断を実際のパケットで確認すること。
- Cloudflare予約が端末を閉じた後も実行され、VPN復旧で再開すること。
- SideStore再署名後の画面、ログイン、Grok、通知設定を確認すること。

テストは判定・キー整合・生成ファイル・模擬通信の回帰確認です。実VPN、Docker、iPhoneでの確認は未完了です。traceは照合先への出口を確認するもので、Xへの全通信経路や通信漏れゼロの証明ではありません。GPS位置を変更するものでもなく、Xの追加認証を防ぐ保証もありません。
