# Plan：pr-watch 與 Library 投遞恢復

- 狀態：待使用者確認 [Spec](spec.md) 與本 Plan
- 分級：Large（改公開行為：launch 指令、Library 語意；新增兩個出貨 skill）
- 工作位置：`main` 上有其他任務的未提交修改（task-sheet 等），實作在新 worktree／分支 `feat/pr-watch` 進行，不碰那些檔案。

## 階段

### 1. Library 投遞恢復（core）

- `packages/core/src/library.ts`：從 `85592c3^` 還原 `buildPluginDir`、`linkOrSkip`、`buildCodexHome`、`LibraryLaunchInfo`、`libraryLaunchInfoAt`、`libraryLaunchInfo`、`userCodexSkillsDir`、`projectSkillsDir`、`setLibraryEntryEnabled` 的使用。沿用現在的 `listLibrary`（含 builtin 狀態）時不傳 `builtinDir`，維持 launch 路徑不做 hash。
- `packages/core/src/launch.ts`：還原 `LaunchOptions.library`、Claude `--plugin-dir/--add-dir`、Codex `CODEX_HOME`、`library.promptText` 併入 sys（不還原 `buildArtifactPrompt`）。
- `packages/core/src/service.ts`：`pty:start` 啟動時 `libraryLaunchInfo(task.worktreePath)` 傳入；確認 handler table 仍有 `library:setEnabled`（若被移除則加回並更新 `IPC_API_MAP.md`、`client.ts`、`renderer/lib/api.ts`）。
- 測試：還原 `test/library.test.mjs` 被刪的 172 行並對齊現行 API；`test/claude.test.mjs` 加回 flag 斷言。
- 契約檢查：所有 `buildAgentCommand` 呼叫端（service、TUI、CLI）。

### 2. Library 投遞恢復（renderer）

- `library-panel.tsx` 加回啟用勾選框；`library-panel.tsx`／`settings-dialog.tsx` 文案改回會投遞。
- 跑 `ui-consistency`（勾選框須帶 `focus-visible:ring-[3px]`）。

### 3. address-review 通用版

- `packages/core/builtin-skills/address-review/SKILL.md`：由個人版改寫——去 CyberLink／個人路徑、語言跟隨使用者、auto-mode 分支、回覆隱藏標記。
- `scripts/review.mjs`：移植 `review-fetch.sh`／`review-commit.sh`／`review-reply.sh` 成 `fetch`／`commit`／`reply` 三個子命令；`reply` 附隱藏標記，`fetch` 只列未回覆項目。
- `scripts/pr-lib.mjs`：GraphQL 查詢與 `pendingItems`；pr-watch 附同一份。
- 測試：`test/builtin-pr-skills.test.mjs`，fake `gh` 由 `VIBEFLOW_GH_CMD` 注入。
- 實作中的修正：原 Plan 的 `--ack` 改為「回報即記入狀態檔＋GitHub 上的回覆標記」，不需要 agent 另外確認；base 檢查改用 GraphQL `compare.behindBy`（已在 octocat/Hello-World 驗證方向），不需本地 git 物件。

### 4. pr-watch skill 與腳本

- `packages/core/builtin-skills/pr-watch/SKILL.md`：觸發詞、背景執行、exit code 分派、auto mode、衝突處理、master 回報。
- `scripts/pr-watch.mjs`：依 Spec 的參數／事件／exit code；狀態檔原子寫入；可注入 `GH_BIN`／`GIT_BIN` 與 `--once`（單輪，給測試用）。
- 測試：`test/builtin-pr-watch.test.mjs` 覆蓋 AC-1、AC-2。
- 確認 `scripts/build-npm.mjs` 已整個複製 `builtin-skills/`（含 `scripts/`），必要時調整；`test/library-builtins.test.mjs` 若列舉內建名稱則更新。

### 5. 文件

- `AGENTS.md`「What a launch sends」：改寫為含 Library 投遞；Tech stack／structure 不變。
- `docs/features/prompt-free-artifacts/spec.md`：加註 2026-11-05 Library 投遞已恢復（Artifact 部分不變）。
- `docs/features/builtin-skills/spec.md`：內建清單加入兩支。
- `docs/README.md` 加入本目錄；`test/README.md` 加入新 suite。

### 6. 驗證（DoD）

