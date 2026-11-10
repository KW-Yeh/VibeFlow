# Plan：Git diff 依 commit 分類

- 狀態：已確認
- 對應 Spec：[spec.md](./spec.md)
- Spec 確認依據：2026-11-10 使用者確認整份 Spec；同日追加「移除決策分頁」與 UI 設計稿確認
- 更新日期：2026-11-10
- 確認紀錄：2026-11-10 使用者確認（「確認，開始實作」）

## 現有程式碼調查

| 檔案 | 現況與可重用處 |
| --- | --- |
| `packages/core/src/git.ts` | `collectDiffEntries`（name-status + numstat + untracked + revision）、`readDiffFile`（`git show <ref>:<path>` / 讀 working tree，`clip` 到 1MB）、`resolveBaseRef`、`fetchBase`、`captureTaskOutcome`（`base..HEAD` log，`MAX_OUTCOME_COMMITS = 50`，`%x00` 分隔）。live 依 commit 檢視可直接套同樣的解析，只是範圍換成 `<sha>^1..<sha>`。 |
| `packages/core/src/specs.ts` | Done 卡讀 branch 的既有前例：`readBranchSpecs` 以 `projectPath` 跑 git、依序試 local branch → origin → merge commit。commit-diff 只需「commit 是否可從 base 抵達」（`merge-base --is-ancestor`），比它簡單。 |
| `packages/core/src/github.ts:103` | `gh` 呼叫範式：`pexec('gh', args, { env: execEnv() })`，錯誤轉成可讀訊息。 |
| `packages/core/src/service.ts:1195-1222` | `git:getDiff*` handler：`requireTask` → `gitWorktree(task)`（master 回 null）→ 呼叫 git.ts。`task:getSpecs`（1248）示範 Done 卡改用 `task.projectPath`。 |
| `packages/core/src/client.ts:207` / `renderer/lib/api.ts:287` | bridge 與 no-op wrapper 的固定寫法。 |
| `renderer/components/task-workspace-panel.tsx` | `useTaskDiff`（3 秒輪詢 `fetch:false`、`stabilizeDiffEntries`、modal 單檔載入快取）、`DiffContent`（檔案列）、`DiffFileModal` + `DiffFileViewer`（react-diff-viewer，吃 `DiffFile` 的 old/new）、`DiffViewToggles`、`useDiffView`（模組層 store + localStorage）。 |
| `renderer/lib/view-persistence.ts:94` | `DiffViewPrefs { split, fullContext }`，`readDiffView` 對缺欄位補預設 → 加 `groupBy` 不需 migration。 |
| `renderer/components/done-task-sheet.tsx` | `DoneTab = 'spec' \| 'task' \| 'slaves'`，tab 列與 panel 已有，加一個 `'diff'` 即可；`useTaskSpecs` 決定是否預設開「決策」。 |
| 決策分頁的使用端 | `task-workspace-panel.tsx`（`TaskTab` 的 `'spec'`、`useTaskSpecs`、`SpecContent`、tab 過濾）、`done-task-sheet.tsx`、`renderer/lib/api.ts` 的 `getSpecs`、`client.ts`、`service.ts` 的 `task:getSpecs`、`packages/core/src/specs.ts`、`test/specs.test.mjs`、`test/service.test.mjs:739`、`test/master-cards.test.mjs:87`、`IPC_API_MAP.md:114`、`AGENTS.md`「The 決策 tab shows…」段與 project structure 的 `specs.ts` 行、`docs/features/spec-tab/`。TUI 未使用。 |
| `test/git.test.mjs`、`test/service.test.mjs`、`test/support/repo.mjs` | `makeRepo()`（含 bare remote）可做出 merge / squash 情境。 |
| `e2e/web.e2e.mjs:463` | 已點「Git diff」分頁驗證檔案出現，可延伸切換。 |

## 方案與取捨

### 資料模型（core，新型別放 `git.ts`）

```ts
interface CommitSummary {
  sha: string        // full
  shortSha: string
  subject: string
  authoredAt: number // epoch ms
  isMerge: boolean
  additions: number
  deletions: number
  fileCount: number
}

// Done 卡單一 commit 的內容；source 決定 UI 用哪種 viewer
type CommitDiff =
  | { source: 'git'; sha: string; files: DiffEntry[] }          // 點檔再取完整前後內容
  | { source: 'github'; sha: string; files: PatchFile[] }      // patch 一次帶回
  | { source: 'none'; reason: string }

interface PatchFile { path: string; status: string; additions: number; deletions: number; patch?: string }
```

### Live 卡

