# VPN経由のサーバー予約投稿

この構成は常時稼働するLinuxサーバー＋Docker Compose用です。iPhoneのXを閉じても、サーバーに承認済みの予約があれば投稿します。端末WARPとサーバーVPNは別々です。

## 起動

1. このリポジトリをサーバーへ取得する。
2. `.env.vpn.example` を `.env` へコピーする。
3. 管理パスワード、32文字以上の固定APP_SECRET、VPN提供元が発行したWireGuard設定を入力する。EndpointはIPアドレス、PrivateKey/PublicKey/Addressを対応する項目へ設定する。PresharedKeyは指定がある場合だけ入力する。VPNアプリのインストールや端末WARPの接続だけではサーバーVPNにはならない。
4. 次を実行する。

```sh
docker compose -f compose.vpn.yml up -d --build
docker compose -f compose.vpn.yml logs --tail=100
```

管理画面はホストの `127.0.0.1:3000` にのみ公開します。既存のHTTPSリバースプロキシからこのポートへ接続してください。管理画面URLと接続情報はGitHubに保存しません。SQLiteと画像はDocker volume `xnekama-data` に保存します。更新時は同じComposeで再ビルドしてください。`down -v` は保存データも削除するため使用しないでください。既存Node版からの移行では、停止・バックアップ後にSQLiteとassetsをvolumeへコピーし、同じAPP_SECRETを維持します。

## iPhoneで開く

Xの投稿画面の `✦` →「Core URLを設定」でHTTPS URLを保存します。「投稿予約・カレンダー・生成設定」から管理画面を開くと、最初にカレンダーを表示します。開くと端末の前面自動運用は停止します。端末側の未確認送信は保存したままなので、Xで投稿有無を確認してから予約を作成してください。

管理画面へログインし、キャラクターを追加してXのWebセッションを接続します。iOS版Xのネイティブ認証をサーバーへ自動移送する機能はありません。口調・絵文字・カスタム指示と、生成に使うお手本をキャラクターごとに設定します。お手本を追加して投稿を取得すると、本文・日時・文体分析がGrok用プロンプトに含まれます。生成は引き続き端末Grokで行い、返答を取り込んで予約を承認します。サーバーは有料AI APIを呼びません。

カレンダーは日本時間。投稿時刻を表示し、日付タップでその日の全投稿を確認できます。編集すると承認待ちへ戻るため、日時や本文変更後は再承認します。

## VPNと送信の扱い

アプリはGluetunと同じnetwork namespaceに入り、Gluetunのfirewallによるkill switchを使います。アプリにNET_ADMINは与えません。直接インターネットへ出る別ネットワーク、FIREWALL_OUTBOUND_SUBNETSの例外、firewall無効化を追加しないでください。

サーバーは毎回tun0のアドレスとGluetunのローカルhealthを確認します。Xログイン・プロフィール・参考取得・画像アップロード・投稿・GraphQL問い合わせIDの更新・transaction ID取得に同じVPN確認済みtransportを渡します。healthの検査間隔の間に切断しても、通信経路の遮断はGluetun側が担当します。アプリ側のhealth検査だけでkill switchを代替する設計ではありません。

VPN未接続の間、予約を失敗扱いにせず待機させ、投稿試行回数は増やしません。復旧すると次のスケジューラー処理（約30秒間隔）で期限到来分を処理します。送信後の通信断・応答不明は自動再送せず、管理画面でX上の結果を確認します。再起動しても送信中の投稿を自動で再送しません。XActionsの内部network retryを0に設定し、投稿送信後の隠れた再送を防ぎます。

通常の `npm start` ではVPNが未設定なのでX通信は停止します。既にホストWARPを用意した場合は `X_VPN_MODE=warp` で毎回WARP traceを確認する経路も使用できます。ただしtrace確認はホストのkill switchの代わりにはなりません。

Cloudflare版を使う場合は、WARP接続したLinuxサーバーで `X_EGRESS_TOKEN`（24文字以上）とHTTPSリバースプロキシを用意し、`npm run egress` でVPNゲートウェイを起動します。Workerへ `X_EGRESS_URL=https://.../fetch` と同じ `X_EGRESS_TOKEN` をsecretとして設定します。WorkerはXへ直接接続せず、VPN確認済みゲートウェイを通します。ゲートウェイの `/healthz` も同じ認証とHTTPSで到達できるようにし、D1 migration 0002を適用してください。VPN待機中の予約は残して復旧を待ちます。Gluetun側にWARPのWireGuard設定を用意した場合、`.env` に `X_EGRESS_TOKEN` を設定し `docker compose -f compose.vpn.yml --profile gateway up -d --build` で、kill switchと同じnetwork namespaceのゲートウェイを起動できます。8788はホストのloopbackにだけ公開します。一般のVPNはNode版投稿には使えますが、このCloudflare用ゲートウェイは既存仕様に合わせてWARP traceを要求します。この経路の実配置も未検証です。

## 稼働環境で必要な最終確認

VPN接続情報と公開先はまだ設定されていません。以下の実環境の確認は未完了です。

- VPN接続中に管理画面で「サーバーVPN接続済み」となること。
- 同じnetwork namespace内の出口IPがVPNのIPであること。
- トンネルを落とした際、外向き通信が遮断され、予約は待機・attempt_count据え置きになること。
- テスト用の自分のXアカウントで予約し、iPhoneのXを閉じて投稿IDまで確認できること。
- SideStore再署名後にメニューとVPNロックが実機で動くこと。

Dockerの未提供環境では構成ファイルの検査だけでは通信漏れを実証できません。一般公開の多数利用者向けの認証・負荷試験・複数ワーカー構成はこの管理者用Nodeサーバーとは別の作業です。

参考にした公式資料:

- https://github.com/qdm12/gluetun-wiki/blob/v3.41.0/setup/connect-a-container-to-gluetun.md
- https://github.com/qdm12/gluetun-wiki/blob/v3.41.0/setup/options/firewall.md
- https://github.com/qdm12/gluetun-wiki/blob/v3.41.0/setup/options/healthcheck.md
- https://github.com/qdm12/gluetun-wiki/blob/v3.41.0/setup/providers/custom.md
# 天気・時事に依存する投稿

生成プロンプトでは、未確認の天気・ニュース・災害・イベントや結果を推測で断定せず、予約日と地域を基準にするよう指示します。お手本の古い出来事を現在の状況へ流用しません。

Node/Cloudflareの送信直前に天気・時事の表現を検査し、該当する予約は送信せず「レビュー待ち」へ戻します。送信回数は増やさず、理由を投稿一覧へ表示します。状況に依存しない文章へ編集して再予約してください。同じ文を再承認すると再び保留します。端末の前面自動運用も同種の表現で一時停止します。

現在の対策は表現パターンによる保留で、最新情報との照合や全投稿の事実確認ではありません。天気・ニュース取得APIは未接続です。見逃しや過剰な保留、災害時に通常の日常投稿まで止められない限界があります。普通の趣味・好みの投稿は自動投稿を続けます。
