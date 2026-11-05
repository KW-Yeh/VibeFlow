# Spec：PR 監聽內建 skill（pr-watch）與 Library 投遞恢復

- 狀態：2026-11-05 使用者確認 Spec／Plan（「Start」）並實作；AC-5 端到端待指定測試 repo
- Ticket：尚無
- 需求來源：2026-11-05 使用者要求「建立監聽 PR 狀態的 skill，用固定腳本傳參數穩定且省 token 地監聽；新 PR comment 用 address-review 判斷、base branch 有新 commit 就 rebase；PR merged／closed 就結束監聽；內建在 VibeFlow，prompt 提到監聽 PR 就自動啟動」
- 確認紀錄（2026-11-05 對話）：
  - 投遞方式：**全面恢復 Library 投遞**（推翻 2026-10-20 [prompt-free-artifacts](../prompt-free-artifacts/spec.md) 的「Library 只儲存」）。
  - address-review：**通用版一併出貨**成內建 skill，fetch 腳本內建，不依賴使用者的 `~/.claude/scripts/`。
  - 自動程度：**依 `VIBEFLOW_AUTO_MODE`**。

## 問題與目標

開 PR 之後，agent 需要對兩種外部變化反應：reviewer 留了新 comment、base branch 前進了。目前只能讓人回頭叫 agent，或讓 agent 自己輪詢（每次輪詢都燒 token）。

目標：agent 啟動一支固定的監聽腳本，腳本在等待期間不消耗任何 token，只在「有事要做」時結束並回報一行結果，agent 處理完再重新啟動它；PR 結束時整個流程收尾。

## 行為

### pr-watch 腳本（`builtin-skills/pr-watch/scripts/pr-watch.mjs`）

| 情境 | 行為 |
| --- | --- |
| 啟動 | `[--pr <n>]`（省略則取當前分支的 PR）、`--interval <秒>`（預設 60，下限 20）、`--state <file>`（預設 `$VIBEFLOW_SCRATCH_DIR/pr-watch-<owner>-<repo>-<n>.json`，無變數時系統 tmp）、`--since-now`、`--max-wait <秒>`、`--once`。只需 Node 與已登入的 `gh`；Windows 可跑。 |
| 等待中 | 每輪 2 個 GraphQL 查詢（PR 本體＋ base 對 head 的 `compare`；PR 已結束時不查 compare），約 120 點／小時。stdout 不輸出任何東西。 |
| 新 comment | 有「尚未回覆」且「沒回報過」的 review summary／未 resolved thread 的 inline comment／conversation comment → `{"event":"comments","pr":n,"count":k,"items":[…]}`，exit 10。回報過的記進狀態檔，重啟不重報。 |
| 「已回覆」的判定 | address-review 每則回覆附隱藏標記 `<!-- vibeflow:address-review -->`。inline：同 thread 中標記回覆之後的 comment 才算未回覆；summary／conversation：晚於最後一則標記回覆的才算。判定依據在 GitHub 上，刪掉狀態檔也不會重做已回覆的項目。 |
| base 前進 | `compare.behindBy > 0`（base 有 head 沒有的 commit），且這個 base commit 沒回報過 → `{"event":"base","base":"<name>","sha":"…","behindBy":k}`，exit 11。同一個 base commit 只報一次，rebase 失敗不會無限喚醒。fork 來的 PR 不檢查。 |
| merged／closed | `{"event":"merged"\|"closed","pr":n}`，exit 0。 |
| 同時發生 | merged/closed > comments > base（先回 comment 再 rebase，comment 錨點不錯位）。 |
| 第一次查詢就失敗（找不到 PR、`gh` 未登入） | `{"event":"error",…}`，exit 2。 |
| 之後暫時失敗 | 指數退避（上限 5 分鐘）；連續 10 次 → exit 2。 |
| `--max-wait` 到期／`--once` 沒事 | `{"event":"timeout"}`，exit 3（給沒有背景通知的 Codex 分段等待）。 |
| 首次啟動 | 既有未回覆項目首輪即回報（先清積壓）；`--since-now` 視為已回報。 |

### pr-watch skill（`SKILL.md`）

- 觸發：prompt 提到「監聽 PR」「watch PR」「盯 PR」「PR 有 comment 就處理」「babysit PR」等。
- 流程：背景執行腳本（Claude Code 用 `run_in_background`，exit 時會被喚醒，等待期間 0 token）；Codex 沒有背景通知，前景執行並設足夠 timeout。依 exit code 分派：
  - `comments` → 執行 address-review 流程。
  - `base` → `git fetch` + `git rebase origin/<base>`，通過受影響檢查後 `git push --force-with-lease`。
  - `merged`／`closed` → 回報並結束，不再重啟。
  - `error` → 回報使用者並停止。