- `listBranchCommits(worktree, baseRef)`：`git log --format=%H%x00%h%x00%s%x00%at%x00%P --shortstat`（或 log 後一次 `--numstat`）於 `baseRef..HEAD`，上限 50。輪詢沿用 3 秒、`fetch:false`；只在「依 commit」顯示時才輪詢 commit 清單，「全部」維持原輪詢不變。
- 「未 commit 的變更」：新增 `collectWorkingEntries(worktree)`（`diff --name-status HEAD` + numstat + untracked），點檔用 `readDiffFile(worktree, 'HEAD', entry)`。
- 某個 commit 的檔案：`collectCommitEntries(repo, sha)` = `diff --name-status/--numstat <sha>^1 <sha>`（root commit 用 `--root`）；單檔內容 `git show <sha>^1:<path>` / `<sha>:<path>`。把 `readDiffFile` 抽成吃 `(oldRef, newRef | 'worktree')`，既有呼叫行為不變。
- 安全：sha 參數只收 `/^[0-9a-f]{4,40}$/`，且必須出現在 `base..HEAD` 清單（或 base 歷史，Done 卡）中才讀；檔案路徑必須是該 commit 的 entry，沿用 `getWorktreeDiffFile` 的「不在清單就回 null」。

### Done 卡

1. `task.projectPath` 存在且是 repo → `fetchBase`（失敗不擋）→ `resolveBaseRef` → `rev-parse --verify <short>^{commit}` + `merge-base --is-ancestor <sha> <baseRef>` 成立 → `source: 'git'`。
2. 否則若 `task.outcome.pr`：從 PR url 解 `owner/repo`，`gh api repos/o/r/pulls/N/commits --paginate` 以短 sha 前綴找完整 sha，再 `gh api repos/o/r/commits/<sha>` 取 `files[].{filename,status,additions,deletions,patch}` → `source: 'github'`。
3. 否則 `source: 'none'` 與原因字串。
- 結果在 renderer 端以 `taskId:sha` 快取（sheet 開著期間），不寫進 store。
- 本地路徑的單檔內容另走 `git:getCommitFile`，參數同上述驗證。

### 移除決策分頁

- UI：拿掉 `'spec'` tab、`useTaskSpecs`、`SpecContent`；Done sheet 預設分頁改為「任務」（master 仍為子卡）。
- core：`task:getSpecs` 已無使用端 → 一併移除 handler、client 方法、api wrapper、`specs.ts` 及其測試，不留死碼。`decisions.ts` 不動。
- 文件：`AGENTS.md` 刪除決策 tab 段落與 `specs.ts` 結構行；`docs/features/spec-tab/spec.md` 頂端加狀態註記「已於 commit-diff 移除」；`IPC_API_MAP.md` 移除該列。
- 分頁記憶：目前 tab 選擇是元件 state，未持久化 → 不需 migration；若 `picked` 為 `'spec'` 的型別消失，自然落回預設。

### 為何不新增「Done 卡的 branch 總 diff」或存 full sha

Spec 已排除；outcome 格式不動，避免 migration。

### Handler（`service.ts`）

| channel | 參數 | 說明 |
| --- | --- | --- |
| `git:listCommits` | taskId | live：`base..HEAD` 的 `CommitSummary[]` + 是否有未 commit 變更 |
| `git:getCommitEntries` | taskId, sha \| `'working'` | live：該 commit（或未 commit）的 `DiffEntry[]` |
| `git:getCommitFile` | taskId, sha \| `'working'`, path | live 與 Done（source git）的單檔 `DiffFile` |
| `git:getDoneCommitDiff` | taskId, sha | Done：`CommitDiff`（本地 → gh → none） |

`git:getCommitFile` 對 Done 卡（無 worktree）用 `projectPath`，前提是該 sha 可從 base 抵達。

### UI

- `DiffViewPrefs.groupBy: 'all' | 'commit'`（預設 `'all'`）；切換放在 Git diff 分頁標題列（`DiffActions` 旁）。
- 新元件檔 `renderer/components/commit-diff.tsx`：`CommitList`（commit 列，含「未 commit 的變更」）、`CommitFiles`（返回 + 檔案列，重用現有檔案列樣式 → 抽出 `DiffEntryRow`）、`PatchViewer`（unified patch：逐行上色的 `<pre>`，`+`/`-`/`@@` 三色，不引入新套件）。
- `useCommitDiff(taskId, enabled)` hook 給 live；Done sheet 用 `useDoneCommitDiff(task)`，只在 `'diff'` 分頁 active 時觸發。
- Done sheet：`DoneTab` 加 `'diff'`（標籤「Git diff」），在 `task.outcome?.commits.length > 0` 且非 master 時出現。

## 預計修改

