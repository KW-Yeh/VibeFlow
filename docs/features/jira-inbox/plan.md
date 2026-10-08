# Plan：Jira tickets、分頁式 Issues & PRs 與一鍵建卡

- 狀態：已確認
- 對應 Spec：[spec.md](./spec.md)
- Spec 確認依據：spec.md 2026-10-07 版，2026-10-07 整份確認
- 更新日期：2026-10-07
- 確認紀錄：2026-10-07 使用者確認 Plan（交由 Codex 依計畫實作）

> 給實作者（Codex）：依「實作順序」逐步進行，每一步結束時跑該步列出的檢查。所有路徑都相對於 repo 根目錄。
> 先讀 `AGENTS.md`，了解架構（handler table 加功能的順序）、Definition of Done 和只能用可擦除 TypeScript 的限制。

## 現有程式碼調查

| 檔案 | 現有行為、可重用模式 |
| --- | --- |
| `packages/core/src/github.ts` | `GhRunner`：可注入的 `(args) => Promise<string>`，測試不會碰網路。`createGithubService` 以 repo 為單位快取 5 分鐘（`GITHUB_CACHE_TTL_MS`），失敗也會快取。`GithubInbox.status`：`ok`／`gh-missing`／`unauthenticated`。**Jira 服務照這個形狀寫。** |
| `packages/core/src/github-auth.ts` | 用 `node-pty` spawn `gh auth login`，從輸出抓 device code，透過 `onEvent` 推送 `starting`／`code`／`success`／`error`／`cancelled`。同時只允許一個 `activeLogin`。`getGitHubCliAuthStatus` 用 `execFile`，並以 `ENOENT` 判斷未安裝。**`jira-auth.ts` 照抄這個結構。** |
| `packages/core/src/service.ts` | `createCore({ ghRunner, githubAuthStatus, … })` 可注入；已有 `settings:githubAuthStatus`／`startGithubAuthLogin`／`cancelGithubAuthLogin`／`logoutGithubAuth`、`github:inbox`、`github:taskLinks` handler。`vibeflow:createTask` 用 `isGithubRef` 驗證 `github`。 |
| `packages/core/src/store.ts` | `Task.github?: GithubRef`（約第 86 行），`AppSettings`（約第 151 行），`DEFAULT_SETTINGS`。 |
| `packages/core/src/tasks.ts` | `createTaskFromInput` 接收 `github` 並寫入卡片（約第 139 行）。`agentCli`／`model`／`effort`／`autoMode` 沒給時使用預設值，所以一鍵建卡不需要在前端決定這些欄位。 |
| `packages/core/src/client.ts` | `createBridge`：`getGithubInbox`、`on('github:auth')` 等。 |
| `packages/core/IPC_API_MAP.md` | handler table 文件（第 134–140 行是 GitHub 相關）。 |
| `renderer/pages/home.tsx` | `view`（`board`／`github`）和 `githubFilters` 都是 session state。`handleConvertGithubItem` 透過 `newTaskDraft` 和 `newTaskNonce` 預填下方表單（**要移除**）。`handleCreateTask` 會開啟全螢幕「建立任務中」對話框（一鍵建卡不使用）。`openTab(taskId, { pin })` 會選取卡片。`selectGithubProject` 處理側邊欄點專案。 |
| `renderer/components/kanban-board.tsx` | 上方 pane（第 425 行起，`view === 'github' ? githubView : <BoardColumns/>`），中間是 splitter（`role="separator"`），下方是 `tabBar` 加 `main`，`TaskWorkspacePanel` 用 `WorkspaceSurface` 包住並以 `hidden` 隱藏。**PTY 依賴這些 panel 保持掛載**（見第 490 行的註解）。 |
| `renderer/components/github-view.tsx` | `GithubView`：頂列有 ViewTabs、三個篩選和重新整理；兩欄 `Column`；右側是 `DetailDrawer`（400px）；`GithubCard`、`Chip`、`Avatar`、`ItemChips`、`Notice`。 |
| `renderer/components/github-filter-menu.tsx` | 複選下拉，可直接拿來做 Jira Status 篩選。 |
| `renderer/lib/github-filter.ts` | `GithubFilters { projects, assignees, authors }` 同時套用到 Issue 與 PR；`githubFilterOptions` 從 Issue 與 PR 一起彙整選項（**要拆開**）。 |
| `renderer/lib/github-display.ts` | `draftFromItem`、`boardGithubCards`、`relativeTime`、`absoluteTime`。 |
| `renderer/lib/use-github.ts` | `useGithubInbox` 的 request id 防止競態寫入。**`useJiraInbox` 照抄。** |
| `renderer/components/ui/dialog-shell.tsx` | modal 殼：`title`、`footer`、`contentClassName`、`bodyClassName`、`motionVariant`、`onClose`。 |
| `renderer/components/settings-dialog.tsx` | GitHub 子頁（`githubPage`、`githubPhase`、`onGithubAuthEvent`），可作為 Atlassian 子頁的版型。 |
| `test/github.test.mjs`、`test/github-filter.test.mjs`、`test/service.test.mjs`、`e2e/web.e2e.mjs` | 用假 `gh` runner 和 fixture 測試；e2e 用假 `gh`，只在 macOS／Linux 跑。 |
| 實際 Jira 資料（2026-10-07 以 Atlassian connector 查 cyberlinkcorp） | 專案 WR；status：To Do（new）、In Progress、Architecture Review、To be Released（以上為 indeterminate）、Done（done）。Story Points 在 `customfield_10033`，`customfield_10016` 為空。期限是 `duedate`（`YYYY-MM-DD`）。Sprint 在 `customfield_10020`（陣列，含 `state: "active"`）。 |
| acli 官方文件 | `acli jira auth login --web`（另有 `--site`／`--email`／`--token`）、`auth status`（**沒有 `--json`**）、`auth logout`。`acli jira workitem search --jql --fields --json --paginate --limit`。社群回報 `--fields` 搭配 custom field 不一定可靠，需要 spike 驗證。 |

