# Plan：產生 commit message 改用低成本模型

- 狀態：已實作，獨立驗收與 PR 待完成
- 對應 Spec：[spec.md](./spec.md)
- Spec 確認依據：2026-11-13 使用者要求依任務描述直接規劃並執行
- 更新日期：2026-11-13
- 確認紀錄：2026-11-13 使用者授權規劃並執行（commit、push、draft PR 亦已授權）

## 現有程式碼調查

| 檔案 | 現況與可重用處 |
| --- | --- |
| `packages/core/src/git.ts:1379-1436` | `COMMIT_MESSAGE_GUIDELINES` 與 `generateCommitMessage`。目前 `cliFlags = { claude: ['-p'], codex: ['-p'] }`，`bin = agentCli`，`runAgentPrint(bin, flags, prompt, { cwd: worktreePath })`。 |
| `packages/core/src/git.ts:934` | `resolveBaseRef`：先試 `origin/<base>`，再試 `<base>`，最後 `HEAD`。測試用 `makeRepo()` 的預設 remote 即可命中 `origin/main`。 |
| `packages/core/src/branch-name.ts:86` | 既有 Claude 低成本呼叫：`runAgentPrint('claude', ['-p', '--model', 'haiku'], …)`，AC1 以它為準。 |
| `packages/core/src/jev-router.ts:76-80` | 既有 Codex headless 呼叫：`['exec', '--model', model, …, '--sandbox', 'read-only', …, '-']`，prompt 走 stdin。AC2 沿用此形式。 |
| `packages/core/src/jev-router.ts:50-58` | `tier()`：`haiku/mini/nano/luna/flash` → 0（最低成本）。`gpt-5.6-luna` 符合。 |
| `test/fixtures/agent-models/codex-model-list.json` | 帳號實際可見的 Codex 模型清單，含 `gpt-5.6-luna`。 |
| `packages/core/src/agent-print.ts` | `runAgentPrint`：prompt 走 stdin；Windows 經 cmd.exe 解析 PATH。 |
| `packages/core/src/env.ts` | `buildEnv()` 首次呼叫時複製 `process.env` 並把常見 bin 目錄接在 PATH 後面，結果記憶在模組層；測試需在首次呼叫前設定 PATH。 |
| `test/agent-print.test.mjs` | 假 CLI 慣例：`makeFakeAgent` 在 `os.tmpdir()` 建立 PATH 目錄，Windows 用 `.cmd` shim，並刪除 `NODE_OPTIONS`（測試載入器的 cwd 相對路徑在假 CLI 中無法解析）。 |
| `test/support/repo.mjs` | `makeRepo()` 與 `git()` / `writeFile()`，用於建立有 commit 的臨時 repo。 |

## 方案

1. `git.ts`：以一張 `COMMIT_MESSAGE_ARGS` 表取代 `cliFlags`：
   - `claude: ['-p', '--model', 'haiku']`
   - `codex: ['exec', '--model', 'gpt-5.6-luna', '--sandbox', 'read-only', '-']`
   - 未知 CLI 維持原本 fallback `['-p']`（不擴大範圍）。
   - 註解只寫意圖（輸入只有摘要，用低成本模型即可；Codex 的 `-p` 是 `--profile`），不寫機制重述。
2. 新測試 `test/commit-message.test.mjs`：
   - 在 `before()` 建立一個含 `claude` 與 `codex` 假執行檔的目錄，把它放到 `process.env.PATH` 最前面，並刪除 `process.env.NODE_OPTIONS`。兩者都必須在第一次呼叫 `buildEnv()` 之前完成。
   - 假執行檔把 `{ args, input }` 寫到目錄內的 `<name>.json`，stdout 回傳一則合法的 `[What]/[Why]/[How]` 訊息。
   - 每個測試用 `makeRepo()` 建 repo，建 feature branch 並提交一個檔案，呼叫 `generateCommitMessage(projectPath, 'main', agentCli)`。
   - 斷言 argv 精確相等（AC1、AC2），並斷言 codex 的 args 不含 `-p`。
   - `after()` 清除臨時目錄。
3. 新增 `docs/features/commit-message-model/` 的 spec/plan，並在 `docs/README.md` 索引加一列（AGENTS.md 規定新文件要進索引）。
4. `test/README.md` 的 suite 列表加入新檔（AGENTS.md 規定新增 suite 要更新）。

不選的方案：
- 只改 claude、codex 留 `-p`：codex 路徑目前必然失敗，不能保留。
- 新增 `commitModel` 設定或 UI：超出本次範圍，且 spec 沒要求。
- 直接以 `codex -p` 加 `--profile` 等假值：沒有意義。

## 修改順序

1. 撰寫 spec/plan 並提交（`docs:`）。
2. 修改 `git.ts` 參數表。
3. 新增 `test/commit-message.test.mjs`，先確認它在修改前會失敗（claude 缺 `--model`、codex 用 `-p`），再套用修改後通過。
4. 更新 `test/README.md`、`docs/README.md`，提交。
5. 執行 tsc 與 npm test，手動 Codex 單次呼叫（AC5），記錄結果到本 Plan。

## 驗證命令

- `npx tsc --noEmit -p tsconfig.json`
- `node scripts/run-tests.mjs ./test/commit-message.test.mjs`（迭代用）
- `npm test`
- 手動 AC5：`printf 'Reply with the word OK.' | codex exec --model gpt-5.6-luna --sandbox read-only -`
- 不跑 `renderer` 相關檢查：本次不動 `renderer/` 與 `packages/` 以外的檔案，UI 不變。`npm run build:web` 與 e2e 不在 DoD 範圍（無 Web UI 行為改動）。

## 風險

- `gpt-5.6-luna` 是硬編碼 model id。帳號若無此模型，產生會失敗；已列入 Spec 已知風險。
- 測試用 PATH 注入依賴 `buildEnv()` 的記憶行為；測試檔需在第一次呼叫前設定 PATH（已放在 `before()`）。
- Windows 的 `.cmd` shim 路徑未在 macOS 上實測，沿用 `agent-print.test.mjs` 已驗證的形式。

## 驗證結果

- AC1、AC2（新測試 `test/commit-message.test.mjs`）：修改前，兩條路徑的 argv 都是 `['-p']`，測試失敗；修改後 2/2 通過。
- AC3：測試以 PATH 上的假 `claude` / `codex` 執行，未啟動真實 CLI。
- AC4：`npx tsc --noEmit -p tsconfig.json` 結束碼 0；`npm test` 為 586 pass、0 fail。
- AC5（手動）：`printf 'Reply with the single word OK.' | codex exec --model gpt-5.6-luna --sandbox read-only -` 結束碼 0，輸出 `OK`。
- 未執行：`renderer` typecheck、`npm run build:web`、`npm run test:e2e`（本次未動 renderer 與 Web UI）。
- 未完成：獨立 sub-agent 驗收、push 與 draft PR、PR 監看（因用量上限中斷）。
