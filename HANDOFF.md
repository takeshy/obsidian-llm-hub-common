# 引き継ぎ: 3プラグインの共通化リファクタリング

最終更新: 2026-09-08 / 共有化レビューの修正を反映。実API・Obsidian実機確認は未実施。

## 1. このタスク

Obsidian プラグイン3つ（`obsidian-llm-hub` / `obsidian-gemini-helper` /
`obsidian-local-llm-hub`）の重複コードを、共有ライブラリ
`obsidian-llm-hub-chat-ui`（npm 名 `obsidian-llm-hub-common`）に集約する。

### 確定している方針（変更しないこと）

- **共有できるものは全部ライブラリに入れる。** README の旧「ライブラリは表示層のみ」
  という線引きは廃止済み。
- **移すだけでは意味がない。ズレが再発しない仕掛けを同時に入れる。**
  型で落とす（必須 prop・union 型）／テストで落とす。
- **プラグイン間の差は機能ごとに揃える。** 正当な差分はモデル/プロバイダ層と
  Gemini の FileSearch のみ。同じ機能に世代差を見つけたら、多数決ではなく
  **新しい方・安全な方**に統一する。
- **差分の型は和集合にする。** ホストが持たないフィールドは optional。
- **コミットメッセージは英語で、「何がズレていたか」を具体的に書く。**
  会話と報告は日本語。

## 2. リポジトリと作業ブランチ

| ディレクトリ | ブランチ | 役割 |
|---|---|---|
| `obsidian-llm-hub-chat-ui` | `main` | 共有ライブラリ |
| `obsidian-llm-hub` | `refactor/shared-chat-ui` | プラグイン（送信経路4本） |
| `obsidian-gemini-helper` | `refactor/shared-chat-ui` | プラグイン |
| `obsidian-local-llm-hub` | `refactor/shared-chat-ui` | プラグイン |

いずれも上記4ディレクトリが同じ親ディレクトリに並んでいる前提。
**プラグイン側は `main` ではなく `refactor/shared-chat-ui`。**
`git push origin main` を打つと「何も起きない」ので注意（一度やらかした）。

## 3. 作業ループ

```bash
# 1. ライブラリを直す
cd obsidian-llm-hub-chat-ui
npm run build && npx vitest run && npm test

# 2. 各プラグインの node_modules に dist を手で入れて検証する
for p in obsidian-llm-hub obsidian-gemini-helper obsidian-local-llm-hub; do
  rm -rf ../$p/node_modules/obsidian-llm-hub-common/dist
  cp -r dist ../$p/node_modules/obsidian-llm-hub-common/dist
done
cd ../<plugin>
npx tsc -noEmit -p tsconfig.json && npx eslint src && npx vitest run && npm run build

# 3. ライブラリをコミット → push（push しないと sync-plugins が拒否する）
cd ../obsidian-llm-hub-chat-ui
git commit && git push origin main
npm run sync-plugins -- ../obsidian-llm-hub ../obsidian-gemini-helper ../obsidian-local-llm-hub

# 4. sync 後にもう一度 3プラグインを検証してから、プラグインをコミット
```

`sync-plugins` は各プラグインの `package.json` の GitHub コミットピンを更新する。
**ライブラリの push 前には失敗する**（意図的なガード）。

## 4. これまでに共有化したもの

ライブラリ側 `main` の直近コミット（新しい順）:

```
f05a582 feat(chat): let a turn report the CLI session it leaves behind
81d5cf4 feat(chat): own the shape of a chat turn          ← runChatTurn
477583c fix(chat): make the search selector own web-and-RAG exclusivity
3b8a7a8 feat(core): own model listing and the embedding model test
e5d74be feat(core): own the OpenAI message builder
bd7705e feat(core): own the local LLM stream plumbing
2f186a1 feat(chat): own stream chunk accumulation
06d7d55 feat(workflow): own the skill workflow runner
b82fe2f feat(chat): own the rate limit retry loop
4a96dea feat(chat): own the confirming tool executor
   （以下、Vault ツール実行・添付・スラッシュコマンド・設定UI・MCP・i18n など多数）
```

### 直近で作った主なモジュール

- `src/chat/chatTurn.ts` — **`runChatTurn`**。1ターンの外枠（ユーザーメッセージ表示 →
  実行 → 保存 → trace 終了 → ストリーム解放）を持つ。ホストは `prepare` /
  `run` / `onSaved` / `onSettled` だけ実装する。**6つの送信経路すべてが
  これに載っている。**