## 方案與取捨

1. **Jira 資料走 core 的 acli runner，不用 REST + API token。** 使用者指定 `acli jira auth login --web`，憑證由 acli 自行保存，VibeFlow 不碰 token。runner 可注入，測試與 e2e 都用假 acli。
2. **登入用 node-pty 執行 acli**，與 `gh auth login` 相同。
   - acli 可能有互動提示（例如選 site），需要 TTY；輸出中出現的 URL 會轉成 `url` event，作為瀏覽器沒有自動開啟時的備援。
   - 不設定 `BROWSER=true`，讓 acli 自己開瀏覽器。host 只綁 loopback，所以使用者就在同一台機器上。
3. **一次 search 就把需要的欄位全部抓回來**（含 description），不額外對每張 ticket 呼叫 `view`。
   - 如果 spike 證實 `--fields` 抓不到 custom field，改用備援方案：search 只取 key，再以最多 4 個並行的 `acli jira workitem view <KEY> --fields "*all" --json` 補欄位。兩種方式都封裝在 `fetchJiraTickets` 內，對外的介面不變。
4. **Story Points 用候選欄位清單**，預設 `['customfield_10033', 'customfield_10016']`，取第一個數值。`settings.jira.storyPointsFields` 可以覆寫。因為無法用 acli 依欄位名稱查 ID，這是最低成本的跨 site 做法。
5. **Description 在 core 轉成 Markdown**（新增 `jira-adf.ts`）。renderer 已有 Markdown 管線，raw HTML 是關閉的，所以不要把 ADF 轉成 HTML。
6. **分頁、篩選、modal 都在 renderer。** core 只提供資料。`GithubView` 拆成容器加上三個 panel，避免一個檔案超過 800 行。
7. **隱藏下方工作區時用 CSS（`hidden`），不能 unmount**，因為 PTY 和 poller 的生命週期綁在 panel 的掛載上。`KanbanBoard` 現在就是用這個模式保留 panel。
8. **一鍵建卡直接呼叫既有的 `createTask`**，不新增 core API。只擴充 `jira` 欄位，並在 renderer 新增 `createTaskFromSource`，不經過 `handleCreateTask`，因此不會出現全螢幕的建立中對話框。

