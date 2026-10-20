# Spec：內建 skill 產出預設寫進 Artifacts

- 狀態：已確認
- Ticket：尚無
- 需求來源：VibeFlow 卡片「Default built-in skill outputs to VIBEFLOW_ARTIFACTS_DIR」的任務描述（2026-10-20）
- 更新日期：2026-10-20
- 確認紀錄：2026-10-20 使用者以「送出」放行；採建議選項——方案 B（`parity.py` 讀 env）、子資料夾 `visual-parity/` 與 `pr/`

## 問題與目標

VibeFlow 啟動 agent 時 export `VIBEFLOW_ARTIFACTS_DIR`（`<worktree>.artifacts`）與
`VIBEFLOW_SCRATCH_DIR`（`<artifacts>/scratch`），見 [prompt-free-artifacts](../prompt-free-artifacts/spec.md)，
但沒有任何地方叫 agent 用它們。

實例（2026-10-20，clcom-frontend-agent-chat 的 feature-css 卡片）：截圖、像素比對圖、驗收影片與
Playwright 腳本全部寫進 Claude Code 自己的 scratchpad（`/private/tmp/claude-501/...`），session 結束可能被清掉，
最後要使用者手動複製到 `feature-css.artifacts`。

另一個風險：`visual-parity` 的範例（`--out parity-flow.md`、`--video parity-flow.mp4`、`screenshot` 的 `path`）
都是相對路徑，會落在 cwd，也就是 worktree 裡，有被 commit 的風險。

靠記憶或專案 CLAUDE.md 只對單一專案有效；改成讓產出這些檔案的內建 skill 預設就寫對，所有 VibeFlow 使用者都受惠。

## 範圍

### 本次包含

- `packages/core/builtin-skills/visual-parity/`：`SKILL.md` 與 `scripts/parity.py`。
- `packages/core/builtin-skills/pr/SKILL.md`：新增「截圖與驗收影片」一節。
- `parity.py` 輸出路徑解析的測試。
- 確認 `npm run build:npm` 產出的 `dist-npm/dist/builtin-skills/` 帶到新版。

### 本次不包含

- 不改 `--append-system-prompt` 的內建提示（方案 1）。
- 不加 Stop hook 同步 Claude Code 的 scratchpad（方案 3，依賴 Claude Code 內部路徑）。
- 不改 env 變數名稱，不改 core 建立 Artifacts 目錄的方式。
- 不改 repo 自己的 `.claude/skills/pr`、`.agents/skills/pr`（公司專用版，屬於專案 skill）。
- 不改 Library 同步邏輯：內建檔案內容變了，沿用既有規則（沒改過的自動更新，改過的顯示「有新版」）。

## 決策：由 `parity.py` 自己讀 env（建議）

| 方案 | 優點 | 缺點 |
| --- | --- | --- |
| A. 只改 SKILL.md 指示 | 不動 script | 靠 agent 照做；同一段指令要分 VibeFlow／非 VibeFlow 兩種寫法；寫錯一次就落進 worktree |
| **B. `parity.py` 依 env 決定相對路徑的基準（建議）** | 強制；SKILL.md 範例同一條指令在兩種環境都對；旗標介面完全不變 | VibeFlow 內「相對路徑」的落點改變——之後若用同一個相對路徑去讀報告會找不到，靠 stdout 印出的絕對路徑解決 |

相容性：旗標、預設檔名、exit code 都不變；env 不存在時行為與改動前逐位元相同。只有在 VibeFlow 卡片的 shell（env 由 launch 注入）裡，相對路徑的基準才改變——這正是要修的行為。

## 行為

### `parity.py` 輸出路徑

「輸出路徑」指 `diff` / `responsive` / `flow` 的 `--out`、`flow` 的 `--video`、steps 裡 `screenshot` 的 `path`。
輸入路徑（`--steps`、`--map`）不受影響，照舊相對於 cwd。

| 情境 | 預期行為 |
| --- | --- |
| `VIBEFLOW_ARTIFACTS_DIR` 有值，輸出路徑是相對路徑 | 寫到 `$VIBEFLOW_ARTIFACTS_DIR/visual-parity/<相對路徑>`，必要的上層目錄自動建立 |
| 輸出路徑是絕對路徑 | 原樣使用（使用者明確指定的位置優先） |
| `VIBEFLOW_ARTIFACTS_DIR` 不存在或為空字串 | 與改動前相同：相對於 cwd |
| 有 env，但目錄建立失敗（權限等） | 印一行提示，退回相對於 cwd，不中止 |
| `--video` 錄製中的暫存目錄 | `VIBEFLOW_SCRATCH_DIR` 有值時建在它底下（跑完照舊刪除）；沒有時照舊用系統 temp |
| stdout 與報告 | `report:`、`video:` 印實際寫入的路徑：有 env 時是 Artifacts 下的絕對路徑；沒有 env 時與改動前相同（照傳入的字串） |