- `src/chat/streamAccumulator.ts` — チャンク列 → メッセージのフィールド。
  `pendingStatusFields()` が pendingEdit/pendingEdits を必ず同時に立てる。
- `src/core/openAiMessages.ts` — `buildOpenAiMessages`（履歴 → OpenAI wire 形式）。
- `src/core/modelListing.ts` — モデル一覧取得の URL 規則と埋め込みモデル判定。
  通信そのものは `get` を注入（hub はプロキシ経由、local は `requestUrl`）。
- `src/core/localLlmStream.ts` — `StreamSignal` / アイドルタイムアウト /
  `getHttpModule`（ジェネリック）。
- `src/core/thinkTagParser.ts`, `src/core/toolCallParser.ts`。

### 新しいエントリポイントを足すときは3点セット

`package.json` の `exports` と `files`、そしてルートに `<name>.d.ts` の shim
（Node10 解決用）。既存: `.` `./core` `./chat` `./i18n` `./workflow` `./modals`
`./skills` `./plugin` `./settings` `./vault` `./mcp` `./obsidian` `./styles`
`./styles.css` `./check-markup`。

**不変条件**: `.`（メインエントリ）は実行時に `obsidian` を import してはいけない。
`node --test` が dist に対して走るため。Obsidian に触る UI は `./modals` へ。

## 5. 残っている作業

### 5.1 `core/localLlmProvider.ts` のストリーム本体（実装・自動検証済み）

hub/localの `ollamaChatStream` / `openaiChatStream` を、共有ライブラリの以下へ集約した。

- `src/core/localLlmTransport.ts`: HTTP status、UTF-8分割受信、末尾の改行なしデータ、
  abort、idle timeout、リクエスト解放。
- `src/core/localLlmResponse.ts`: Ollama NDJSON / OpenAI SSE、native thinkingとthinkタグ、
  分割tool call引数、incomplete tool call、usage、in-band error。
- `src/core/localLlmProvider.ts`: `runLocalLlmChat`、requestとOllama履歴の構築、
  inline tool callの復元。OpenAI履歴builderを共用し、画像・tool履歴・reasoningを保持。
- 既存のrequest errorがdone判定で消える経路と、末尾データを捨てる経路を修正。
  Content-Lengthを両プロトコルへ付け、受信終了・停止・consumer returnでrequestを解放する。
- local pluginのToolDefinition/ToolParameterも共有型のre-exportへ変更。
  `ToolPropertyDefinition.description` はlocalの既存契約に合わせoptionalにした。
- hub/localのprovider本体は557/673行から74/83行へ縮小。

hubのOpenCode routing、クラウドOpenAI側へのツール実行委譲、localのChat内のtool実行、
RAG/model一覧取得のホスト接続は維持する。これらを同じAPIへ強制的に寄せてはいない。

検証: 共有unit test 15件 + 実loopback HTTPによるOllama/SSE結合テスト2件。
**実LLMサーバー・Obsidian上の確認は未実施**。テストサーバーは制御した応答を返すもので、
実モデルのtool能力やvision対応を検証するものではない。5.3の実機確認は別途必要。

### 5.2 `core/gemini.ts`（列挙した残りrunnerの実装・自動検証済み）

hub と gemini-helper で最大の重複。引き継ぎ再開時点ではそれぞれ2112行・2269行で、
777行の差分まで広がっていたため、一括移動ではなく純粋な単位から共有する。
2026-09-08時点ではそれぞれ644行・564行まで縮小済み。

- Gemini の thinking level / config / 選択肢判定を
  `src/core/geminiThinking.ts` へ移動済み。`reasoningEffort: "default"` は legacy toggle
  より優先し、モデル既定へ委ねる契約を共有テストで固定した。
- Gemini / Interactions API の usage metadata 変換、複数 round の集計、stream usage
  変換、料金表、grounding cost、finish reason のエラー判定を
  `src/core/geminiUsage.ts` へ移動済み。
- Gemini function result の正規化・安全なシリアライズと、tool response / attribution
  HTML からの web source 抽出を `src/core/geminiTools.ts` へ移動済み。循環参照は
  stack overflow にせず安全な `"null"` へフォールバックする。