替代方案：在 renderer 直接叫 Atlassian REST。不採用，因為違反「前端只透過 handler table 存取 core」的規則，也需要另外處理 token。

## 預計修改

### Core（`packages/core/src`）

| 檔案 | 修改內容 | 對應 AC |
| --- | --- | --- |
| `jira.ts`（新增） | 型別：`JiraRef { key; url; site }`、`JiraStatusCategory = 'new' \| 'indeterminate' \| 'done'`、`JiraTicket { key; url; projectKey; summary; status: { name; category }; issueType; priority \| null; storyPoints: number \| null; dueDate: string \| null; sprint: string \| null; parentKey: string \| null; description: string /* markdown */; createdAt; updatedAt }`、`JiraInbox { status: 'ok' \| 'acli-missing' \| 'unauthenticated'; site?; email?; fetchedAt; tickets: JiraTicket[]; error? }`。另外有 `AcliRunner`、`defaultAcliRunner`（execFile `acli`，timeout 60s，maxBuffer 32MB，`windowsHide`）、`JIRA_INBOX_JQL`、`buildSearchArgs(fields)`、`toTicket(raw, site, pointFields)`、`isJiraRef(v)`（key 符合 `^[A-Z][A-Z0-9_]+-\d+$`，url 為 `https://<site>/browse/<key>`，site 結尾為 `.atlassian.net`）、`createJiraService({ run, authStatus, settings, now })`，提供 `inbox({ force })`，快取 5 分鐘，失敗也快取，`force` 會重抓 | AC-4、5、6、12 |
| `jira-adf.ts`（新增） | `adfToMarkdown(node): string`。支援 paragraph、heading、bulletList、orderedList、listItem、codeBlock（含 language）、blockquote、rule、hardBreak、text marks（strong、em、code、strike、link）、mention（`@name`）、inlineCard／blockCard（連結）、emoji（shortName）、table（GFM 表格）、mediaSingle／media（`[附件]`），未知節點遞迴取文字。輸入如果已經是字串就原樣回傳 | AC-10 |
| `jira-auth.ts`（新增） | `JiraAuthStatus { installed; authenticated; site?; email?; error? }`、`JiraAuthEvent`（`starting`／`url { url }`／`success { status }`／`error`／`cancelled`）、`getJiraAuthStatus(run?)`（`acli jira auth status`；`ENOENT` 表示未安裝；exit 0 且解析得到 site 表示已登入；用 `parseAuthStatus(text)` 寬鬆比對 `Site:`、`Email:`／`User:` 等行，並先去除 ANSI）、`startJiraLogin(onEvent)`（node-pty spawn `acli jira auth login --web`；遇到選 site 的提示時先寫入 `\r` 選預設值，依 spike 結果調整；擷取第一個 `https://` URL 送出 `url` event；exit 0 時送出 `success` 並附上最新狀態；exit 130 或輸出含 cancel 時送出 `cancelled`）、`cancelJiraLogin()`、`logoutJira()`（`acli jira auth logout`） | AC-1、2、3 |
| `store.ts` | `Task.jira?: JiraRef`；`AppSettings.jira?: { storyPointsFields?: string[] }` | AC-12 |
| `tasks.ts` | `CreateTaskInput.jira?: JiraRef`，有值時寫入卡片（與 `github` 相同） | AC-12 |
| `service.ts` | `CoreOptions` 增加 `acliRunner?`、`jiraAuthStatus?`。新增 handler：`settings:jiraAuthStatus`、`settings:startJiraAuthLogin`（事件 `jira-auth:event`）、`settings:cancelJiraAuthLogin`、`settings:logoutJiraAuth`（登出後清除 jira 快取）、`jira:inbox`（`{ force? }`）。`vibeflow:createTask` 增加 `jira` 驗證（`isJiraRef`，不合法時 invalid）並傳給 `createTaskFromInput`。`settings:set` 驗證 `jira.storyPointsFields` 的每一項都符合 `^customfield_\d+$`。登入成功後清除 jira 快取 | AC-2、3、4、12 |
| `client.ts` | `getJiraAuthStatus`、`startJiraAuthLogin`、`cancelJiraAuthLogin`、`logoutJiraAuth`、`getJiraInbox(opts?)`、`on('jira:auth')`；`createTask` 的 payload 型別加上 `jira?` | 全部 |
| `IPC_API_MAP.md` | 補上述 handler 與 event 的列 | 工程品質 |