| 檔案 | 修改內容 | AC |
| --- | --- | --- |
| `packages/core/src/git.ts` | 新型別；`listBranchCommits`、`collectWorkingEntries`、`collectCommitEntries`、`readDiffFile` 泛化、`resolveCommitInBase`、`getDoneCommitDiff`（含 gh） | AC-2,3,4,5,7 |
| `packages/core/src/service.ts` | 4 個 handler + 參數驗證 | AC-7 |
| `packages/core/src/client.ts` | 4 個方法 | — |
| `packages/core/IPC_API_MAP.md` | 補 4 個 channel | — |
| `renderer/lib/types.ts` | re-export 新型別 | — |
| `renderer/lib/api.ts` | 4 個 wrapper（無 bridge 回空） | — |
| `renderer/lib/view-persistence.ts` | `DiffViewPrefs.groupBy` | AC-1 |
| `renderer/components/commit-diff.tsx`（新增） | `CommitList` / `CommitFiles` / `PatchViewer` / hooks | AC-2~6 |
| `renderer/components/task-workspace-panel.tsx` | 切換、依 groupBy 渲染；抽 `DiffEntryRow`、export `DiffFileModal` 供重用 | AC-1,2 |
| `renderer/components/done-task-sheet.tsx` | `'diff'` 分頁 | AC-3~6 |
| `test/git.test.mjs` | commit 清單、working entries、commit entries、base 可抵達判斷（merge / squash 兩情境） | AC-2,3,5 |
| `test/service.test.mjs` | handler 參數驗證（非 hex sha、非清單內 sha/path → 拒絕或 null）；Done 卡無 PR 回 `none` | AC-5,7 |
| `e2e/web.e2e.mjs` | 切「依 commit」、點 commit、點檔看 diff；重整後保持 | AC-1,2 |
| `docs/README.md` | 加入本功能目錄 | — |
| `packages/core/src/specs.ts`、`test/specs.test.mjs` | 刪除 | AC-8 |
| `service.ts` / `client.ts` / `api.ts` / `IPC_API_MAP.md` | 移除 `task:getSpecs` | AC-8 |
| `test/service.test.mjs`、`test/master-cards.test.mjs` | 刪除 getSpecs 斷言 | AC-8 |
| `task-workspace-panel.tsx`、`done-task-sheet.tsx` | 拿掉決策分頁 | AC-8 |
| `AGENTS.md`、`docs/features/spec-tab/spec.md` | 文件同步 | — |

## 實作順序

0. **移除決策分頁**（獨立 commit）：UI、core、測試、文件。驗：兩個 typecheck、`npm test`。
1. **core git 函式 + 單元測試**：`git.ts` 新函式，`test/git.test.mjs` 覆蓋 live 與 Done 本地路徑。驗：`node scripts/run-tests.mjs ./test/git.test.mjs`、core typecheck。
2. **gh 路徑**：`getDoneCommitDiff` 的 gh 分支（gh 呼叫可注入以便測試 PR commits 前綴比對與 patch 解析）。
3. **handler + bridge + IPC map**：service / client / api / types；`test/service.test.mjs`。驗：`npm test`。
4. **Live UI**：偏好、切換、`commit-diff.tsx`、workspace panel 接線。驗：renderer typecheck、`npm run build:web`、瀏覽器實測。
5. **Done UI**：done sheet 分頁、PatchViewer。驗：同上，並以真實 Done 卡（merge 與 squash 各一）實測。
6. **e2e + 文件**：e2e 延伸、`docs/README.md`、本 plan 紀錄。

## 風險與依賴

- **gh 測試**：真實 `gh` 不進單元測試；gh 執行函式以參數注入 fake，AC-4 另以真實 GitHub repo 手動驗證。
- **短 sha 前綴撞號**：PR commits 中若有多筆同前綴，取完全符合者，否則回 `none`。
- **GitHub commit API 單檔 patch 上限 / 300 檔上限**：缺 patch 的檔照 Spec 註明；超過時列出 API 給的部分並註明可能不完整。
- **大型 branch 的 shortstat 成本**：上限 50 個 commit，`git log --numstat` 一次跑完；僅在「依 commit」顯示時輪詢。
- **專案資料夾不存在**：直接走 gh，不報錯。
- `readDiffFile` 泛化會碰到既有 live diff 路徑 → 既有 `git.test.mjs` 與 e2e 必須維持綠燈。

## 驗證計畫

| 檢查 | 命令或操作 | AC |
| --- | --- | --- |
| core typecheck | `npx tsc --noEmit -p tsconfig.json` | 品質 |
| renderer typecheck | `npx tsc --noEmit -p renderer/tsconfig.json` | 品質 |
| 單元測試 | `npm test` | AC-2,3,5,7 |
| build | `npm run build:web` | 品質 |
| e2e | `npm run test:e2e` | AC-1,2 |
| Live 實測 | `npm start -- --store-path <tmp> --no-open --port 47831`，開一張卡做 2 commit + 1 未 commit 修改，切換、點選、重整 | AC-1,2 |
| Done 實測（本地） | 一張 merge commit 合併的 Done 卡，開 Git diff 分頁點 commit，檔案 diff 可切 split | AC-3 |
| Done 實測（gh） | 一張 squash merge 的 Done 卡（有 PR），點 commit，檔案以 patch 顯示 | AC-4 |
| Done 實測（none） | 沒 PR 且未 merge 的 Done 卡，顯示原因 | AC-5 |
| 決策分頁已移除 | 開 In Progress 與 Done 卡，分頁列無「決策」 | AC-8 |
| 惰性載入 | 開 Done sheet 不切分頁，確認 host 無 git/gh 呼叫（暫時 log 或觀察 network WS 訊息） | AC-6 |

## 待確認事項

- 無

## 實作與驗證紀錄

（尚未實作）