- `VIBEFLOW_AUTO_MODE=1`：comment 的修改計畫直接套用、commit、push、回覆；rebase 後直接 force-with-lease push。
- `VIBEFLOW_AUTO_MODE=0`（或未設）：整理修改計畫／rebase 預覽後停下等使用者同意，監聽暫停；同意並處理完才重啟。
- rebase 衝突一律 `git rebase --abort`，回報衝突檔案並停止監聽（不論 auto mode）。
- 有 `VIBEFLOW_MASTER_ID` 時，每次事件處理結果用 `task send` 回報 master。

### address-review（通用版內建 skill）

- 由使用者個人版改寫：GitHub 操作全走 skill 內附的 `scripts/review.mjs`（`fetch`／`commit`／`reply`，Node，跨平台）；`fetch` 只列尚未回覆的項目。
- `pr-lib.mjs`（GraphQL 查詢與「未回覆」判定）兩個 skill 各附一份相同的檔案，測試保證一致。
- 確認點依 `VIBEFLOW_AUTO_MODE`（見上）；使用者直接呼叫時（非監聽）行為與現在相同：停一次確認。
- PR 回覆語言跟隨 reviewer（通用版不寫死繁中）；`reply` 自動附隱藏標記。
- 名稱與使用者既有 `~/.claude/skills/address-review` 相同：Library 同步規則「同名的使用者項目不搶」只看 Library 自身；投遞時 Claude 的 user skill 與 plugin skill 會並存（plugin 的以 `vibeflow-library:address-review` 命名空間出現），不覆蓋使用者的。

### Library 投遞恢復

恢復 2026-10-20 之前的投遞，但**不**恢復 Artifact 提示詞（已由 `VIBEFLOW_ARTIFACTS_DIR` 取代）：

- Claude：`--plugin-dir <library>/plugin --add-dir <library>`，plugin 內含所有**啟用**的 Library skill。
- Codex：`CODEX_HOME=<library>/codex-home`，`skills/` 合併 project `.claude/skills` > `~/.codex/skills` > Library；`auth.json`、`config.toml` 連回使用者的 codex home。
- 啟用的 prompt 片段與 script 清單併入 system prompt（排在使用者 System Prompt 之前）。
- Settings → Library 恢復每個項目的啟用勾選框，文案改回「會投遞給兩個 agent」。
- 沒有任何啟用項目 → 不加任何 Library flag（與現在相同）。

## 不包含

- 不在 core／host 端常駐監聽（不新增 handler、不動 notifier）；監聽完全由 agent 端腳本負責。
- 不做 GitHub webhook、不存 token；`gh` 的登入是唯一憑證。
- 不處理 CI 失敗（可列為後續）。
- 不恢復 Artifact 提示詞注入。

## 驗收條件

- [x] AC-1：`test/builtin-pr-skills.test.mjs` 涵蓋：新 comment、標記回覆後不算、回覆後的追問重開、base 前進只報一次、head 已是最新不觸發、merged、closed、優先序、首輪失敗、退避與上限、`--since-now`、`--max-wait`、重啟不重報；兩支腳本對 fake `gh` 實跑。
- [x] AC-2：等待期間 stdout 無輸出；每輪 2 次 `gh api graphql`（測試斷言）。
- [x] AC-3：Library 投遞恢復：`test/claude.test.mjs`、`test/library.test.mjs` 涵蓋 plugin dir、CODEX_HOME、prompt/script 併入、無啟用項目時不加 flag。
- [ ] AC-4：`npm run build:npm` 的 `dist-npm/dist/builtin-skills` 含 `pr-watch`、`address-review`。
- [ ] AC-5：真實 PR 端到端：在測試 repo 的 PR 留 comment → agent 被喚醒並處理；推一個 commit 到 base → rebase + push；close PR → 監聽結束。
- [ ] AC-6：DoD（兩個 tsc、`npm test`、`npm run build:web`、`npm run test:e2e`）全綠。

## 已知限制

- fork 來的 PR 不檢查 base 前進（compare 無法以本 repo 的 ref 名指到 fork 的 head）。
- 「需要討論」的項目不回覆，`address-review fetch` 會持續列出；watcher 因狀態檔不會重複喚醒。
- 預設值沿用：interval 60 秒；首次啟動會回報既有未回覆項目。