### Renderer

| 檔案 | 修改內容 | 對應 AC |
| --- | --- | --- |
| `renderer/lib/types.ts` | re-export `JiraRef`、`JiraTicket`、`JiraInbox`、`JiraAuthStatus`、`JiraAuthEvent`、`JiraStatusCategory` | — |
| `renderer/lib/api.ts` | 新增上述 client 方法的 bridge-safe 包裝（bridge 不存在時回傳 null 或 no-op）；`createTask` 的 payload 加上 `jira?` | 全部 |
| `renderer/lib/use-jira.ts`（新增） | `useJiraInbox(loaded)`，結構照 `useGithubInbox`（request id 防競態），回傳 `{ inbox, loading, error, refresh, reload }`；另外訂閱 `jira-auth:event` 的 `success`，收到時 reload | AC-2、8 |
| `renderer/lib/jira-display.ts`（新增） | `JIRA_CATEGORY_CLASS`、`jiraTypeIcon(name)`、`dueInfo(dueDate, now) → { text, tone: 'none' \| 'normal' \| 'soon' \| 'today' \| 'overdue', title }`、`boardJiraCards(tasks) → Map<key, taskId>`、`draftFromTicket(ticket, site) → { title, description, jira }` | AC-5、12 |
| `renderer/lib/jira-filter.ts`（新增） | `JiraFilters { statuses: string[] }`、`EMPTY_JIRA_FILTERS`、`jiraStatusOptions(tickets, filters)`（依 category 再依名稱排序，保留已勾選但已消失的值）、`jiraEntries(tickets, filters)`（篩選後依期限由近到遠，null 在最後，再依 key 數字由大到小） | AC-5、6 |
| `renderer/lib/github-filter.ts` | `GithubFilters` 改為 `{ issues: { projects }, prs: { projects, assignees, authors } }`，`EMPTY_GITHUB_FILTERS` 同步調整。`githubFilterOptions(repos, kind, filters)` 只從該類資料彙整選項。`githubEntries` 吃對應的篩選。`hasGithubFilters(kind, filters)`。`toggleValue`、`UNASSIGNED` 保留 | AC-7 |
| `renderer/components/inbox-view.tsx`（新增，取代 `github-view.tsx` 的容器角色） | props：`view`、`onViewChange`、`tab`、`onTabChange`、github／jira 兩組 `{ inbox, loading, error, onRefresh }`、`githubFilters`、`onGithubFiltersChange`、`jiraFilters`、`onJiraFiltersChange`、`githubCards`、`jiraCards`、`projects`（Jira 專案下拉的選項）、`onCreateFromSource`、`onOpenTask`、`onOpenSettings`。內容：第一層 ViewTabs、第二層 `InboxTabs`、目前分頁的 panel、詳情 modal（`selected`：`{ source: 'jira' \| 'github', key }`，篩選後找不到就關閉） | AC-8、9、10 |
| `renderer/components/inbox-tabs.tsx`（新增） | 第二層分頁列（`role="tablist"`，支援左右方向鍵） | AC-8 |
| `renderer/components/jira-panel.tsx`（新增） | 工具列（Status 篩選、清除、摘要、重新整理）、`Notice`（未安裝、未登入、讀取中、錯誤）、`JiraCard` grid | AC-1、4、5、6 |
| `renderer/components/github-panel.tsx`（新增，從 `github-view.tsx` 抽出） | `kind: 'issues' \| 'prs'` 決定顯示哪些篩選（Issues 只有專案）；依專案分段的 grid；沿用 `GithubCard` | AC-7 |
| `renderer/components/github-view.tsx` | 把 `GithubCard`、`Chip`、`Avatar`、`ItemChips`、`Notice`、`MetaRow` 改為 export 給 panel 和 modal 使用（或搬到 `github-card.tsx`）；刪除 `GithubView`、`Column`、`DetailDrawer` | — |
| `renderer/components/inbox-detail-modal.tsx`（新增） | 依 spec UI 規格第 4 節實作。props：`item`（`{ source: 'jira'; ticket; site } \| { source: 'github'; entry }`）、`taskId`、`projects`、`onCreate(projectPath) → Promise<{ taskId } \| throws>`、`onOpenTask`、`onClose`。內部 state：`projectPath`（Jira 預設空字串）、`phase: 'idle' \| 'creating' \| 'created'`、`error` | AC-10、11、12、13 |
| `renderer/components/project-select.tsx`（新增） | 單選的專案下拉（`useDismissible`、`MENU_ITEM`），向上展開 | AC-12 |
| `renderer/components/kanban-board.tsx` | `view === 'github'` 時上方 pane 改為 `flex-1`（忽略 `boardHeight`），splitter 與下方工作區容器加上 `hidden`（**只用 class 隱藏，不改條件渲染**）。props `githubView` 改名為 `inboxView`。移除 `newTaskDraft` prop 和傳給 `NewTaskForm` 的 `initialDraft`（如果 `NewTaskForm` 的 `initialDraft` 沒有其他使用者，就一併移除，並更新 `new-task-dialog.tsx`） | AC-9 |
| `renderer/pages/home.tsx` | 新增 state：`inboxTab`（初始為 `null`，第一次拿到 jira 狀態後決定：已登入選 `jira`，否則選 `issues`）、`jiraFilters`。`githubFilters` 改用新形狀。新增 `useJiraInbox`、`jiraCards = boardJiraCards(allTasks)`。專案選項：看板上的專案和 `listRecentProjects()` 的結果依路徑去重。新增 `createTaskFromSource(draft, projectPath)`：直接呼叫 `createTask({ ...draft, projectPath, autoMode })`，成功後 `setBoard` 並回傳 task id，不呼叫 `openTab`、不使用 `setCreating`。新增 `goToTask(taskId)`：`setView('board')` 加上 `openTab(taskId, { pin: true })`。`handleOpenNewTask`、toast 的 `onOpen`、桌面通知的 onclick 都先 `setView('board')`。`selectGithubProject` 改為同時設定 `issues.projects` 和 `prs.projects`，在 Jira 分頁時切到 `issues`。刪除 `handleConvertGithubItem`、`newTaskDraft`。側邊欄的 `githubCount` 不變 | AC-7、11、12、13 |
| `renderer/components/settings-dialog.tsx` | 新增「Atlassian（Jira）」列與子頁（`jiraPage`、`jiraPhase`、`jiraStatus`、`jiraUrl`、`jiraError`、`jiraBusy`），依 spec UI 規格第 5 節實作；包含 Story Points 欄位 `Field`，隨儲存送出 `jira.storyPointsFields`。關閉設定時若正在登入，呼叫 `cancelJiraAuthLogin`。`onSave` 的簽名加入 jira 設定（`home.tsx` 同步調整） | AC-1、2、3 |

