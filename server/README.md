# 常時稼働する投稿サーバー

iPhoneは管理画面です。NodeサーバーがSQLiteへ予約を保存し、端末を閉じても予約処理を30秒間隔で実行します。サーバー・WARP・Xセッションが稼働している必要があります。停止期間に15分以上過ぎた投稿は送らず要確認にします。結果不明の送信は自動再送せず、再起動しても結果未確認状態を残します。

## Linuxでの配置

Ubuntu/DebianのVPSへNode 24以上、nftablesとCloudflare公式Linux WARPをインストールしてください。公式手順: https://developers.cloudflare.com/warp-client/get-started/linux/

ソースを `/opt/xnekama` に配置し、次を実行します。

```sh
cd /opt/xnekama
npm ci --omit=dev
sudo apt-get install nftables
sudo env PLAYWRIGHT_BROWSERS_PATH=/opt/xnekama-browsers npx playwright install --with-deps chromium
sudo ./server/install-service.sh
warp-cli registration new
warp-cli mode proxy
warp-cli proxy port 40000
warp-cli connect
curl --socks5-hostname 127.0.0.1:40000 https://www.cloudflare.com/cdn-cgi/trace
```

`warp=on` または `warp=plus` を確認します。WARPのCLIバージョンによって登録・モードのサブコマンドが異なる場合は `warp-cli --help` と公式手順を確認してください。`/etc/xnekama.env` の管理パスワードを取り出して使います（Gitへ追加しない）。Caddy/Nginx等でHTTPSを `127.0.0.1:3000` に転送してから `sudo systemctl start xnekama` で起動します。管理画面でXアカウントを登録・接続し、運用ON、予約日時を保存してください。アプリのカレンダーボタン→「接続先」でHTTPS URLを登録し、ログインします。

NodeのX通信はundiciのSOCKS5専用dispatcherへ固定し、接続失敗時に直接接続へ切り替えません。認証・取得・投稿前に同じプロキシ経由のCloudflare traceを確認します。既存のCloudflare Workers経路は別の配置方式で、今回のLinux設定を自動適用しません。

サービスの `ExecStartPre` はnftablesルールの適用に失敗すると起動を失敗させます。専用UID `xnekama` からの通信はWARPのローカル40000ポートと管理画面への応答だけを許可し、IPv4/IPv6の直接接続・DNS通信を拒否します。WARP自体は別のUIDで動きます。手動 `npm start` や別UIDでの実行にはOSルールは適用されません。Docker経路を使う場合も共有ネットワーク・UIDに応じた別途設定が必要です。

## 投稿生成

iPhoneに内蔵されたGrokの実行はサーバーへ移せません。サーバー側はログイン済みXのWeb版GrokをPlaywrightで操作する実験的経路です。有料APIキーは使いません。`SERVER_GROK=1` を設定して再起動した後、管理画面でお手本を選択、取得、口調・絵文字・追加指示を保存し、「サーバーGrokで投稿文を自動補充」「自動承認」「運用ON」を有効にします。未処理の投稿がなくなると最大21件ずつ補充します。画像は生成しません。

Web版GrokのDOMはXActions公開ソースのselectorを根拠にしていますが、実アカウントで未検証です。ログイン壁、利用資格、追加認証、上限、DOM変更、未完了JSONは停止理由になり、架空の生成成功を返しません。完全自動での実稼働確認には実セッションが必要です。生成中に設定や運用ONが変わった場合、古い設定で予約を作りません。生成処理は送信タイマーを塞ぎません。

## 情報源と検証

「情報源」でカスタム設定と取得済み本文をテキストとして確認できます。生成には範囲を広く抽出した投稿（最大60件・本文合計20000文字）と最近の履歴を渡します。取得できなかった投稿まで全件取得と表示しません。端末の旧取得済みデータはアプリの「取得済み投稿を同期」で同じユーザー名のサーバーアカウントへ送れます。新しい取得・設定・予約はサーバー管理画面で完結します。

`npm test` は予約処理、VPN判定、直接接続へのフォールバック禁止、ソース抽出を検証します。iOS UI、WARP常時接続、Xへの本番投稿、Web版Grokの実通信は別の実機・サーバー確認が必要です。配置先のURL/SSH情報はこの作業にはまだ提供されていないため、コードの完成をデプロイ完了とは扱いません。
