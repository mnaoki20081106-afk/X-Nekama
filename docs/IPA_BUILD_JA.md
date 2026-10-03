# GitHub Actionsで完成IPAを作る

`iOS IPA Build`（`.github/workflows/ios-tweak.yml`）は、Theosビルドとネイティブテストに加え、元IPA取得 → X 12.29互換性検証 → 最新tweakの組み込み → 完成IPAのCRC・組み込み検証 → SHA-256生成 → Artifacts保存を行います。

元ファイルはDriveの「X-Nekama」フォルダー内の `X.ipa`（ID: `1sjlSvgpnobrW0ycn-P-DYr7371HaIkGG`）です。Cloudflare WARPのIPAは使用しません。元IPAそのものやGoogle認証情報はGitへ登録しません。

## 元IPAの渡し方

完成IPAを毎回自動で作る場合は、Google Driveのサービスアカウント方式を推奨します。

1. Google CloudでGoogle Drive APIを有効にします。
2. ビルド専用サービスアカウントを作成し、JSONキーを発行します。
3. Driveの元 `X.ipa` だけを、そのサービスアカウントの `client_email` に「閲覧者」で共有します。
4. GitHubの **Settings → Secrets and variables → Actions → New repository secret** を開きます。
5. 名前を `GOOGLE_DRIVE_SERVICE_ACCOUNT_JSON`、値をJSONキー全文として保存します。

サービスアカウントを使わない一時ビルドでは、**Actions → iOS IPA Build → Run workflow** の `source_ipa_url` に短命なHTTPSダウンロードURLを指定できます。URLはログへ明示的に出力しません。永続的な認証トークンやパスワードをこの入力へ入れないでください。

どちらの元IPA経路も無い場合、Workflow自体は失敗させません。Theosビルドと各テスト、`X-Nekama-tweak` artifactまでは実行し、完成IPA工程のみスキップしてSummaryに理由を表示します。

## 検証

Drive経路では読み取り専用スコープを使い、Driveのサイズ・MD5・ZIP CRCを検証します。HTTPS経路でもダウンロード後に `verify_ipa.py` を実行します。どちらの場合もX 12.29（build 20）、暗号化解除状態などの検証を通った元IPAだけを使用します。

IPA注入ツール `pyzule-rw` はmacOS runnerのsystem Pythonへ直接インストールせず、専用venvへ固定コミットから導入します。これによりHomebrew PythonのPEP 668制約に影響されません。

## 実行とダウンロード

1. **Actions → iOS IPA Build → Run workflow** を開き、`main` を選びます。
2. 完成IPAを作る場合は `build_ipa` をオンにします。Drive Secretが設定済みなら追加入力は不要です。未設定なら `source_ipa_url` を指定します。
3. 成功したRunの **Artifacts → X-Nekama-IPA** をダウンロードします。
4. ZIP内の `X-Nekama-X12.29.ipa` と `.sha256` を確認し、IPAをSideStore等で署名・インストールします。

元IPAや認証情報はActionsキャッシュへ保存しません。ForkからのPRにはSecretを渡さず、元IPAが無い場合はtweakとテストだけを検証します。

完成IPA artifactは現在1日保持します。既存の `X-Nekama-tweak`（deb）も保存されます。IPAの公開Releaseへの自動公開は行いません。Actions上のビルド検証成功は、iPhone実機上の全機能動作まで保証するものではありません。