### 測試、e2e 與文件

| 檔案 | 修改內容 | 對應 AC |
| --- | --- | --- |
| `test/fixtures/jira/`（新增） | spike 錄下的 `auth-status-ok.txt`、`auth-status-logged-out.txt`、`search.json`（含 Story Points、duedate、sprint、ADF description）、`login-web.txt`（含 URL 的輸出）。**email、site、帳號 id 都要去識別化** | AC-1–6 |
| `test/jira.test.mjs`（新增） | `buildSearchArgs` 帶有 JQL 和欄位；`toTicket` 能解析 points 候選清單（10033 有值、10016 為 null 時取 10033；設定覆寫時採用覆寫值）、dueDate、sprint（取 active 的那個 sprint 名稱）、category；`isJiraRef` 的正反例；service：`ENOENT` 對應 `acli-missing`、未登入對應 `unauthenticated`、快取 5 分鐘、`force` 會重抓、失敗也快取；`parseAuthStatus` 能處理兩份 fixture | AC-1、3、4、5 |
| `test/jira-adf.test.mjs`（新增） | 每種節點都有對應的 Markdown 輸出；未知節點只取文字 | AC-10 |
| `test/jira-filter.test.mjs`（新增） | status 選項的排序、保留已勾選但消失的值、OR 篩選、期限排序 | AC-5、6 |
| `test/github-filter.test.mjs` | 改用新的 `GithubFilters` 形狀；Issues 只套用專案篩選；PR 的選項不含 Issue 的人 | AC-7 |
| `test/service.test.mjs` | 用假 acli 測試 `jira:inbox`；`createTask` 帶合法 `jira` 時卡片上有 `jira`，不合法的 `jira` 會被拒絕；`settings:set` 拒絕不合法的 `storyPointsFields` | AC-4、12 |
| `test/core-boundary.test.mjs` | 若 renderer 執行期需要匯入新模組，確認仍只有 types-only 匯入；新檔案只用可擦除的 TypeScript | 工程品質 |
| `test/ui-consistency.test.mjs` | 新元件要能通過（radius、focus ring、DialogShell header） | 工程品質 |
| `e2e/web.e2e.mjs` 加假 acli | 照假 `gh` 的做法放一個 `acli` 腳本到 PATH（只在 macOS／Linux）：`auth status` 回傳已登入、`workitem search` 回傳 fixture。流程：切到 Issues & PRs 時不應出現 separator；Jira 分頁顯示卡片和 points；用 Status 篩選；開啟 modal 後「建立卡片」為停用；選專案並建立後出現「已建立到 Backlog」；按「前往卡片」後回到看板，Backlog 有 `WR-… …` 卡片；Issues 分頁只有專案篩選；從 Issue 一鍵建卡 | AC-4–13 |
| `test/README.md` | 補上新增的 suite | 工程品質 |
| `docs/README.md` | Features 表新增 `jira-inbox` 一列 | 工程品質 |
| `README.md`（使用者文件） | 在 Issues & PRs 段落補一句「Jira：安裝 acli 後，到設定登入」 | 工程品質 |

