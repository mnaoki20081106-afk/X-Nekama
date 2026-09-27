# X-Nekama iOS tweak layer

X公式iOSアプリの投稿ComposerへX-Nekamaの入口を追加するTheos tweakです。

## 検証対象

2026-09-27に提供された復号済みIPAを実バイナリから解析しています。

- App: X
- Version: 12.29 (build 20)
- Bundle ID: `com.atebits.Tweetie2`
- Minimum iOS: 15.0
- Main binary: arm64
- Main binary: `LC_ENCRYPTION_INFO_64 cryptid 0`

### X 12.29で実在確認できた接続点

`XAppLibraries.framework` / `XServiceLibraries.framework` のMach-Oシンボル・文字列から次を確認済みです。

- `T1ComposerThreadViewController`
- `Grok.GrokImagineComposerButton` / `_TtC4Grok25GrokImagineComposerButton`
- `Grok.GrokImagineComposerToolbarButton` / `_TtC4Grok32GrokImagineComposerToolbarButton`
- `Grok.GrokImagineComposePromptInput`
- `Grok.GrokImaginePresentationManager`
- `Grok.GrokImagineImageGenSession`
- `Grok.GrokImagineSessionManager`
- `grokImagineComposePromptInputDidSubmit:`
- `grokImaginePresentationManagerAttachmentDidAdd:asset:withPrompt:`
- `grok_composer_imagine_is_enabled`
- `grok_imagine_composer_enabled`
- `grokPostComposerEnabled`
- `GROK_POST_COMPOSER_ENHANCE_USER_POST`
- `postComposerTextGen`
- `postComposerImageGen`
- `postComposerImageGenWithPrompt`
- `https://www.x.com/i/grok?text=`
- `twitter://grok`
- `xai-grok://imagine`

以前の試作にあった以下の名前は、提供IPAから存在確認できなかったため現在の実装では使用しません。

- `T1GrokTextPostComposerController`
- `T1GrokImagePostComposerContainer`
- `GrokAPIClient`
- `T1TweetComposeViewController`
- `TFNTwitterComposition`
- `twitter://imagine`
- `_t1_openGrokImagineViewControllerWithInitialPrompt:`

## 現在の実装

private Frameworkへ静的リンクせず、Objective-C runtimeでComposerを検出します。

Composer判定は:

- `ComposerThreadViewController` / `TweetCompose` 系クラス名
- `TweetComposeSingleTweetViewControllerProtocol` への適合

を実行時に確認します。

Composer画面には右下に `✦` Nekamaボタンを追加します。

### Grokで投稿文を作る

まず現在のComposer/子ViewController/UIControlから `postComposerTextGen` を実行時探索し、X自身のネイティブGrok投稿文生成が見つかった場合だけそれを起動します。見つからない場合に限り、X 12.29自身に含まれる `https://www.x.com/i/grok?text=` ルートへフォールバックします。存在確認できていないprivate initializerは呼びません。

### Grokで画像を作る

まず `postComposerImageGenWithPrompt` / `postComposerImageGen` を現在のComposer・子Controller・UIControl target-actionから実行時探索します。見つからない場合は現在のComposerのView hierarchyから、X自身の

- `GrokImagineComposerButton`
- `GrokImagineComposerToolbarButton`

を検索します。実際に表示されているネイティブボタンが見つかった場合だけ `UIControlEventTouchUpInside` を送って起動します。

ボタンがFeature Flagなどで存在しない場合は、Grokルーターへ画像生成指示を渡すフォールバックに切り替えます。

### ランタイム診断

Nekamaメニューの「ランタイム診断」で以下を表示できます。

- Xのバージョン/build
- 実際にフックされたComposer class
- Grok Imagine関連classの存在
- 現在Composer上にあるネイティブImagine button
- `grokImagineComposePromptInputDidSubmit:` 実装class
- `grokImaginePresentationManagerAttachmentDidAdd:asset:withPrompt:` 実装class
- `postComposerTextGen` / `postComposerImageGen` / `postComposerImageGenWithPrompt` 実装class

X更新時はこの診断結果を基準に追従します。


## 実運用モード（推奨）

X 12.29 の内部Grok実装はアップデートで変更される可能性があるため、実運用の既定経路は **X-Nekama Core + xAI公式API** です。

Composer上の `✦` ボタンから:

1. `X-Nekama Coreを開く`
2. 初回だけCore URLを設定
3. 同じXアプリ内のSafariシートで管理画面を開く
4. Grok 4.7で投稿文生成
5. Grok Imagineで画像生成
6. X-Nekamaの永続キューへ予約
7. X投稿

X内蔵Grokのruntime連携は `（実験）` 表記にし、利用可能なネイティブUIが存在する場合だけ起動します。Feature Flagや認証条件を強制解除しません。

この分離により、XのGrok内部クラスやselectorが変わっても、Core側の生成・画像・予約・投稿エンジンは継続して利用できます。

## Build

Theosを用意して:

```sh
cd ios-tweak
make clean
make package
```

GitHub Actionsの `iOS Tweak Build` でも `.deb` を生成します。

IPAへ注入する場合は、利用者が用意した復号済みIPAへ `XNekama.dylib` を組み込み、利用者自身の署名環境で再署名します。X公式IPA本体はこのリポジトリには保存しません。

## 次の段階

1. 実機でNekamaボタンとX内蔵Imagine起動を確認
2. ランタイム診断からX 12.29の実Composer classを確定
3. `postComposerTextGen` が実機Composer上で起動することを確認し、生成結果の反映経路を観測
4. Grok文章生成結果を同じComposerへ戻す経路を実バイナリ/実機イベントから確定
5. `grokImaginePresentationManagerAttachmentDidAdd:asset:withPrompt:` を観測し、画像生成完了をNekama Coreへ同期
6. アカウント別Persona・顔・スマホケース・お手本画像をNekama Coreと接続
7. 投稿キューとComposerを接続

存在確認できていないprivate API名を推測で追加しない方針です。
