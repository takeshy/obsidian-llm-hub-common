# 引き継ぎ: 3プラグインの共通化リファクタリング

最終更新: 2026-09-07 / 別端末へ引き継ぐ時点の状態。

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

### 5.1 `core/localLlmProvider.ts` のストリーム本体（未着手）

`ollamaChatStream` / `openaiChatStream` の中身（各200〜260行）。
純粋・テスト可能な部分（think タグ、インラインツール呼び出し、メッセージ組み立て、
モデル一覧、StreamSignal）は**すべて共有化済み**で、残りは通信とツールループ。

**アーキテクチャの差があるので単純統合は危険**:

| | hub | local |
|---|---|---|
| ローカルLLMのツール実行 | クラウド用 `openaiChatWithToolsStream` に委譲 | 自前のツールループ |
| 画像添付（vision） | あり | なし |
| PDF 添付 | あり（共有 builder 経由で獲得済み） | あり |
| `reasoning_content` の往復 | 共有 builder 経由で獲得済み | あり |
| OpenCode プロバイダ | あり | なし |
| 埋め込みモデル一覧 | あり（別モジュール） | あり |

**実サーバが要る。** この端末には Local LLM が無いため未着手。

### 5.2 `core/gemini.ts`（着手済み）

hub と gemini で最大の重複。引き継ぎ再開時点ではそれぞれ2112行・2269行で、
777行の差分まで広がっていたため、一括移動ではなく純粋な単位から共有する。

- Gemini の thinking level / config / 選択肢判定を
  `src/core/geminiThinking.ts` へ移動済み。`reasoningEffort: "default"` は legacy toggle
  より優先し、モデル既定へ委ねる契約を共有テストで固定した。
- 残りは CORS fetch、usage変換、tool loop、Interactions API、画像生成など。

### 5.3 動作確認（別端末でやってほしいこと）

今回の変更で全送信経路の外枠が入れ替わっているので、実機確認が要る。

- 各プロバイダで普通に1往復
  （hub は CLI / ローカルLLM / APIプロバイダ / Gemini の4経路すべて）
- 生成中に**停止ボタン** → 停止メッセージが残り、履歴を開き直しても消えないこと
- わざと API キーを壊して**エラー** → エラーが履歴に保存されること
  （local は以前これが保存されず消えていた。修正済み）
- 生成中に**別のチャットへ切り替え** → 答えが**元のチャット**に保存されること
  （local は以前、変数解決中に切り替えると新しい方に入っていた。修正済み）
- ローカルLLM（小さいモデル）で Vault ツールを使わせる → 本文に生の JSON が
  出ずにツールが実行されること（hub の新規修正。llama3.1:8b / mistral 7b で顕著）
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

- **gemini のコミット `58f6b87` のメッセージが不正確。** `command.ts` の readOnly
  モードのバグを直したと書いたが、実際は原文がインデント崩れだっただけで挙動は
  正しかった。push 済み。amend + force-push するかは未指示のまま。
- ライブラリに eslint 設定を入れるかどうか（現状なし）。

## 8. このファイルについて

引き継ぎ用。作業が完了したら削除してよい。