## 實作順序

0. **Spike（必做，先做）**：在有 acli 並已登入 cyberlinkcorp 的機器上執行以下指令，把輸出（去識別化後）存進 `test/fixtures/jira/`，並在本 Plan 的「實作與驗證紀錄」寫下結論：
   - `acli jira auth status`：分別在已登入和未登入時記錄 stdout 與 exit code。
   - `acli jira auth login --web`：觀察是否有互動提示、是否輸出 URL、成功時的 exit code、Ctrl+C 時的 exit code。
   - `acli jira workitem search --jql "<JIRA_INBOX_JQL>" --fields "key,summary,status,issuetype,priority,duedate,parent,description,created,updated,project,customfield_10020,customfield_10033,customfield_10016" --json --paginate`：確認 JSON 的頂層形狀（陣列或 `{ issues }`）、custom field 是否有值、description 是 ADF 或字串。
   - 如果 custom field 沒有值：改測 `acli jira workitem view WR-5729 --fields "*all" --json`，並改採方案 3 的備援做法。
   - 檢查：fixture 已存在，結論已寫入 Plan。
1. **Core 資料層**：`jira-adf.ts`、`jira.ts`、`jira-auth.ts`，以及對應的測試。
   - 檢查：`node scripts/run-tests.mjs ./test/jira.test.mjs`、`./test/jira-adf.test.mjs`、`npx tsc --noEmit -p tsconfig.json`。
