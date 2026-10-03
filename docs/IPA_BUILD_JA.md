# GitHub Actionsで完成IPAを作る

`iOS IPA Build`（`.github/workflows/ios-tweak.yml`）は、Theosビルドとネイティブテストに加え、Driveの元IPA取得 → X 12.29互換性検証 → 最新tweakの組み込み → 完成IPAのCRC・組み込み検証 → SHA-256生成 → Artifacts保存を行います。

元ファイルはDriveの「X-Nekama」フォルダー内の `X.ipa`（ID: `1sjlSvgpnobrW0ycn-P-DYr7371HaIkGG`）です。Cloudflare WARPのIPAは使用しません。元IPAやGoogle認証情報をGitへ登録しません。ChatGPTのDrive連携はActionsへ引き継がれません。

## 初回のみ必要な認証設定

1. Google Cloudの自分のプロジェクトでGoogle Drive APIを有効にします。
2. このビルド用のサービスアカウントを作成し、そのJSONキーを発行します。プロジェクトの管理者権限は不要です。
3. Driveの元 `X.ipa` だけを、サービスアカウントの `client_email` に「閲覧者」で共有します。「リンクを知っている全員」への公開は不要です。
4. GitHubリポジトリの **Settings → Secrets and variables → Actions → New repository secret** を開きます。
5. 名前を `GOOGLE_DRIVE_SERVICE_ACCOUNT_JSON`、値をJSONキーの全文として保存します。JSONはコミット・チャット・Workflowの入力欄へ貼り付けません。

取得はDrive APIの読み取り専用スコープで行い、Driveのサイズ・MD5・ZIP CRCを検証してから元ファイルを確定します。元IPAを差し替えた場合もX 12.29（build 20）、暗号化解除状態、必要なObjective-Cメソッドの検証を通る必要があります。

## 実行とダウンロード

1. **Actions → iOS IPA Build → Run workflow** を開きます。既存の `ios-tweak.yml` と同じWorkflowなので、現行の開発ブランチを選択して実行できます。変更がmainに入るまでは `codex/server-calendar-vpn-20261003` を選びます。
2. `build_ipa` をオンにして実行します。認証未設定の手動実行は明確なエラーで停止します。
3. 成功したRunの **Artifacts → X-Nekama-IPA** をダウンロードします。
4. ZIPを展開すると `X-Nekama-X12.29.ipa` と `.sha256` が入っています。IPAをSideStoreで署名・インストールします。

元IPAのダウンロードは毎回認証します。秘密情報や元IPAをActionsキャッシュへ保存しません。ForkからのPRにはSecretを渡さずtweakだけを検証します。通常のpush/PRでSecretがない場合はIPA工程をスキップし、RunのSummaryに「IPA未生成」と必要な設定を表示します。

完成IPAは7日間保持します。既存の `X-Nekama-tweak`（deb）も残ります。IPAの公開Releaseへの自動公開は行いません。ビルド検証の成功はiPhone実機の動作確認を意味しません。