1. `npx tsc --noEmit -p tsconfig.json`、`npx tsc --noEmit -p renderer/tsconfig.json`
2. `npm test`
3. `npm run build:web`、`npm run test:e2e`
4. `npm run build:npm` → 檢查 `dist-npm/dist/builtin-skills/{pr-watch,address-review}`
5. 執行時期：`npm start -- --store-path <tmp> --no-open --port 47831` 開卡片，確認 launch 指令帶 `--plugin-dir`、Library 面板勾選可切換；在測試 repo 的 PR 上做 AC-5（需要一個可以任意開/關 PR 的測試 repo——請使用者指定）。

## 取捨紀錄

- **監聽放 agent 端而非 core**：core 已有 `gh` 與 notifier，可做到零 token；但使用者指定「固定腳本＋skill」，且 agent 端腳本不需要動 handler table。若之後要讓沒開 agent 的卡片也能被喚醒，再考慮搬進 core。
- **Node 而非 bash**：VibeFlow 保證有 Node，Windows 也能跑；bash 版 `review-fetch.sh` 在 Windows 原生 shell 不可用。
- **重名 address-review**：保留同名讓觸發詞一致；Claude 端以 plugin 命名空間並存，不覆蓋使用者個人版。

## 2026-11-13 修正：只在衝突或必須跟上 base 時喚醒

- 狀態：依使用者提供的任務描述實作；對應 [Spec 修正段](spec.md)。
- 分級：Medium（兩個 skill 目錄、一個事件契約的增欄、一個預設行為改變）。

### 階段

1. **文件**：本段與 Spec 修正段（先 commit）。
2. **`pr-lib.mjs`**（`pr-watch/scripts/` 與 `address-review/scripts/` 兩份逐字相同）：`PR_QUERY` 多取 `mergeable mergeStateStatus`。
3. **`pr-watch.mjs`**：
   - 新增純函式 `baseReason(pr, base, opts)`：回傳 `'conflict' | 'behind' | null`。`base` 為 null 或 `behindBy <= 0` → null；`CONFLICTING` → `conflict`；`BEHIND` → `behind`；`opts.rebaseOnAnyBaseChange` → `behind`；其餘（含 `UNKNOWN`、欄位缺失）→ null。
   - `decide(pr, base, state, opts = {})` 在 comments 之後用 `baseReason`；`state.baseOid` 去重沿用；事件加 `reason`。
   - `baseline(pr, base, opts = {})`：`baseReason` 非 null 才記 `baseOid`。
   - `parseArgs` 加 `--rebase-on-any-base-change`；`watch` 把 `opts` 傳給 `decide`／`baseline`；檔頭註解同步。
4. **`SKILL.md`**：description、Options、第 2／3 節依 `reason` 分流。
5. **測試**：`test/builtin-pr-skills.test.mjs` 更新既有 base 測試與 spawn fixture，補 Spec 的各情境。
6. **驗證**：兩個 tsc 之外的 DoD 項目與本修正無關（沒動 renderer、handler table）；做 `npx tsc --noEmit -p tsconfig.json`、`npm test`、`--once` 對真實 PR 實跑。

### 取捨

- **以 GitHub 的 `mergeable`／`mergeStateStatus` 判斷，而非自己算衝突**：GitHub 已為 PR 維護這兩個欄位，且 `BEHIND` 只在分支保護要求跟上 base 時出現，正好是「不 rebase 就合不了」的定義；自己用 `git merge-tree` 需要本地 git 物件與額外成本。代價：`UNKNOWN` 期間會晚一輪才發現衝突（可接受，輪詢間隔 60 秒）。
- **仍要求 `behindBy > 0`**：避免 push 之後 `mergeStateStatus` 短暫過期而重複喚醒；`state.baseOid` 去重是第二道保護。
- **`reason` 只增不減**：舊版 SKILL 讀不到 `reason` 也不會壞；唯一消費者是同目錄的 SKILL.md。
- **旗標而非移除舊行為**：有人希望「base 一動就跟上」時用 `--rebase-on-any-base-change`，預設關閉。
- **fork PR**：沿用既有限制（`fetchBaseStatus` 回 null）。

### 同步機制（library-builtins.ts）

`syncBuiltinSkills` 在 host 啟動時比對出貨目錄的 `hashSkillDir` 與 Library 索引的 `builtinHash`：出貨版變了、且使用者的副本仍等於當初安裝的版本 → 以 `installBuiltin` 覆蓋並更新 `builtinHash`；使用者改過的副本不動。本次修改的是 `pr-watch/` 下的檔案，雜湊含整個目錄，因此未改動過的使用者會在下次 host 啟動自動拿到新版，不需另外處理。`test/library-builtins.test.mjs` 已有「未改動的副本跟著更新、改過的保留」的案例。

### 驗證結果

（實作完成後填入實際命令與結果。）