2. **Core 接線**：`store.ts`、`tasks.ts`、`service.ts`、`client.ts`、`IPC_API_MAP.md`、`service.test.mjs`。
   - 檢查：`npm test`、`npx tsc --noEmit -p tsconfig.json`。
3. **Renderer 基礎**：`types.ts`、`api.ts`、`use-jira.ts`、`jira-display.ts`、`jira-filter.ts`、`github-filter.ts` 改形狀，以及對應的測試。
   - 檢查：`npm test`。
4. **隱藏下方工作區**：`kanban-board.tsx`，以及 `home.tsx` 中入口切回看板的行為。
   - 檢查：手動確認 AC-9（開一張卡跑 `ping`／agent，切到 Issues & PRs 再切回，輸出仍在持續）。
5. **分頁與 panel**：`inbox-view.tsx`、`inbox-tabs.tsx`、`jira-panel.tsx`、`github-panel.tsx`，並拆解 `github-view.tsx`。
   - 檢查：`npx tsc --noEmit -p renderer/tsconfig.json`、`npm run build:web`。
6. **Modal 與一鍵建卡**：`inbox-detail-modal.tsx`、`project-select.tsx`、`home.tsx` 的 `createTaskFromSource` 和 `goToTask`，並移除舊的預填流程。
   - 檢查：同步驟 5，另外跑 `npm test`（ui-consistency）。
7. **設定 → Atlassian 子頁**：`settings-dialog.tsx`。
8. **e2e 與文件**：假 acli、e2e 流程、`test/README.md`、`docs/README.md`、`README.md`。
   - 檢查：`npm run build:web && npm run test:e2e`。
9. **Runtime 驗證**：執行 `npm start -- --store-path <tmp> --no-open --port 47831`（使用臨時 store），用真的 acli 跑一次 AC-1～AC-13，並截圖記錄。

## 風險與依賴

- **acli 輸出格式未定**（status 是純文字、JSON 頂層形狀、custom field）。對策：步驟 0 的 spike 加上寬鬆解析，解析失敗時回傳 `error` 而不是當掉；fixture 固定格式，acli 升級時由測試發現差異。
- **`--web` 登入有互動提示，或在 Windows 上 node-pty 的行為不同。** 對策：spike 時分別在 Windows 和 macOS 測；兩者不同時依平台分支處理。真的無法自動化時，退而在設定頁顯示「請在終端機執行 `acli jira auth login --web` 後按重新檢查」（需回報使用者，屬於 Spec 變更）。
- **隱藏工作區後 xterm 尺寸錯亂**：切回看板時 `FitAddon` 需要重新 fit。對策：確認 `task-terminal.tsx` 的 ResizeObserver 在 `display:none` 到可見時會觸發；如果不會，在 `view` 切回 `board` 時派送 resize。
- **`GithubFilters` 形狀變更**：所有使用者（`home.tsx`、側邊欄的 `activeProjects`、`github-filter.test.mjs`）要一起改。側邊欄的 `activeProjects` 用 `issues.projects` 和 `prs.projects` 的聯集。
- **`--paginate` 筆數**：上限 200 筆（`--limit 200`），超過時在工具列顯示「只顯示前 200 筆」。
- **Story Points 欄位因 site 而異**：已用候選清單和設定覆寫處理。
- **Jira description 很大**：search 一次抓回所有 description，筆數在 200 以內可以接受；maxBuffer 設為 32MB。
- **不新增 npm 依賴**：ADF 轉換自己寫，不引入 `adf-to-md` 之類的套件（AGENTS.md：新增依賴需要先提出）。

## 驗證計畫

