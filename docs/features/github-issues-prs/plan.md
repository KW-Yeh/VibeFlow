# Plan：GitHub Issue 與 PR 檢視

- 狀態：已確認
- 對應 Spec：[spec.md](./spec.md)
- Spec 確認依據：spec.md 2026-10-06 整份確認（方案 C、變體 2、指派給我 + 我建立的、tag = Issue Type、移除專案列兩個操作、重用新增任務表單、只取代上半部看板區）
- 更新日期：2026-10-06
- 確認紀錄：2026-10-06 使用者確認 Plan，授權依計畫實作

## 現有程式碼調查

| 檔案或專案 | 現有行為、可重用模式與調查依據 |
| --- | --- |
| `packages/core/src/service.ts` | handler table（:415），驗證用 `str`／`obj`／`requireTask`。`vibeflow:createTask`（:476）會把 `CreateTaskPayload`（:104）逐欄複製進 `createTaskFromInput`，所以新欄位要三處一起加。`shell:openExternal`（:849）已限定 http(s)。沒有任何依專案執行 `gh` 的 handler |
| `packages/core/src/git.ts` | `getPrStatus`／`getOutcomePr` 以 `pexec('gh', …, { cwd, env: execEnv() })` 執行 `gh`。owner/repo 的解析寫死在 `getGithubCompareUrl`（:1322）裡，無法重用。PR 轉卡時，`provisionWorktree`（:692）在分支只存在於 origin 時會走 `adoptRemoteBranch`，滿足 AC-6，不必改 |
| `packages/core/src/github-auth.ts` | `getGitHubCliAuthStatus()` 回傳 installed／authenticated／login，可用來判斷「沒有 gh／未登入」 |
| `packages/core/src/tasks.ts` | `CreateTaskInput`（:24）與 `createTaskFromInput`（:53）。Task 物件在 :127 組成，要在這裡加入 `github` |
| `packages/core/src/store.ts` | `Task` 型別。`validBoard`（service.ts:186）以 `...current` 重建卡片，新增的可選欄位在看板寫回時會保留 |
| `renderer/components/side-menu.tsx` | 依專案分組的任務樹、搜尋、專案 hover 操作，以及收合列與 SettingsDock。只有 `home.tsx` 使用 |
| `renderer/pages/home.tsx` | 負責 `SideMenu`／`KanbanBoard` 的接線。「刪除整個專案」（`handleDeleteProject`、確認 modal :595-635）只在 renderer 端逐張呼叫 `deleteTask`，core 沒有對應 handler，TUI、e2e、測試也沒有使用 |
| `renderer/components/kanban-board.tsx` | 上半部 `BoardColumns`，加上可拖曳分隔線，下半部工作區。沒有選取任務時，內嵌顯示 `NewTaskForm`（以 `initialProjectPath:nonce` 當 key） |
| `renderer/components/board-columns.tsx` | `TaskCard`（:151）與 h-12 header（`ProjectFilter`、計數）。專案篩選是 component 內的 local state |
| `renderer/components/new-task-dialog.tsx` | `NewTaskForm` 只有 `initialProjectPath` 一個初始值，title／description／branch／base 都從 `''` 開始。`detectGit`（:409）會把 base 重設成 `defaultBase`，會蓋掉預填值。`onSubmit` 是位置參數 |
| `renderer/components/markdown-content.tsx` | 已有安全的 markdown 渲染（停用 raw HTML），可直接用來顯示 Issue／PR 內文 |
| `renderer/lib/api.ts` | `bridge()` 不存在時 no-op。已有 `openExternal(url)`，但 `getPrStatus` 沒有元件在用 |
| `test/service.test.mjs`、`test/support/repo.mjs` | `createCore` + fake sessions 的測試樣板。`ui-consistency` 規則：rounded 階梯、`ring-[3px]`、button focus ring、field／section-label 共用字串、drawer／dialog 必須用 `DialogShell` header |
| `e2e/web.e2e.mjs` | 用 fakeBin 放假的 `claude`，並以 `PATH` 前置注入。完全沒有用到側邊欄的 selector，移除任務樹不會破壞現有 e2e |
| `gh` 2.96.0 實測 | `gh issue list --json` 支援 `issueType`、`milestone`、`labels`、`assignees`、`author`、`createdAt`、`body`。`gh pr list --json` 支援 `isDraft`、`headRefName`、`baseRefName`、`closingIssuesReferences`、`reviewDecision`。`--search "review-requested:@me"` 可用。單次呼叫約 1.1 秒 |

