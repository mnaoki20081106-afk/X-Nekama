# X-Nekama iOS layer

X 12.29（build 20）の復号済みIPA向けの文章中心の前面自動運用です。SideStoreで再署名するIPAを作成できます。

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

実装したのは、別途接続したWARPについてCloudflare traceの `warp=on/plus` と稼働中のutunを確認し、未確認なら自動取得・生成・投稿を待機させる機能です。SideStore自身のローカルVPNだけでWARP接続と誤判定しません。

これはOS全体のキルスイッチではありません。X全体の通信の完全遮断、WARPの自動ON、切断直後の通信漏れゼロは保証しません。「アプリを開いている間のWARP自動接続」はまだ未実装です。WARPの画面を開く導線のみ用意しています。IPを偽装するHTTPヘッダーなどは追加していません。

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