| 檢查 | 命令或操作 | 對應 AC |
| --- | --- | --- |
| Core 型別 | `npx tsc --noEmit -p tsconfig.json` | AC-14 |
| Renderer 型別 | `npx tsc --noEmit -p renderer/tsconfig.json`（如有 duplicate 錯誤，先刪除 `renderer/.next`） | AC-14 |
| 單元與 handler 測試 | `npm test` | AC-1–8、12、14 |
| 建置 | `npm run build:web`（受限環境加 `-- --webpack`） | AC-14 |
| E2E | `npm run test:e2e`（假 acli、假 gh） | AC-4–13 |
| 登入流程（真 acli） | 設定 → Atlassian → 用瀏覽器登入 → 授權 → 顯示 site 和 email；取消；登出 | AC-1–3 |
| Jira 資料（真 acli） | Jira 分頁的 ticket 數、points、期限與 Jira 網頁一致；Done 只有 active sprint 內的 | AC-4、5 |
| 版面 | 在 1440／768 寬度截圖：三個分頁、grid 欄數會變；modal 在 375 寬度也不會水平溢出 | AC-8、10 |
| PTY 存活 | 看板開一張卡讓 shell 持續輸出 → 切到 Issues & PRs 30 秒 → 切回，輸出連續且沒有重啟 | AC-9 |
| 一鍵建卡 | Issue、PR、Jira 各建一張卡 → 看板 Backlog 有卡，store JSON 有 `github`／`jira` | AC-11、12 |

## 待確認事項

- 無阻礙實作的問題。步驟 0 的 spike 結果如果推翻方案 2 或 3（例如 `--web` 無法自動化），要回到使用者重新確認。

## 實作與驗證紀錄

- 2026-10-07：完成 Jira 資料層、ADF 轉 Markdown、`jira:inbox`/授權 handler、三個來源分頁、Status 篩選、Jira 詳情 modal 與直接建卡。GitHub Issue/PR 也改為 modal 內直接建卡；Issues & PRs 檢視隱藏下方工作區但保持 mounted。
- 在 Windows x64 依 [Atlassian 官方安裝指南](https://developer.atlassian.com/cloud/acli/guides/install-windows/) 將官方 `acli.exe` 安裝至使用者 PATH；`acli --version` 為 `1.3.39-stable`。本機 `workitem search --help` 確認支援 `--jql`、`--fields`、`--json`、`--paginate`、`--limit`。尚未登入時，`auth status` 以 exit 1 回報 `unauthorized`。
- PTY 執行 `acli jira auth login --web` 顯示 `Authenticating...` 後回報 `authentication failed`；使用者在瀏覽器完成授權後，`auth status` 仍是 `unauthorized`。依官方 OAuth 流程，網頁 Accept 後還須在 CLI 終端選擇相同 site，因此設定頁已加入互動式 CLI 終端。真實 search JSON、custom field 與 site/email status 格式仍待登入成功後驗證；測試以假 runner 覆蓋陣列和 `{ issues }` 格式，未把真實 ticket 內容存入 fixture。
- 驗證：core/renderer TypeScript、`npm run build:web`、Jira 單元測試、service 測試，以及含 Jira 建卡流程的 `npm run test:e2e` 通過。完整 `npm test` 在此 Windows 環境有 5 個既有環境失敗：3 個 Node 路徑含空白的 CLI 子程序測試、2 個缺少 symlink 權限的 artifact 測試；Jira 測試全部通過。
- 2026-10-08：修正 Issues 分頁篩選列（僅顯示專案篩選），將原本仍使用預填表單的 E2E 改成 modal 直接建卡流程，並讓 Windows 子程序測試清理暫存目錄時重試短暫的檔案鎖。macOS 本機驗證：core/renderer TypeScript、`npm test`（421 通過）、`npm run build:web`、`npm run test:e2e`（2 通過）。本機未安裝 `acli`，因此真實 Atlassian OAuth、ticket JSON/custom fields 與登出流程仍未驗證。