## 方案與取捨

**資料取得放在 core，renderer 只送意圖。**
- 新增 `packages/core/src/github.ts`。repo 由看板卡片的 `projectPath` → `origin` → `owner/repo` 推出，不讓前端傳路徑或指令。
- 每個 repo 抓兩份資料，各自快取 5 分鐘，帶 `force` 時重抓：
  - **inbox**（5 次 `gh`）：
    - open issue：`--assignee @me`、`--author @me`
    - open PR：`--assignee @me`、`--author @me`、`--search review-requested:@me`
    - 依 number 去重
  - **PR index**（1 次 `gh`）：`gh pr list --state all --limit 100`，用於任務卡片的分支對應與 closing issues。

  分成兩份，是為了讓看板載入時只需每個 repo 1 次呼叫就能顯示卡片連結；切到 Issues & PRs 分頁才抓 inbox。
- 執行 `gh` 的 runner 可注入，測試用 fixture 取代，不需要網路。
- 舊版 `gh` 不認得 `issueType` 時，去掉該欄位重試一次。

**Handlers：**
- `github:inbox` `{ force? }` 回傳 `{ status: 'ok' | 'gh-missing' | 'unauthenticated', fetchedAt, repos: [{ repo, projectPath, projectName, issues, prs, error? }] }`。
- `github:taskLinks` `{ force? }` 回傳 `Record<taskId, { issue?, pr? }>`，每項含 number、url、state（open／draft／merged／closed）。

同一個 origin 對到多個本機專案時，取最近使用的專案當作轉卡目標。

**卡片記住來源：** `Task.github?: { kind: 'issue' | 'pr'; repo: string; number: number; url: string }`。
- 由 `vibeflow:createTask` 的可選欄位 `github` 帶入，service 會驗證：`kind` 是列舉值、`repo` 符合 `owner/name`、`number` 是正整數、`url` 必須在 `https://github.com/` 之下。
- 不帶這個欄位的舊卡片視為沒有來源，不需要資料遷移。

**任務卡片連結（變體 2）的解析順序：**
1. `task.github`（issue 或 pr）。
2. 分支名稱對到 PR index 的 `headRefName`（同 repo，取 number 最大的）。
3. 已完成的卡片沿用 `outcome.pr`。
4. Issue 另外取 PR 的 `closingIssuesReferences`。

解析寫成純函式，在 core 端計算並測試。

**轉卡：** 沿用現有的內嵌 `NewTaskForm`。
- 新增 `initialDraft` prop：`{ title, description, branch?, baseBranch?, github }`。
- `detectGit` 完成後要重新套用預填的 base。
- `onSubmit` 尾端多一個可選參數 `github`，`home.tsx` 再把它傳給 `createTask`。
- 不另做精簡表單，agent、effort、附件等選項都能照常調整。

**UI：**
- **檢視狀態**：`view: 'board' | 'github'` 與 `githubProjectFilter` 放在 `home.tsx`，是純前端狀態，不寫進 core 或 store。
- **切換分頁**：新增 `ui/view-tabs.tsx` 的「看板 ｜ Issues & PRs」分頁，`BoardColumns` 與新的 `github-view.tsx` 兩個 header 共用。
- **詳情抽屜**：嵌在 Issues & PRs 檢視右側，寬 400px，屬於上半部看板區內的面板，不是 overlay，因此不受 `DialogShell` 規則約束；標題用一般文字層級，不用 `<h2>`。
- **側邊欄**：改寫為「檢視」與「專案」兩區。收合列保留看板、Issues & PRs、新增任務、設定四個圖示。

