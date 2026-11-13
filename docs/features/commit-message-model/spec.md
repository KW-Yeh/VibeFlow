# Spec：產生 commit message 改用低成本模型

- 狀態：已確認
- Ticket：尚無
- 需求來源：使用者對話（2026-11-13）
- 更新日期：2026-11-13
- 確認紀錄：2026-11-13 使用者要求依任務描述直接規劃並執行（任務描述即本 Spec 的需求）

## 問題與目標

`generateCommitMessage`（`packages/core/src/git.ts`）產生 commit message 時：

1. 沒有指定模型，一律用 CLI 的預設模型（使用者目前是最高階模型）。輸入只有 `git diff --stat` 與 commit 標題列表，用最高階模型是浪費。
2. Codex 路徑傳入 `-p`。Codex CLI 0.165.0 的 `-p` 是 `--profile`，且必須帶值；`codex -p` 單獨執行會回報 `error: a value is required for '--profile <CONFIG_PROFILE_V2>'`。因此 Codex 路徑目前無法產生 commit message。

目標：

1. Claude 路徑以 `--model haiku` 執行，與 `branch-name.ts` 的 `translateTitleToSlug` 一致。
2. Codex 路徑改用 headless 的 `exec` 呼叫，prompt 走 stdin，並指定低成本模型。與 `jev-router.ts` 的 `defaultScout` 使用的形式一致。
3. 測試以假的 CLI 驗證兩條路徑實際傳出的參數。

## 已確認決策

- Claude：`['-p', '--model', 'haiku']`。
- Codex：`['exec', '--model', 'gpt-5.6-luna', '--sandbox', 'read-only', '-']`。
  - `gpt-5.6-luna` 是 `test/fixtures/agent-models/codex-model-list.json` 中 `jev-router.ts` tier 判定為 0（最低成本）的模型，即「older fast and efficient model」。
  - `--sandbox read-only`：這次只需要讀 diff 與產出文字，不需要寫入 worktree。
- 不改 `COMMIT_MESSAGE_GUIDELINES`、輸出格式、IPC、renderer。
- `cwd` 是否改為中性目錄：不在本次範圍。想法寫在 PR 描述。

## 可觀察行為與驗收條件

- AC1：`agentCli = 'claude'` 時，實際執行的 argv 為 `-p --model haiku`，prompt 以 stdin 傳入且含 `[What]` guidelines 與 diff 摘要；回傳值為 trim 後的 stdout。
- AC2：`agentCli = 'codex'` 時，實際執行的 argv 為 `exec --model gpt-5.6-luna --sandbox read-only -`，不含 `-p`。
- AC3：新增的測試不啟動真實的 `claude` 或 `codex`（以 PATH 上的假執行檔取代）。
- AC4：`npx tsc --noEmit -p tsconfig.json` 乾淨，`npm test` 全綠。
- AC5（手動，不進測試）：在真實 Codex CLI 以 `exec --model gpt-5.6-luna --sandbox read-only -` 送極短 prompt，確認模型可用並有輸出。

## 不在範圍內

- 改 `COMMIT_MESSAGE_GUIDELINES` 或 commit message 格式。
- `cwd` 改為中性目錄（PR 說明）。
- 其他呼叫端（`branch-name.ts`、`jev-router.ts`）的改動。

## 已知風險

- `gpt-5.6-luna` 是硬編碼的 model id。若使用者的 Codex 帳號不提供此模型，產生會失敗並顯示 Codex 回傳的錯誤；本次不加 fallback，於 PR 說明。