### `visual-parity/SKILL.md`

- 新增「輸出位置」一節：VibeFlow 卡片內所有產出自動落在 `$VIBEFLOW_ARTIFACTS_DIR/visual-parity/`，
  讀報告、grep 一律用 stdout 印的路徑；不在 VibeFlow 時落在 cwd，若 cwd 是 git repo，改傳絕對路徑到自己的 scratchpad，避免被 commit。
- steps.json 與 `--map` JSON（agent 自己寫的輸入檔）：有 `VIBEFLOW_ARTIFACTS_DIR` 時寫進 `$VIBEFLOW_ARTIFACTS_DIR/visual-parity/`；沒有時寫進 agent 自己的 scratchpad。
  使用者要把 flow 存成回歸測試時才存進專案（例如 `e2e/`）——原本的「存進專案」一句改成這個明確的例外。
- 臨時 Playwright 腳本、log、其他中間檔：寫進 `$VIBEFLOW_SCRATCH_DIR`；沒有時用 agent 的 scratchpad。
- 既有範例指令維持相對檔名不變（同一條指令兩邊都對）。

### `pr/SKILL.md`

新增「截圖與驗收影片」一節：

| 情境 | 預期行為 |
| --- | --- |
| 要附截圖或驗收影片 | 先從 `$VIBEFLOW_ARTIFACTS_DIR` 找現成的檔案（含 `visual-parity/` 子資料夾） |
| 需要新拍截圖 | 存到 `$VIBEFLOW_ARTIFACTS_DIR/pr/`；沒有這個變數時存到 agent 的 scratchpad／系統暫存目錄，絕不寫進 repo |
| 上傳 | 只透過 GitHub 網頁（把檔案拖進 PR 描述或留言）上傳；不 commit、不 push 圖片或影片進任何分支；`gh` 無法上傳附件，所以列出檔案絕對路徑與 PR URL 交給使用者，或在有瀏覽器自動化時由 agent 在網頁上傳 |
| 沒有任何截圖／影片 | 不加這一段，PR 照常建立 |

## 驗收條件

- [ ] AC-1：在 VibeFlow 卡片的 shell 裡（`VIBEFLOW_ARTIFACTS_DIR` / `VIBEFLOW_SCRATCH_DIR` 有值）照 SKILL.md 範例跑 `parity.py diff` 與 `flow --video ...mp4`（steps 含 `screenshot`）：報告、影片、截圖全部在 `$VIBEFLOW_ARTIFACTS_DIR/visual-parity/` 下，scratch 裡沒有殘留暫存目錄，worktree 的 `git status --porcelain` 為空。
- [ ] AC-2：unset 兩個變數再跑同樣指令：輸出落在 cwd，與改動前相同，exit code 與 stdout 格式不變，沒有錯誤。
- [ ] AC-3：絕對路徑的 `--out` / `--video` 在有 env 時仍寫到指定位置。
- [ ] AC-4：新增測試覆蓋路徑解析（有 env／無 env／空字串／絕對路徑／目錄建立失敗），`npm test` 綠；`parity.py selftest` 通過。
- [ ] AC-5：`visual-parity/SKILL.md` 與 `pr/SKILL.md` 依「行為」更新；pr 維持「截圖只從 GitHub 網頁上傳、不 commit 進 repo」。
- [ ] AC-6：`npm run build:npm` 後，`dist-npm/dist/builtin-skills/` 的兩個 skill 與 `parity.py` 與原始檔一致。
- [ ] AC-7：專案 DoD：`npx tsc --noEmit -p tsconfig.json`、`npm test` 綠（本次不動 renderer，不需 renderer typecheck / build:web / e2e）。

## 限制與依賴

- 驗收需要本機 Python 3 + Playwright（已具備）；`.mp4` 需要 ffmpeg（已具備）。
- CI 在 ubuntu / macOS / Windows 跑 `npm test`；路徑解析測試不能依賴 Playwright，Python 不存在時該測試跳過並註明原因。
- Library 已不投遞給 agent（prompt-free-artifacts），內建 skill 要被 agent 用到，使用者需自行放到 agent 會發現的 skill 目錄；這不在本次範圍。

## 待確認事項

- 無