**捨棄的替代方案：**
- 用 `gh search issues --involves`：範圍太廣，會包含被提及、留過言的項目，不符合 Spec。
- 單次 `gh pr list --state open` 再於 client 端篩選：超過 100 筆的 repo 會漏掉。
- 打 GraphQL 一次取回所有資料：要自己處理分頁與欄位，比 `gh` 子指令複雜，現階段不需要。

## 預計修改

| 檔案 | 修改內容 | 對應驗收條件 |
| --- | --- | --- |
| `packages/core/src/github.ts`（新增） | 型別、`parseGithubRepo`、`gh` runner、inbox 與 PR index 抓取、合併去重、`issueType` fallback、TTL 快取、`resolveTaskLinks` 純函式 | AC-3、AC-7、AC-8 |
| `packages/core/src/git.ts` | `getGithubCompareUrl` 改用 `parseGithubRepo`（行為不變） | 工程品質 |
| `packages/core/src/store.ts` | `Task.github?: GithubRef` | AC-5、AC-9 |
| `packages/core/src/tasks.ts` | `CreateTaskInput.github`，寫入 Task | AC-5、AC-9 |
| `packages/core/src/service.ts` | `CreateTaskPayload.github` 的驗證與傳遞；新增 `github:inbox`、`github:taskLinks` | AC-3、AC-5、AC-7、AC-8 |
| `packages/core/src/client.ts` | `getGithubInbox(opts)`、`getGithubTaskLinks(opts)`，`createTask` payload 型別加上 `github` | AC-3、AC-7 |
| `packages/core/IPC_API_MAP.md` | 新增兩個 channel，更新 handler 數 | 工程品質 |
| `renderer/lib/types.ts`、`renderer/lib/api.ts` | re-export 型別；新增 bridge wrapper | AC-3、AC-7 |
| `renderer/components/side-menu.tsx` | 移除任務樹、搜尋、專案操作；改為「檢視」與「專案（Issue · PR 數）」；調整收合列 | AC-1 |
| `renderer/components/ui/view-tabs.tsx`（新增） | 「看板 ｜ Issues & PRs」分頁按鈕（`role="tab"`、focus ring） | AC-2 |
| `renderer/components/github-view.tsx`（新增） | header（分頁、篩選、「N 分鐘前更新」、重新整理）；Issues 與 PRs 兩欄卡片；詳情抽屜（markdown 內文、「在 GitHub 開啟」、「轉為 Backlog 卡片」、「已在看板」與「前往卡片」）；空狀態、錯誤、未登入、沒有 `gh` 各自的畫面 | AC-3、AC-4、AC-8 |
| `renderer/components/board-columns.tsx` | header 加入分頁；`TaskCard` 分支列加入 `#編號` 連結（狀態色，點擊時 `stopPropagation` 並 `openExternal`） | AC-2、AC-7 |
| `renderer/components/kanban-board.tsx` | 依 `view` 渲染 `BoardColumns` 或 `GithubView`；把 `newTaskDraft` 傳給 `NewTaskForm` | AC-2、AC-5 |
| `renderer/components/new-task-dialog.tsx` | `initialDraft` prop；在 `detectGit` 之後重新套用 base；`onSubmit` 尾端加 `github` | AC-5、AC-6 |
| `renderer/pages/home.tsx` | `view`／篩選狀態；inbox 與 taskLinks 的載入；轉卡 handler；移除刪除專案流程與 `onNewTaskForProject` 接線 | AC-1、AC-2、AC-5 |
| `test/github.test.mjs`（新增） | 解析 remote URL、合併去重、`issueType` fallback、gh-missing／unauthenticated／單一 repo 失敗、快取與 force、`resolveTaskLinks` 各條路徑 | AC-3、AC-7、AC-8 |
| `test/service.test.mjs`、`test/tasks-create.test.mjs` | `github` 欄位寫入並在重開後保留；不合法的 ref 被拒；`github:inbox` 在注入 runner 時的形狀 | AC-5、AC-8、AC-9 |
| `test/README.md` | 登記 `github.test.mjs` | 工程品質 |
| `e2e/web.e2e.mjs` | fakeBin 加一個假的 `gh`（依參數回傳 fixture JSON）；第二個專案的 origin 設為 `https://github.com/e2e/demo.git`（不 push）；流程：切到 Issues & PRs → 看到卡片 → 開抽屜 → 轉卡 → 表單已預填 → 建立 → Backlog 卡片顯示 `#編號` | AC-2 到 AC-5 |
| `AGENTS.md` | 專案結構補上 `github.ts`／`github-view.tsx`；架構段落說明 Issue／PR 資料來源（`gh`、快取） | 工程品質 |

