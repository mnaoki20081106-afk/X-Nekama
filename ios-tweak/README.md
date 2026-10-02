# X-Nekama iOS layer

X 12.29（build 20）の復号済みIPA向けの文章中心の前面自動運用です。SideStoreで再署名するIPAを作成できます。

## サーバー管理画面

通常のX画面の右下、投稿ボタンの上にカレンダーアイコンを追加しました。ここからHTTPSの投稿サーバーへ接続し、予約日時・本文・口調・絵文字・追加指示・お手本の取得を管理します。黒・白・青を使ったXに近い管理画面です。接続先は初回に「接続先」で入力し、サーバーの管理パスワードでログインします。

投稿はiPhoneのタイマーではなく常時稼働するサーバーへ任せます。旧端末内自動運用メニューは入口から外しました。端末内の内蔵Grok生成機能は補助的に残していますが、サーバーでの継続生成はWeb版Grokの実験的経路です。配置方法・限界は [server/README.md](../server/README.md) を確認してください。

予約はサーバー管理画面で保存・承認します。アプリを閉じてもサーバーが動いていれば処理されます。端末内に過去取得した投稿は「取得済み投稿を同期」で送信できます。WARP確認が失敗している端末では管理画面への入口も開きません。

**iOS画面とサーバーの実通信は未検証です。** ビルド成功・ローカルテスト・実際のWARP/X/Grok運用を区別します。サーバーを配置していなければ画面は接続待ちのままです。

## VPNについて

**WARPのバイナリは同梱していません。** 提供されたWARP 6.31.6のVPN拡張機能は `packet-tunnel-provider`、CloudflareのApp Group、CloudflareのKeychain Access Groupを使います。拡張機能のコピーだけではXの署名・共有領域・登録処理に移せず、SideStoreの再署名で権限が維持される保証もありません。

WARP接続を確認するまでX全体の画面を黒いロック画面で覆います。ロック画面の接続スイッチはWARPを開く導線で、WARP側でONにしてXへ戻ります。Xから他アプリが作ったVPN設定を直接ONにする処理や自動ONはありません。スイッチ表示だけで接続済みとは扱いません。

HTTPSのCloudflare trace（HTTP 200、最終URL一致、`warp=on/plus`）と稼働中のutunの両方で確認します。確認の有効期間は単調時計で4秒、再確認は2秒間隔・3秒タイムアウト、画面監視は0.25秒間隔です。起動、復帰、ネットワーク経路変更時は過去の確認を失効し、確認中・失敗・期限切れはロックします。バックグラウンド移行前も覆います。保存設定でVPN必須を解除できません。

観測したNSURLSessionTaskのresumeは確認済みの間だけ許可し、未確認時は送信せず保留します。接続確認用の専用traceリクエストだけ例外です。WARP確認後、保留中で未キャンセルのタスクをresumeするため、起動直後に止めた読込みも自動復帰させます。

**実機未検証で、OS全体のキルスイッチではありません。** 既に送信中の通信、NSURLSession以外のソケット、判定の間に起こる切断、別経路やスプリットトンネルによる通信漏れゼロは保証できません。traceでWARPが確認できてもX宛て通信すべてが同じ経路を通ることの証明ではありません。Xの画面を表示しない動作と通信漏れゼロを区別します。IP偽装ヘッダーは追加していません。

## 実バイナリで確認した接続点

- `T1GrokTextPostComposerController initWithAccount:initialText:onAcceptRevision:`
- `T1GrokTextPostComposerController` の `viewModel` ivar
- `GrokComposeViewModel.startCompose(originalText:style:)` のexportとarm64呼出規約
- `GrokComposeViewModel.cancelAll()` のexport
- `GrokComposeRevisionViewModel` の `originalText`, `style`, `_revisionChatItem`
- ChatItemの `status`, `text`, `isPartial`, `errorMessage`
- `TFNTwitterAccount authenticatedMutableURLRequestForURLRequest:parameters:error:`
- `TFNTwitterComposition initWithInitialText:mentionedUsers:`
- `T1TweetComposeViewController initWithAccount:compositions:inWindowScene:`
- `T1TweetComposeViewController _t1_didTapSendButton:`

以前のREADMEでこれらの一部を「存在しない」としていた説明を訂正しました。今回のIPAから実在を確認しています。固定メモリオフセットは使わず、実行時のメソッド型・ivar・Swift reflectionとexportを使います。Xのバージョンは12.29（20）に限定します。

## Build / test

TheosとiOS 16.5 SDK、Swift対応toolchain、cyan（pyzule-rw）を用意してください。

```sh
cd ios-tweak
IPA_PATH=/absolute/path/X.ipa ./build.sh --sidestore
```

`--sidestore` はWatchアプリと既存のApp Extensionsを除外し、X-Nekama.dylibを注入します。IPA本体やユーザーの署名情報はGitへ追加しません。

```sh
swiftc -module-name Grok NativeGrok.swift tests/NativeGrokTests.swift -o /tmp/native-grok-tests
/tmp/native-grok-tests
python3 verify_ipa.py /absolute/path/X.ipa
```

Node/Web側の回帰テストはリポジトリルートで `npm test`。iOS Tweak BuildでもSwiftの結果読み取りテストを実行します。