- Interactions API 用の desktop streaming / mobile buffered CORS 回避 fetch を
  `src/core/geminiFetch.ts` へ移動済み。
- Gemini message/attachment の contents 変換、再帰的な function tool JSON Schema
  変換、Interactions API の function / File Search / Google Search tool 構築を
  `src/core/geminiInteractions.ts` へ移動済み。gemini 固有の metadata filter と
  hub 固有の RAG 前処理の差は維持している。
- GenerateContent API 用の大文字Schema変換と function declarations /
  Google Search tool 構築も `src/core/geminiInteractions.ts` へ移動済み。
  GenerateContent と Interactions の選択条件はホスト差があるため各 plugin に残す。
- Interactions API の text / image / audio / video / PDF 添付入力と、ローカル履歴を
  transcript として再生する入力構築を `src/core/geminiInteractions.ts` へ移動済み。
- GenerateContent File Search の添付付きrequest構築と、grounding chunksから
  重複を除いたsource/contextを抽出・500文字へ制限する処理も
  `src/core/geminiInteractions.ts` へ移動済み。metadata filterはoptionalで共有する。
- tool loopのfunction resultを安全にシリアライズし、500文字上限の
  `[tool_call]` / `[tool_result]` traceへ変換する処理を
  `src/core/geminiTools.ts` へ移動済み。両API経路で同じserialized resultを再利用し、
  循環参照時もtrace生成で失敗しない。
- function callの残り枠から実行対象・skip数・実行後残数を決めるplannerと、
  callbackによるlimit extensionの正規化を `src/core/geminiToolLoop.ts` へ移動済み。
  warningのタイミングと最終回答への遷移も共有runnerへ移動済み（5.2.1参照）。
- GenerateContent stream chunkのgrounding metadataからGoogle Search使用有無と
  重複のないweb sourceを抽出する処理を `src/core/geminiTools.ts` へ移動済み。
  sourceがないquery-onlyの応答も検索使用として扱う。
- GenerateContentのpartsをtext/thinking/function call/Google Search tool responseへ
  分類する処理を `src/core/geminiTools.ts` へ移動済み。不正なfunction argsは
  空objectへ正規化し、元partsはthought signature保持のため共有runnerがそのまま保存する。
- Interactions streamの `step.start` / 複数 `arguments_delta` / `step.stop` から
  function callを復元するaccumulatorを `src/core/geminiToolLoop.ts` へ移動済み。
  streamed JSONが壊れた場合は `step.start` のargumentsへfallbackする。
- Interactions streamの `text_annotation_delta` からURL・ファイル名等のsourceを
  抽出する処理、`file_search_result` のsource/context収集、completed stepsからの
  fallback収集を `src/core/geminiInteractions.ts` へ移動済み。これはInteractionsの
  イベント解析でありlocal pluginは対象外。hubのRAG事前取得とgemini helperの
  native File Searchという実行経路の差は維持している。
- tool上限到達後の最終Interactions streamからtext・interaction ID・raw usageを
  抽出する処理と、completed statusをエラー文へ変換する処理を
  `src/core/geminiToolLoop.ts` へ移動済み。usageのモデル別換算も共有runnerが所有する。
- Interactions tool loopの `function_result`、tool返却添付の`user_input`、上限通知の
  text `user_input` step構築を `src/core/geminiInteractions.ts` へ移動済み。
  tool実行・添付dedupe・上限判定も共有runnerへ移動済み。

- Interactions main streamのイベント解析を `src/core/geminiInteractionStream.ts` の
  純粋reducerへ移動済み。両pluginは同じrunner経由でreducerを使用し、yield/tracing/料金換算も
  共有する。必須の `native` / `pre-retrieved` policyでFile Searchの差を維持する。
  status metadataの `total_usage` / `usage` 両方に対応し、completed usageを優先する。
  hubでもInteractionsのWeb検索ソースを収集してdoneへ渡すよう統一した。
  分割・交錯するfunction arguments、source dedupe、policy差、error、state非破壊を
  共有テスト10件で固定し、両pluginに結合テスト3件ずつ追加した。

#### 5.2.1 今回共有化した残りrunner

1. **Interactions function tool execution loop**
   - `src/core/geminiInteractionsRunner.ts` の `runGeminiInteractions` がround chaining、
     yield、usage集計、search、limit最終回答、trace終了を所有する。
   - 最終回答も共通reducerで処理し、failed/empty streamをdoneとして扱わない。
   - API error受信時はEOFを待たずiteratorを閉じ、以後のイベントを読まない。
     直前のusageを保持する回帰テストを追加し、両pluginのadapter結合テストも再検証済み。
