# X-Nekama iOS tweak layer

X公式iOSアプリへX-NekamaのUIを追加するためのTheos tweakです。

## 検証したIPA

2026-09-27に提供されたIPAを解析した結果:

- App: X
- Version: 12.29 (build 20)
- Bundle ID: `com.atebits.Tweetie2`
- Minimum iOS: 15.0
- Main binary: arm64
- Main binary and inspected major frameworks: `LC_ENCRYPTION_INFO_64 cryptid 0` (decrypted)

X 12.29内で確認できたGrok関連要素:

- `T1GrokTextPostComposerController`
- `T1GrokImagePostComposerContainer`
- `GrokAPIClient`
- `GrokImagineSessionManager`
- `GrokImagineComposerButton`
- `twitter://grok`
- `twitter://imagine`
- `https://www.x.com/i/grok?text=`

## 現在の実装

投稿Compose画面を、クラス名と `T1ComposeRichTextView` の存在から実行時に検出し、右下にNekamaボタンを表示します。

ボタンから:

1. 現在の下書き + NekamaプロファイルをGrok用プロンプトに変換してGrokを開く
2. X内のGrok Imagineを開く
3. 年齢・所在地・性格・口調の簡易プロファイルを保存
4. 顔写真・スマホケース画像をアカウント別に保存
5. 登録画像をXネイティブのGrok Imagine Lightboxの `sourceImages` 経路へ渡して画像編集を開始

内部private APIを直接呼び出す前に、まずこの薄い統合層でX 12.29上の注入・UI表示・Grok遷移を確認する設計です。

## Build

Theosとcyanを用意し、復号済みIPAを次の名前で置きます。

```
ios-tweak/packages/com.atebits.Tweetie2.ipa
```

Then:

```sh
chmod +x build.sh
./build.sh --sideloaded
```

出力:

```
packages/X-Nekama-sideloaded.ipa
```

インストール時の署名はSideStore / AltStore等の通常のサイドロード環境で行ってください。

## 次の段階

- Xの現在アカウントとX-Nekamaプロファイルの1:1紐付け
- 顔写真・スマホケース以外の複数カテゴリ参考画像ライブラリ
- Grokの文章生成結果はCompose本文へ戻すブリッジを実装済み
- Grok Imagine生成画像はX本体の `grokImaginePresentationManagerAttachmentDidAdd:asset:withPrompt:` → `addOrReplaceAttachment:animated:` 経路でComposeへ戻ることをX 12.29バイナリで確認済み
- 登録済み顔/スマホケース画像はGrok Imagine LightboxへsourceImagesとして渡すブリッジを実装済み
- 既存のX-Nekama投稿キューとの連携

Xの内部クラス・feature switchへ直接依存する箇所は、バージョン更新で壊れやすいため、X 12.29の実体確認を行ってから段階的に追加します。