## 實作順序

1. **Core**：`github.ts`、`Task.github`、兩個 handler、`client.ts`、`IPC_API_MAP.md`，加上 `test/github.test.mjs` 與 service／tasks 測試。驗證：`npx tsc --noEmit -p tsconfig.json`、`npm test`。完成後 commit。
2. **Renderer 資料層**：`types.ts`／`api.ts`；`home.tsx` 的狀態與載入；`NewTaskForm` 的 `initialDraft`。驗證：renderer typecheck。
3. **UI**：側邊欄改寫、`view-tabs`、`github-view`、`TaskCard` 連結、`kanban-board` 切換，並移除刪除專案流程。驗證：renderer typecheck、`npm test`（`ui-consistency`）、`npm run build:web`。完成後 commit。
4. **E2E**：假 `gh` 與新流程。驗證：`npm run test:e2e`。完成後 commit。
5. **執行期驗收**：用拋棄式 `--store-path` 啟動 host，PATH 前置假的 `gh`，資料與畫布一致：
   - 1440×900 截圖，與畫布方案 C 及任務卡片變體 2 做像素級比對（visual-parity）。
   - 檢查 375／768／1440 的 RWD。
   - 用真的 `gh` 對本 repo 抽查一次。
   - 錄製驗收影片。

   結果記錄到本文件的「實作與驗證紀錄」。
6. 文件（`AGENTS.md`、`test/README.md`），清除 `app`／`renderer/.next`，最後 commit。

## 風險與依賴

- **速率限制與延遲**：每個 repo 首次抓取約 5 秒（平行），專案多時更久。處理方式：快取、只在開啟分頁時抓 inbox、各 repo 獨立顯示載入與錯誤。
- **`@me` 是 `gh` 目前登入的帳號**：若與 repo 擁有者不同帳號，結果只會是該帳號相關的項目。這符合 Spec 的語意，在空狀態文案中註明是哪個帳號（取自 auth status 的 login）。
- **PR index 只看最近 100 個 PR**：更舊的分支對不到 PR。這時卡片不顯示連結，不會顯示錯誤的連結。
- **移除刪除專案是使用者決定的功能刪減**：逐張刪除卡片仍然可用。總結中會再提一次。
- **像素比對的基準是畫布 mockup**：資料以 fixture 對齊，但 mockup 省略了下半部工作區，品牌 logo 也是色塊。比對時以區塊尺寸、位置、間距、字級、顏色為準，並記錄可接受的差異。
- 不新增任何套件，lock 檔不變。

## 驗證計畫

| 檢查 | 命令或操作 | 對應驗收條件 |
| --- | --- | --- |
| Core 型別 | `npx tsc --noEmit -p tsconfig.json` | 工程品質 |
| Renderer 型別 | `npx tsc --noEmit -p renderer/tsconfig.json` | 工程品質 |
| 單元測試 | `npm test`（含新增的 `test/github.test.mjs`、`ui-consistency`） | AC-3、AC-5、AC-7、AC-8、AC-9 |
| 建置 | `npm run build:web` | 工程品質 |
| E2E | `npm run test:e2e` | AC-2 到 AC-5 |
| 像素比對 | visual-parity：畫布方案 C 與變體 2 的截圖對照 app 截圖（1440×900，相同 fixture） | AC-1 到 AC-4、AC-7 |
| RWD | visual-parity 在 375／768／1440 檢查水平溢出 | 工程品質 |
| 手動驗收 | 真的 `gh`：切換分頁、開抽屜、在 GitHub 開啟、PR 轉卡後啟動並確認沿用 origin 分支、重開 app 後連結仍在 | AC-4、AC-6、AC-9 |
| 驗收影片 | Playwright 錄製完整流程，放在 artifacts 資料夾，PR 建立後以 comment 上傳 | 全部 |