2. **GenerateContent function tool loop**
   - `src/core/geminiGenerationRunner.ts` の `runGeminiGenerateContentTools` がstream消費、
     model parts保存、functionResponse生成、次roundを所有する。thought signatureは元partsのまま保持。
   - 上限後もモデルがtoolを要求し続ける無限ループを修正。最終requestは関数ツールを外して1回だけ。Google/File Search等のbuilt-in toolは保持する。
   - usage後にsearch invocationが届く場合もgrounding料金を集計する。
3. **両API共通のtool実行・上限**
   - `src/core/geminiToolExecution.ts` の `executeGeminiTools` / `GeminiToolBudget`。
     固定上限と承認延長は必須のunion policyで、延長可否だけを表す。警告は両方とも
     batch実行後の残枠が閾値以下になる場合に実行前に発火し、延長後の残枠を表示する。
     両APIともゼロ枠・上限一致・skippedの最終roundを `built-in-only` に統一。
     ツール結果の後に添付を送り、重複を除く。Interactions結果とtool_callは同じ正規化済みIDを使う。
     GenerateContentは別途保持するsourceIdだけをfunctionResponseへ返し、元IDなしならidキーを省略する。
     tool実行がthrowした場合もtool spanを閉じる。
   - `src/core/toolResultAttachments.ts` も共有化し、hub/helperはre-exportのみ。
4. **通常chat / chatStream、Workflow、Deep Research、画像生成**
   - `src/core/geminiChatRunners.ts` が全runnerを所有し、SDK呼び出しをhostから注入。
     research polling/text fallback、image parts、usage、エラー処理を共有した。
   - `src/core/geminiGenerationClient.ts` の基底クラスに同一の公開5メソッドと
     request構築・履歴変換を移し、hub/helperは継承する。SDK生成・proxyはhost側。
     workflow traceのenableThinkingは実際のthinking configに合わせる（Gemma等はfalse）。
   - Workflowも空streamをエラーに統一。hubのGenerateContentとInteractionsのthinkingを
     共有resolverへ統一。未指定はモデル既定、falseはモデル別のlow/minimal/high、
     明示的defaultはtoggleより優先することを両pluginの結合テストで固定した。

共有runner・generation clientテスト45件、両pluginのSDK adapter結合テストは各20件。
残りの公開同期と実機確認は7節・5.3を参照。

#### 5.2.2 共通化せずplugin側に残すもの

- SDK client生成、hubのproxy patch、desktop/mobile CORS fetch設定。
- GenerateContent / Interactions APIの選択条件と対応モデル判定。
- hubのGenerateContent File Search事前取得と、gemini-helperのInteractions native
  File Search。**local-llm-hubはInteractions streaming共通化の対象外。**
- gemini-helperのfunction call上限延長UI、hubの固定上限policy。
- hubだけのprovider検証、各pluginのsingleton初期化引数。

### 5.3 動作確認（別端末でやってほしいこと）

今回の変更で全送信経路の外枠が入れ替わっているので、実機確認が要る。

- 各プロバイダで普通に1往復
  （hub は CLI / ローカルLLM / APIプロバイダ / Gemini の4経路すべて）
- 生成中に**停止ボタン** → 停止メッセージが残り、履歴を開き直しても消えないこと
- わざと API キーを壊して**エラー** → エラーが履歴に保存されること
  （local は以前これが保存されず消えていた。修正済み）
- 生成中に**別のチャットへ切り替え** → 答えが**元のチャット**に保存されること
  （local は以前、変数解決中に切り替えると新しい方に入っていた。修正済み）
- **優先: local pluginのOllamaでtool履歴を再生して次の質問を送る** → tool_calls付き
  assistant（contentは空文字）→ tool結果 → assistant本文の順を受理し、結果を参照できること。
  旧localはtool_callsと本文を同じassistant turnに載せていたため、実モデルの互換性確認が必要。
  PDF付きtool結果で空のuser turnが入らないこと、args未定義の旧履歴でも継続できることも確認。
- **優先: Ollamaの画像履歴と認証** → 画像付き会話の次の質問でも画像を参照できること、
  apiKey設定時のAuthorizationヘッダを認証付き接続先が受理すること。どちらも今回の共有化で追加。
