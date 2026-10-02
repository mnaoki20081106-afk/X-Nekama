# X-Nekama iOS layer

X 12.29（build 20）の復号済みIPA向けの文章中心の前面自動運用です。SideStoreで再署名するIPAを作成できます。

## サーバー予約管理

投稿画面の `✦` →「Core URLを設定」でHTTPSの管理画面URLを保存し、「投稿予約・カレンダー・生成設定」から開きます。カレンダー、口調・絵文字・カスタム指示、お手本投稿を管理できます。サーバーに承認済みの予約は端末を閉じても送信します。VPN付きLinuxサーバーの準備とX Webセッションの接続が別途必要です。詳細は `docs/SERVER_VPN_JA.md`。

既存の端末自動運用は前面限定です。サーバー管理画面を開くと端末側の自動運用を停止します。今回の変更はサーバーの配置やVPN設定、SideStore実機の動作確認まで完了したものではありません。

## 実装した流れ

1. Xの投稿画面の `✦` →「文章中心の自動運用」を開く。
2. お手本の `@ID` とキャラクターの口調・趣味などを保存する。
3. App Store版WARPを別途インストールし、1.1.1.1モードではなくWARPを接続する。
4. 「お手本の投稿を取得」でX自身のプロフィール画面を開く。実際のProfileTimeline応答から著者の投稿を保存し、返却されたカーソルでページ送りする。
5. 「自動運用を開始」。内蔵Grokを使い、取得した履歴から広く抽出したサンプルを参考に独自の短文を作る。初回、ネイティブのスタイルが見つからない場合だけGrok画面でスタイルを選択する。
6. 生成完了を読み取り、長さ・完全一致のコピー・履歴との重複をチェックして保存する。
7. 投稿間隔を取得した履歴の時刻から推定する。低頻度の運用ではお手本の投稿時間帯も参考にする。
8. 投稿時刻になったらX自身のComposerから送信し、返却された本文・著者・投稿IDで結果を確認する。

画像生成・有料xAI API・共有AIキーはこのモードでは使いません。既存Core/Web版の機能は別の経路として残っています。

## 必ず区別すること

**実装・ビルド確認済みであり、実機での一連の動作は未検証です。** SideStore再署名後のログイン、内蔵Grokの利用資格、SwiftUIの実行時の反映、ProfileTimelineの応答形、OAuth再署名、CreateTweetの返却形は実機で確認が必要です。動かない経路を確認済みとして扱わず、状態画面へ理由を表示します。

- アプリを前面で開いている間に動作します。バックグラウンドへ移行すると停止します。
- 取得対象はXがログイン中の利用者へ返した著者本人の投稿・返信です。返却されない過去投稿、削除投稿、閲覧権限のない投稿は取得できません。分析へ送るサンプルは最大60件です。
- 「終端に到達」は返却ページの終端であり、過去の全投稿の取得保証ではありません。通信障害・カーソル反復・次ページ経路不明は中断として表示します。
- 429、利用上限、Grokへの追加ログイン、認証変更を回避・強制解除しません。
- 投稿結果不明の場合は端末再起動後も自動再送しません。Xで確認し、「投稿されていた／されていなかった」を選んで解除します。
- 運用ONは自動で復元しません。設定、参考投稿、履歴、未確認の送信状態だけ保存します。

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
