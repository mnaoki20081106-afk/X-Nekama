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

Drive認証・一時URLが無い場合は、同じリポジトリのmainで成功した、期限内の `X-Nekama-IPA` artifactを再ビルド元にします。既存IPAの `XNekama.dylib` を置き換え、ロード命令を追加しないため、二重注入を避けられます。利用できるartifactも無い場合は、元IPAの設定が必要というエラーで停止します。tweakだけを検証する場合は `build_ipa` をオフにします。

## 検証

Drive経路では読み取り専用スコープを使い、Driveのサイズ・MD5・ZIP CRCを検証します。HTTPS経路でもダウンロード後に `verify_ipa.py` を実行します。どちらの場合もX 12.29（build 20）、暗号化解除状態などの検証を通った元IPAだけを使用します。

IPA注入ツール `pyzule-rw` はmacOS runnerのsystem Pythonへ直接インストールせず、専用venvへ固定コミットから導入します。これによりHomebrew PythonのPEP 668制約に影響されません。

## 実行とダウンロード

1. **Actions → iOS IPA Build → Run workflow** を開き、`main` を選びます。
2. 完成IPAを作る場合は `build_ipa` をオンにします。Drive Secretが設定済みなら追加入力は不要です。未設定でも期限内の成功artifactがあれば追加入力は不要です。artifactも無い場合は `source_ipa_url` を指定します。
3. 成功したRunの **Artifacts → X-Nekama-IPA** をダウンロードします。
4. ZIP内の `X-Nekama-X12.29.ipa` と `.sha256` を確認し、IPAをSideStore等で署名・インストールします。

元IPAや認証情報はActionsキャッシュへ保存しません。ForkからのPRにはSecretを渡しません。artifact経路でも、成功したmainの同じIPAワークフローの成果物のみを採用し、CRC・互換性・注入状態を検証します。

完成IPA artifactは現在7日保持します。既存の `X-Nekama-tweak`（deb）も保存されます。IPAの公開Releaseへの自動公開は行いません。Actions上のビルド検証成功は、iPhone実機上の全機能動作まで保証するものではありません。

## 起動・通信フックの回帰検証

macOS上のObjective-Cランタイムテストで、NSObject以外のルートクラスを含む走査、親子クラスを両方フックした場合のsuper呼び出し、継承メソッドのフック、通信のnil完了ハンドラと応答の転送を確認します。これらはiPhoneでの起動確認とは別の検証です。起動直後に終了する場合は、端末の解析データにあるTwitterの `.ips` を使って実機側の原因を特定します。