- local pluginでローカルLLM（小さいモデル）にVaultツールを使わせる → 本文に生のJSONが
  出ずにinline tool callフォールバックで実行されること。hubのrunLocalLlmChatにはtoolsを
  渡しておらず、hubはChat.tsxのマーカー方式agent loopなので、この確認の対象ではない。
- hub/helperの両Gemini API経路でツール上限に達する → 関数ツールを追加実行せず、
  検索を伴う最終回答とusageを受信できること。helperは閾値到達batchの実行前に延長確認が出ること。
- Ollama を **既定以外の URL/ポート**に置いて RAG の埋め込みモデル一覧を開く →
  埋め込みモデルが出ること（local の新規修正）

## 6. 踏んだ罠（繰り返さないこと）

- **`npm run build 2>&1 | head` は TS エラーを隠す。** `tail` か全出力で見る。
- **Python の正規表現でコード編集するとき、非貪欲マッチが import 行を食う。**
  マーカー検索は必ず開始位置以降を探す（`s.index(marker, start)`）。一度、
  開始マーカーより前の出現を拾って340行のブロックを複製した。
- **文字列一括置換が別の型に当たる。** 型宣言ごと名前を揃えてから置換する。
- **JSX の `className={cls("x")}` は波括弧が要る。**
- **`vi.mock` のパスは移動に追随させる。** 部分 `vi.mock("obsidian", ...)` は
  共有エントリが modals を引き始めると壊れる。vitest はもともとプラグインの
  obsidian モックに alias しているので、部分モックは外すか `importOriginal` で合成する。
- **`src/mocks/obsidian.ts` に新しい API を足すのを忘れない。**
- **`type X` を動的 import の分割代入の中に書くとパースエラー。** 静的 `import type` にする。
- **dist のコピー先ディレクトリを間違えると、プラグインの dist を消す。**
  必ずライブラリのディレクトリから実行する。
- **ライブラリには eslint 設定が無い。** 検証は `build` + `vitest` + `npm test`。

## 7. 未解決・保留

- Gemini runner・local provider共有化の対象は、共有ライブラリと3plugin。
  直前のreducerコミットはlibrary `80cc4da` / hub `3854a85` / helper `bed876e`。
  2026-09-08にユーザーから今回分のcommit/push指示を受領。
- 公開順序はライブラリcommit/push → sync-plugins → 3plugin再検証 → plugin commit/push。
  公開コミットと依存ピンの確定値は各リポジトリのGit履歴・package.jsonを参照。
  以降の共有化のローカル検証にpushは不要。
- レビュー修正についてもcommit/push指示を受領。公開は上記順序で行い、
  plugin依存ピンを公開済みライブラリのコミットに更新する。確定値はGit履歴・package.jsonを参照。
- 追加レビュー修正: GenerateContentへの補完ID流出を修正。IDなし回帰テストの失敗を確認後、
  関連runnerテスト23件・build成功。追加修正後の共有ライブラリ全件検証も成功。
- 全件検証: ライブラリbuild + npm test成功（Vitest 605件 + Node test suites）。
  3pluginのtsc / eslint / Vitest / production build成功。
  hub 395件成功・12件skip、helper 134件成功、local 286件成功・10件skip。
  検証用コピーで実行後、実リポジトリへ反映した全ソースとdistが検証コピーに一致することを確認済み。
- local loopback HTTPテストとhub proxyFetchテストはsocket listenが必要なため、sandbox制限外で実行。
  検証ログ: `/tmp/gemini-review-fixes/*-tests.log` と `*-validation.log`。
- **実API・実LLM・Obsidian実機確認は未実施**。実モデル接続先の提示があれば検証可能だが、
  5.3のUI操作はObsidianが動く環境で必要。この端末ではollama/obsidianコマンドと
  対応する実行中プロセスがないことを確認した。実モデル接続先の質問は回答待ち。

- **gemini のコミット `58f6b87` のメッセージが不正確。** `command.ts` の readOnly
  モードのバグを直したと書いたが、実際は原文がインデント崩れだっただけで挙動は
  正しかった。push 済み。amend + force-push するかは未指示のまま。
- ライブラリに eslint 設定を入れるかどうか（現状なし）。

## 8. このファイルについて

引き継ぎ用。作業が完了したら削除してよい。