## 待確認事項

- 無

## 實作與驗證紀錄

2026-10-06 依計畫完成 1–6 階段。

**與計畫的差異：**

- **inbox 載入時機**：app 載入時與看板專案變動時也會抓 inbox（經 core 的 5 分鐘快取），不只在開啟分頁時抓，因為側邊欄的「專案」數量需要它。
- **Issue 狀態推定**：卡片上的 Issue 狀態只能從連到的 PR 推得。PR 已 merged → closed，其餘一律 open；手動關閉的 Issue 不會反映。
- **PR 卡片**：狀態（Open／Draft）和 review 狀態（待 review／已核准／要求修改）分成兩個 chip，畫布上合成一個「Review 中」。
- **Issues & PRs 標頭**：多了專案篩選（沿用看板的 `ProjectFilter`），畫布沒有畫。

**檢查結果（皆實際執行）：**

| 檢查 | 結果 |
| --- | --- |
| `npx tsc --noEmit -p tsconfig.json` | 通過 |
| `npx tsc --noEmit -p renderer/tsconfig.json` | 通過 |
| `npm test` | 通過，共 361 項（含新增的 `test/github.test.mjs` 11 項、`service.test.mjs` 2 項） |
| `npm run build:web` | 通過 |
| `npm run test:e2e` | 通過。原流程之外，新增：切到 Issues & PRs → 開 #112 → 轉卡 → 表單預填標題 → 建立 → `Task.github` 已寫入 store → 看板卡片顯示 `#112` |
| 像素比對（畫布方案 C） | 同一份 fixture、1440×900、上半部 1440×640，像素差異 6.28%。版面結構（側邊欄 320px、h-12 標頭、兩欄卡片、400px 抽屜）一致，差異集中在文字反鋸齒位移和新增的欄位。依比對結果修正了抽屜 metadata 欄寬（72→64px）和底部按鈕字級（13px）。證據：artifacts 的 `c1-issues-prs-view-vs-mock-1440.png` |
| computed style 比對（visual-parity diff） | 35 個元素配對成功，落差從 176 降到 169。剩下的落差是刻意保留，見下方「刻意保留的設計差異」 |
| 任務卡片變體 2 | 和畫布並排對照，分支列 `#108 #106` 的位置、顏色、圖示一致。證據：`c2-task-card-issue-pr-link-vs-mock.png` |
| RWD（375／768／1440） | `parity.py responsive` 沒有回報水平溢出。這個 app 與既有看板一樣是桌面 layout，手機版不在範圍內 |
| 驗收流程錄影 | 21 個步驟全過，沒有 console 錯誤。證據：`c3-convert-issue-to-backlog-card.mp4`（14 秒） |
| 真實 `gh` 抽查 | `KW-Yeh/VibeFlow`、`cli/cli` 的 issue／pr 列表與 PR index 解析正常（每個 repo 約 2 秒）。依分支名稱連到 merged PR、從 closing ref 找到 Issue 都正確 |

**刻意保留的設計差異：**

- **字級**：區段標題、chip 用 `text-xs`（12px），畫布是 11px。
- **抽屜內文**：用共用的 `MarkdownContent`（compact，12px、有底色卡片），畫布是 13px 純文字。
- **選取中的側邊欄項目**：沿用既有的 `bg-primary/15 text-primary`。

**沒有驗證到的部分：**

- 用真實 `gh` 抽查時，登入帳號在這兩個 repo 沒有被指派或自己建立的 open Issue／PR，所以「真實資料非空時的完整畫面」只靠 fixture 驗證。
- 由 PR 轉成的卡片啟動時沿用 origin 分支（AC-6），這條路徑走既有的 `adoptRemoteBranch`，這次沒有在真實 GitHub repo 上實際啟動一次。
