# Spec：Jira tickets、分頁式 Issues & PRs 與一鍵建卡

- 狀態：已確認
- Ticket：尚無
- 需求來源：使用者需求（2026-10-07）：「新增 Atlassian 登入，透過 `acli jira auth login --web` 取得登入權限，
  下指令取得所有 assign 在自己身上的 ticket，顯示在 Issues & PRs 頁面。filter 各自類別處理：Jira 自己的 filter 是
  todo、in progress、done、architecture status，卡片顯示名稱、point、期限、編號；Issue 只留專案 filter；PR 保留現有全部
  filter。移除下方 terminal 區域，只在看板區才有；卡片詳情改成 modal；建立卡片時直接產生卡片，而不是只預填表單。」
- 更新日期：2026-10-07
- 2026-10-08 需求更新：Issues／PRs 跨所有與登入者相關的 GitHub repo 搜尋，與看板專案無關；沒有對應本機專案的項目，建卡前需選擇資料夾。
- 確認紀錄：2026-10-07 部分決策已確認（不是整份 Spec 確認）：
  1. Jira ticket 建卡時，在詳情 modal 底部選專案，**選了專案才能按「建立卡片」**；
  2. Done 的 ticket **只抓目前 active sprint** 內的；
  3. Jira 的 status filter **動態列出抓到的所有 status**（WR 專案實際有 To Do／In Progress／Architecture Review／To be Released／Done）；
  4. 版面：Issues & PRs 頁內分 **Jira／Issues／Pull Requests 三個分頁**，每個分頁有自己的 filter 和重新整理按鈕，卡片排成多欄。
  2026-10-07 整份 Spec 確認（含「待確認事項」所列的預設：Jira 卡顯示 status 標籤、建卡標題加 key 前綴、建立後 modal 不關閉、Story Points 欄位可在設定覆寫）。

## 問題與目標

Issues & PRs 檢視（`docs/features/github-issues-prs/`、`docs/features/github-filters/`）目前有以下問題：

- 只看得到 GitHub 的 Issue／PR，看不到使用者真正的工作來源：Jira 上指派給自己的 ticket。
- 三個篩選（專案／Assignee／發起人）同時套用到 Issue 和 PR 兩欄，但 Issue 其實只需要專案篩選。
- 頁面下方固定是任務 terminal 工作區，佔掉約一半的高度；在 Issues & PRs 檢視裡用不到它。
- 項目詳情是右側 400px 抽屜，內文長的 Issue 很擠。
- 「轉為 Backlog 卡片」只會把表單預填在下方工作區，還要再檢查、送出一次。

目標：

1. 在設定中加入 Atlassian 登入（底層是 `acli jira auth login --web`），登入後把指派給自己的 Jira ticket 列在 Issues & PRs 檢視。
2. Issues & PRs 改成三個分頁（Jira／Issues／Pull Requests），每類各自篩選、各自重新整理，卡片以多欄格狀排列。
3. 在 Issues & PRs 檢視時隱藏下方 terminal 區，頁面使用全高；看板檢視維持現狀。
4. 項目詳情改為置中 modal。
5. 在 modal 內按「建立卡片」直接產生 Backlog 卡片。

## 範圍

### 本次包含

- **Atlassian 登入**：設定對話框新增「Atlassian（Jira）」頁，可看到 acli 是否安裝、登入狀態（site、email），並提供「用瀏覽器登入」「取消」「登出」。
- **Jira 收件匣**：用 `acli` 抓 `assignee = currentUser()` 的 ticket，範圍是所有未完成的 ticket，加上 active sprint 內已完成的 ticket；結果快取 5 分鐘，可強制重新整理。
- **Issues & PRs 分頁化**：三個分頁，各自有篩選列、筆數、更新時間和重新整理按鈕。
  - Jira：Status 複選篩選，選項動態產生。
  - Issues：只有專案複選篩選。
  - Pull Requests：專案／Assignee／發起人三個篩選，行為與現在相同。
- **Jira 卡片**：顯示編號（key）、名稱（summary）、Story Points、期限（due date），另外加上 status 標籤與「已在看板」標記。
- **卡片多欄排列**：依寬度自動決定欄數的 grid。
- **詳情 modal**：Jira／Issue／PR 共用同一個 modal 殼，取代右側抽屜。
- **一鍵建卡**：在 modal 內直接建立 Backlog 卡片。
  - Issue／PR 的專案由 repo 決定。
  - Jira 必須先在 modal 內選專案。
  - 卡片記錄來源 Jira ticket（新增 `Task.jira`），用來顯示「已在看板／前往卡片」。
- **移除 Issues & PRs 檢視的下方 terminal 區**：分隔線和工作區都不顯示，但任務的 PTY 繼續存在。
- 側邊欄的專案點擊、通知、「新增任務」等入口在新版面下的對應行為（見「行為」）。

### 本次不包含

- 寫回 Jira：轉換狀態、留言、指派、記錄工時都不做。
- API token 登入（`acli jira auth login --token`）、多 site 切換（`acli jira auth switch`）。
- 看板卡片或任務工作區顯示 Jira 連結和狀態。本次只存 `Task.jira`，不改看板卡片的 UI。
- 看板（Board）檢視的版面、篩選和任務工作區（`task-workspace-panel.tsx`）本身。
- Jira ticket 的子任務、Parent 階層展開，以及 Epic／Sprint 篩選。
- 篩選條件或目前分頁的留存。只存在 session 內，重新整理後回到預設。
- TUI。
- 把「Issues & PRs」這個 view tab 改名。

## 行為

### A. Atlassian 登入（設定 → Atlassian）

| 情境或觸發條件 | 預期行為 |
| --- | --- |
| 開啟設定 | 「GitHub」列下方新增「Atlassian（Jira）」列，顯示目前狀態摘要（未安裝／未登入／`<email> · <site>`），點擊進入子頁 |
| 子頁：acli 未安裝 | 顯示「找不到 Atlassian CLI（acli）。」以及安裝說明連結（`https://developer.atlassian.com/cloud/acli/guides/install-acli/`，以外部瀏覽器開啟）和「重新檢查」按鈕 |
| 子頁：未登入 | 顯示「尚未登入 Atlassian。」與主要按鈕「使用瀏覽器登入」 |
| 按「使用瀏覽器登入」 | core 執行 `acli jira auth login --web`，acli 會自行開啟瀏覽器。畫面顯示互動式 CLI 終端，供使用者完成網頁授權後選擇相同的 Jira site；另有等待狀態與「取消」按鈕。若 acli 輸出了授權網址，額外顯示手動開啟登入頁的連結 |
| 瀏覽器授權完成 | 子頁顯示「已登入」、site、email 和「登出」按鈕；Issues & PRs 的 Jira 分頁自動重新抓取 |
| 按「取消」或關閉設定 | 結束 acli 登入程序，回到未登入狀態，不顯示錯誤 |
| acli 登入失敗 | 顯示 acli 的錯誤輸出（去除 ANSI），可再按一次「使用瀏覽器登入」 |
| 按「登出」 | 執行 `acli jira auth logout`，狀態回到未登入；Jira 分頁顯示未登入提示 |
| 等待登入中又按一次登入 | 先結束前一個登入程序，再開始新的 |

### B. Issues & PRs 檢視：頁面與分頁

| 情境或觸發條件 | 預期行為 |
| --- | --- |
| 切到「Issues & PRs」 | 下方 terminal 分隔線和工作區不顯示，檢視佔滿整個主區高度；正在執行的任務 PTY 不會被關閉 |
| 切回「看板」 | 分隔線和工作區照原本高度出現，原本選取的任務和 terminal 內容都在 |
| 第一次進入 Issues & PRs | acli 已登入時預設進 Jira 分頁，否則進 Issues 分頁；之後記住本次 session 最後所在的分頁 |
| 分頁標籤 | `Jira  N`、`Issues  N`、`Pull Requests  N`，N 為套用篩選**前**的筆數；尚未抓到資料時不顯示數字 |
| 切換分頁 | 只切換內容，不會重新抓取；每個分頁的篩選各自保留 |
| 分頁工具列 | 左邊是該分頁的篩選，「清除篩選」只在有篩選生效時出現；右邊依序是帳號、`N 筆`、`X 分鐘前更新` 和重新整理按鈕 |
| 按 Jira 分頁的重新整理 | 只強制重新抓 Jira |
| 按 Issues 或 PRs 分頁的重新整理 | 強制重新抓 GitHub（Issue 與 PR 共用一次抓取，所以兩個分頁一起更新），並更新任務連結 |
| 卡片排列 | 依可用寬度自動決定欄數（每欄最小 300px），由左到右、由上到下排列；列表區自己捲動 |
| 側邊欄點專案 | 切到 Issues & PRs；若目前在 Jira 分頁則切到 Issues 分頁。Issues 和 PRs 兩個分頁的專案篩選都設為只有該專案；再點同一個專案則兩者都清空 |

### C. Jira 分頁

| 情境或觸發條件 | 預期行為 |
| --- | --- |
| 抓取範圍 | JQL：`assignee = currentUser() AND (statusCategory != Done OR sprint in openSprints()) ORDER BY updated DESC`，抓全部（分頁抓取，最多 200 筆） |
| 排序 | 先依期限由近到遠，沒有期限的排最後；期限相同時依 key 的數字由大到小 |
| Status 篩選選項 | 抓到的所有 status 名稱。順序依 status category（To Do 類 → 進行中類 → Done 類），同類內依名稱排序。已勾選但重新整理後消失的值仍保留，方便取消 |
| Status 篩選 | 複選。沒勾任何選項時顯示全部；勾了就只顯示這些 status 的 ticket。按鈕文字規則與現有篩選相同：沒勾 =「所有 Status」，勾一個 = 該值，勾多個 =「Status · N」 |
| 沒有篩選、沒有 ticket | 「目前沒有指派給你的 Jira ticket」 |
| 有篩選、沒有符合的 ticket | 「沒有符合篩選條件的 ticket」 |
| acli 未安裝 | 分頁內容區置中顯示：「找不到 Atlassian CLI（acli）。安裝並登入後就能看到指派給你的 Jira ticket。」以及「開啟設定」按鈕 |
| acli 未登入 | 「尚未登入 Atlassian。」以及「開啟設定登入 Atlassian」按鈕 |
| 抓取失敗（網路、acli 錯誤） | 有舊資料時保留舊資料，並在列表上方顯示紅色提示列（錯誤訊息），重新整理按鈕仍可按；沒有舊資料時置中顯示錯誤 |
| 第一次載入中 | 置中顯示「讀取 Jira 中…」；重新整理期間重新整理圖示會旋轉，原資料保留 |

### D. Jira 卡片

| 欄位 | 呈現 |
| --- | --- |
| 編號 | 卡片首行左側：issue type 圖示加上 `WR-5729`（等寬數字、`text-xs`、`text-muted-foreground`） |
| Status | 首行右側小標籤，顏色依 category：To Do 類 `bg-accent text-muted-foreground`、進行中類 `bg-primary/15 text-primary`、Done 類 `bg-success/15 text-success` |
| 已在看板 | 若有卡片的 `task.jira.key` 等於此 ticket，首行顯示「已在看板」標記（沿用 GitHub 卡片樣式） |
| 名稱 | summary，最多兩行，`text-[15px] font-medium` |
| Point | 底列左側：`◆ 8 pt`；沒有值時顯示 `— pt`（muted） |
| 期限 | 底列右側：`截止 10/29`。已過期顯示 `已逾期 N 天`（`text-destructive`）；3 天內到期顯示 `剩 N 天`（`text-warning`）；今天到期顯示 `今天到期`（`text-warning`）；沒有期限顯示 `無期限`（muted）；滑鼠移上去時 title 顯示完整日期 |
| 點擊卡片 | 開啟詳情 modal |

### E. Issues 分頁與 PRs 分頁

| 情境或觸發條件 | 預期行為 |
| --- | --- |
| Issues 篩選 | 只有「專案」複選，行為與現在相同 |
| PRs 篩選 | 「專案」「Assignee」「發起人」三個複選，行為與現在相同（含「未指派」選項） |
| 篩選的獨立性 | Issues 的專案篩選和 PRs 的專案篩選是兩份獨立的值。只有側邊欄點專案時會同時設定兩者 |
| 選項來源 | 專案選項來自跨 repo 搜尋發現的相關專案；PRs 的 Assignee／發起人選項只從 PR 彙整（不再混入 Issue 的人） |
| 卡片內容 | 與現有 `GithubCard` 相同 |
| 排序 | 與現在相同：先依專案名稱，同專案內依編號由大到小 |
| 未登入、gh 未安裝、沒有相關 open 項目 | 在兩個分頁顯示對應提示，不依賴看板是否已有 GitHub 專案 |
| repo 抓取錯誤 | 紅色提示列沿用現有規則，依該分頁的專案篩選過濾 |

### F. 詳情 modal（三類共用）

| 情境或觸發條件 | 預期行為 |
| --- | --- |
| 點卡片 | 開啟置中 modal，被選卡片加上選取外框；modal 開啟時背景不能捲動、不能點擊 |
| 關閉 | 按 Esc、點遮罩、按右上角 X 都會關閉 |
| 篩選或重新整理後項目不見了 | modal 自動關閉 |
| Jira modal 的 meta | 狀態、類型、Story Points、期限（含相對文字）、Sprint、優先度、Parent（key，可點擊開啟 Jira）、建立時間、更新時間 |
| Issue／PR modal 的 meta | 與現有抽屜相同（專案、發起人、指派、建立時間、Issue Type／分支、Review、Labels、Milestone） |
| 內文 | Markdown 呈現。Jira 的 description（ADF）由 core 轉成 Markdown；沒有內文時顯示「沒有內文」 |
| 底部左側 | 「在 Jira 開啟」或「在 GitHub 開啟」（外部瀏覽器） |

### G. 一鍵建卡

| 情境或觸發條件 | 預期行為 |
| --- | --- |
| Issue／PR，尚未有卡片 | 底部右側顯示「建立到：`<專案名>`」（muted）和主要按鈕「建立卡片」 |
| Issue／PR 的 repo 尚未對應看板專案 | 仍顯示項目；底部需先選擇最近使用的本機專案或瀏覽資料夾，未選時停用「建立卡片」 |
| Jira，尚未有卡片 | 底部右側顯示專案下拉（placeholder：「選擇專案…」）和「建立卡片」。**沒選專案時按鈕停用**，hover 時 title 顯示「先選擇要建立到哪個專案」 |
| Jira 專案下拉的選項 | 看板上所有卡片的專案，加上最近使用的專案（`projects:listRecent`），依路徑去重、依名稱排序；每列顯示專案名稱（主要文字）和路徑（muted、截斷）。不預選任何專案，也不記住上次的選擇 |
| 按「建立卡片」 | 按鈕顯示轉圈和「建立中…」，按鈕與下拉都停用；不顯示全螢幕的「建立任務中」對話框 |
| 建立成功 | 卡片出現在看板 Backlog 最上方。modal 不關閉，底部改為成功狀態：左側出現 `✓ 已建立到 Backlog`（`text-success`），右側為「再建一張」（ghost）和「前往卡片」（主要按鈕）。列表上的卡片同步出現「已在看板」標記。畫面停留在 Issues & PRs 檢視 |
| 建立失敗 | modal 底部上方顯示紅色錯誤訊息，按鈕恢復可按 |
| 已有卡片 | 底部右側為「再建一張」（ghost，title：「已經有對應卡片，仍可再建一張」）和「前往卡片」（主要按鈕） |
| 按「再建一張」 | Issue／PR 直接建立；Jira 會在按鈕左側出現專案下拉，選好後再按一次「建立卡片」 |
| 按「前往卡片」 | 關閉 modal，切到「看板」檢視，用 pin 的方式開啟並選取該卡片的 tab |
| 卡片內容：Issue／PR | 與現有 `draftFromItem` 相同：標題 = Issue／PR 標題；描述 = URL 加上內文；PR 另外帶 `branch = headRefName`、`baseBranch = baseRefName`；記錄 `github` ref |
| 卡片內容：Jira | 標題 =「`<KEY> <summary>`」（例：`WR-5729 修正登入錯誤`）；描述 = ticket URL 加上空行，再加上 Markdown 內文；記錄 `jira` ref（key、url、site）；分支名由標題自動產生 |
| 卡片的其他欄位 | agent、model、effort、base branch 都交給 core 預設（與 CLI `task create` 不帶參數時相同）；auto mode 繼承全域設定；狀態為 Backlog，不建立分支或 worktree（lazy provisioning 規則不變） |

### H. 其他入口在新版面下的行為

| 情境或觸發條件 | 預期行為 |
| --- | --- |
| 在 Issues & PRs 檢視按側邊欄「新增任務」 | 切回「看板」，並在下方工作區顯示空白新增表單（與現在在看板按的行為相同） |
| 在 Issues & PRs 檢視點進度通知 toast 或桌面通知 | 切回「看板」並開啟該卡片的 tab |
| 在 Issues & PRs 檢視時，CLI 或外部寫入讓看板變動 | 「已在看板」標記即時更新 |

## UI 規格

所有樣式都使用 shadcn token class，遵守 `docs/DESIGN.md` 的 radius ladder（`test/ui-consistency.test.mjs` 會檢查）。手寫的按鈕都要加 `focus-visible:ring-[3px] focus-visible:ring-ring/50`。

### 1. 整體結構（Issues & PRs 檢視）

```
┌──────────────────────────────────────────────────────────────────────────┐
│ 看板   Issues & PRs                                                (h-12)│  ← 既有 ViewTabs，第一層
├──────────────────────────────────────────────────────────────────────────┤
│ Jira 11    Issues 3    Pull Requests 5                             (h-10)│  ← 第二層分頁（新）
├──────────────────────────────────────────────────────────────────────────┤
│ [◎ 所有 Status ▾]  [× 清除篩選]        kw@cyberlink.com · 11 筆 · 2 分鐘前更新  ⟳ │ (h-11)
├──────────────────────────────────────────────────────────────────────────┤
│ ┌─────────────┐ ┌─────────────┐ ┌─────────────┐ ┌─────────────┐          │
│ │ card        │ │ card        │ │ card        │ │ card        │          │
│ └─────────────┘ └─────────────┘ └─────────────┘ └─────────────┘          │  ← 捲動區
│ ┌─────────────┐ ┌─────────────┐                                          │
│ └─────────────┘ └─────────────┘                                          │
└──────────────────────────────────────────────────────────────────────────┘
   （沒有下方 terminal 分隔線與工作區）
```

- 第一層：沿用 `ViewTabs`，位置不變。
- 第二層分頁列：`h-10 border-b border-border px-5`，樣式與 `ViewTabs` 相同（底線式 tab、`role="tablist"`、`aria-label="來源"`）。
  - 數字用 `text-xs tabular-nums text-muted-foreground/80`，與標籤間隔 `gap-1.5`。
  - 左右方向鍵可以在分頁之間移動焦點。
- 工具列：`h-11 border-b border-border px-5 gap-3`。
  - 篩選沿用 `GithubFilterMenu`。
  - 右側摘要文字為 `text-sm text-muted-foreground`，過長時截斷。
  - 重新整理沿用 `IconButton`，抓取中圖示會轉（`animate-spin motion-reduce:animate-none`）。
  - 重新整理的 aria-label 依分頁分別是「重新整理 Jira ticket」「重新整理 Issue」「重新整理 PR」。
- 捲動區：`min-h-0 flex-1 overflow-y-auto px-5 py-4`，內含 `grid grid-cols-[repeat(auto-fill,minmax(300px,1fr))] gap-3 content-start`。
- Issues／PRs 分頁沒有專案篩選、又有多個專案時，在 grid 上方依專案分段：每段標題用 `SECTION_LABEL` 加上筆數，標題本身跨滿所有欄（`col-span-full`）。只篩選一個專案時不顯示段標題。Jira 不分段。

### 2. Jira 卡片

```
┌──────────────────────────────────────┐
│ ☐ WR-5729            已在看板 [In Progress] │  ← text-xs；type 圖示 size-3
│                                      │
│ 修正 CL.com 會員中心登入後導回錯誤頁面， │  ← text-[15px] font-medium, line-clamp-2
│ 需同時處理 SSO 回呼                    │
│                                      │
│ ◆ 72 pt                 剩 3 天 · 10/10 │  ← text-xs；期限依規則上色
└──────────────────────────────────────┘
```

- 外框沿用 `GithubCard`：`rounded-md border bg-card p-3`，選取時 `border-primary shadow-[0_0_0_2px] shadow-primary/20`，hover `border-input`。整張卡是一個 `button`，`aria-pressed` 表示是否選取。
- Issue type 圖示（lucide）：Bug → `Bug`（`text-destructive`）、Story → `BookOpen`（`text-success`）、Sub-task → `ListTree`、Epic → `Zap`（`text-primary`），其他類型 → `SquareCheck`。未指定顏色的用 `text-muted-foreground`。
- Point 用 `Diamond` 圖示（size-3）加上 `tabular-nums` 的數字。
- 期限顯示：一般是 `截止 M/D`；3 天內是 `剩 N 天 · M/D`；當天是 `今天到期`；過期是 `已逾期 N 天`；沒有期限是 `無期限`。title 一律顯示完整的 `YYYY-MM-DD`。
- 卡片的 accessible name：`<KEY> <summary>，<status>，<point>，<期限文字>`。

### 3. Issue／PR 卡片

內容不變（`GithubCard`），只改放進 grid。卡片高度不必一致，同一列各卡頂端對齊即可（`items-start`）。

### 4. 詳情 modal

```
┌───────────────────────────────────────────────────────────────┐
│ [In Progress]  WR · Task · WR-5729                         ✕  │  header px-6 py-4
│ 修正 CL.com 會員中心登入後導回錯誤頁面                          │  text-lg font-semibold
│ ┌───────────────────────────┬───────────────────────────────┐ │
│ │ 狀態      In Progress     │ Story Points  72              │ │  meta：兩欄 grid
│ │ 期限      2026-10-29（22 天後）│ Sprint   9/25-10/8         │ │  （< 640px 時改為一欄）
│ │ 類型      Sub-task        │ 優先度    Medium              │ │
│ │ Parent    WR-5722 ↗       │ 更新時間  2026-10-06 17:47    │ │
│ └───────────────────────────┴───────────────────────────────┘ │
├───────────────────────────────────────────────────────────────┤
│                                                               │
│   （Markdown 內文，捲動區）                                     │  px-6 py-5
│                                                               │
├───────────────────────────────────────────────────────────────┤
│ [↗ 在 Jira 開啟]          [選擇專案…            ▾] [＋ 建立卡片] │  footer px-6 py-4
└───────────────────────────────────────────────────────────────┘
```

- 用 `DialogShell`（`motionVariant="dialog"`），`contentClassName` 設為 `max-w-3xl w-[calc(100vw-2rem)] h-[min(80vh,760px)] rounded-lg p-0 flex flex-col`。header 和 footer 固定，內文區 `min-h-0 flex-1 overflow-y-auto`。
- `aria-label`：Jira 為「`<KEY>` 詳細內容」，GitHub 為「Issue #N 詳細內容」或「PR #N 詳細內容」。
- 開啟時 focus 在 X 按鈕，關閉後 focus 回到原本點的卡片。
- Status 標籤顏色規則同 Jira 卡片；Issue／PR 的狀態標籤沿用 `GITHUB_STATE_CLASS`。
- meta 用 `dl`，`grid grid-cols-[72px_minmax(0,1fr)_88px_minmax(0,1fr)] gap-x-4 gap-y-1.5 text-xs`；寬度 < 640px 時改為 `grid-cols-[72px_minmax(0,1fr)]`。
- 內文用 `MarkdownContent`（`compact`）。
- Footer 有四種狀態，依「有沒有卡片 × 是否已選專案（只有 Jira）」組合：

| 狀態 | 左側 | 右側 |
| --- | --- | --- |
| 尚未有卡片（Issue／PR） | 在 GitHub 開啟 | `建立到：<專案>`（muted text-xs）＋「＋ 建立卡片」 |
| 尚未有卡片（Jira） | 在 Jira 開啟 | 專案下拉（w-64）＋「＋ 建立卡片」（未選專案時停用） |
| 建立中 | 同上 | 下拉停用＋「⟳ 建立中…」（停用） |
| 已有卡片或剛建立 | 在 … 開啟；剛建立時再加 `✓ 已建立到 Backlog`（text-success text-xs） | 「再建一張」（ghost）＋「↗ 前往卡片」（primary） |

- 錯誤：footer 上方顯示 `role="alert"` 的 `bg-destructive/10 text-destructive text-sm rounded-md px-3 py-2`。
- 專案下拉：新增 `ProjectSelect` 元件，結構與 `GithubFilterMenu` 相同（`useDismissible`、`MENU_ITEM`），但是單選。觸發按鈕為 `h-8 rounded-md border border-input px-2.5 text-sm`。選單向上展開（`bottom-10`），最高 `max-h-72` 可捲動。

### 5. 設定 → Atlassian 子頁

沿用設定對話框中 GitHub 子頁的版型（返回、標題、狀態區、動作區）：

```
← Atlassian（Jira）

  ● 已登入
    cyberlinkcorp.atlassian.net
    kw_yeh@cyberlink.com                              [登出]

  VibeFlow 透過 Atlassian CLI（acli）讀取指派給你的 Jira ticket，
  只會讀取，不會修改 Jira 上的任何資料。
```

| 狀態 | 狀態區 | 動作區 |
| --- | --- | --- |
| 檢查中 | 轉圈＋「檢查 acli 狀態…」 | — |
| 未安裝 | `text-destructive` 的「找不到 Atlassian CLI（acli）。」 | 「安裝說明 ↗」（outline）、「重新檢查」（ghost） |
| 未登入 | 「尚未登入 Atlassian。」 | 「使用瀏覽器登入」（primary） |
| 等待瀏覽器 | 轉圈＋「請在瀏覽器完成 Atlassian 登入…」，有授權網址時再加「手動開啟登入頁 ↗」 | 「取消」（outline） |
| 已登入 | site、email | 「登出」（outline） |
| 錯誤 | `role="alert"` 的錯誤訊息 | 「使用瀏覽器登入」（重試） |

在狀態區下方，不論是否登入，都顯示一個 `Field`：「Story Points 欄位 ID（選填）」。

- placeholder：`customfield_10033, customfield_10016`；
- 說明：「留空時依序嘗試預設欄位；多個以逗號分隔」；
- 隨設定對話框的「儲存」一起寫入 `settings.jira.storyPointsFields`；
- 格式必須是 `customfield_\d+`，不符合時在欄位下方顯示錯誤，「儲存」停用。

## 驗收條件

- [ ] AC-1：acli 未安裝時，設定的 Atlassian 子頁和 Jira 分頁都顯示「找不到 Atlassian CLI（acli）」，並提供對應按鈕。
- [ ] AC-2：在設定按「使用瀏覽器登入」會啟動 `acli jira auth login --web`。完成瀏覽器授權後，子頁顯示 site 和 email，Jira 分頁自動載入 ticket；按「取消」會結束登入程序，回到未登入狀態。
- [ ] AC-3：按「登出」後，`acli jira auth status` 回報未登入，Jira 分頁顯示未登入提示。
- [ ] AC-4：Jira 分頁列出指派給自己的所有未完成 ticket，加上 active sprint 內已完成的 ticket；不在 active sprint 的 Done ticket 不會出現。
- [ ] AC-5：每張 Jira 卡片顯示 key、summary、Story Points（沒有值時顯示 `— pt`）、期限（含逾期與即將到期的配色）、status 標籤；排序為期限由近到遠，沒有期限的在最後。
- [ ] AC-6：Status 篩選的選項等於抓到的所有 status（含 Architecture Review、To be Released）；可複選；「清除篩選」會清空篩選。
- [ ] AC-7：Issues 分頁只有專案篩選；PRs 分頁有專案、Assignee、發起人三個篩選；兩個分頁的專案篩選互不影響；PRs 的 Assignee／發起人選項不含只出現在 Issue 的人。
- [ ] AC-8：每個分頁的重新整理只更新自己的資料來源（Issues 和 PRs 共用 GitHub 來源）；分頁標籤顯示篩選前的筆數。
- [ ] AC-9：在 Issues & PRs 檢視時看不到下方 terminal 分隔線和工作區；切回看板時，原本執行中的任務 terminal 內容與 agent 都還在（PTY 沒有重啟）。
- [ ] AC-10：點任一張卡片會開啟置中 modal；按 Esc、點遮罩、按 X 都能關閉；Jira 內文的標題、清單、連結、程式碼區塊會以 Markdown 呈現。
- [ ] AC-11：在 Issue／PR modal 按「建立卡片」後，不經過新增表單就在 Backlog 出現卡片，標題、描述、PR 分支與現有轉換規則一致；modal 切換為「已建立到 Backlog／前往卡片」。
- [ ] AC-12：Jira modal 沒選專案時「建立卡片」為停用狀態；選好專案按下後，Backlog 出現 `<KEY> <summary>` 卡片，描述含 ticket URL，store 中的 `task.jira` 有 key／url／site；列表上該 ticket 標示「已在看板」。
- [ ] AC-13：按「前往卡片」會切到看板並選取該卡片的 tab；在 Issues & PRs 檢視按「新增任務」或點通知時，也會切回看板。
- [ ] AC-14：`npx tsc --noEmit -p tsconfig.json`、`npx tsc --noEmit -p renderer/tsconfig.json`、`npm test`、`npm run build:web`、`npm run test:e2e` 全部通過。

## 限制與依賴

- 需要使用者自行安裝 Atlassian CLI（`acli`），且 VibeFlow host 的 PATH 找得到它（Windows 為 `acli.exe`）。
  - VibeFlow 不負責安裝 acli，也不保存任何 Atlassian 憑證；登入狀態由 acli 自己管理。
- `acli jira auth status` 沒有 JSON 輸出，需要解析純文字。`--fields` 搭配 custom field 的行為也未在官方文件確認。
  - Plan 的第 0 步是在有 acli 的機器上錄下實際輸出作為 fixture，再定案解析方式。
- Story Points 是各 site 自訂的欄位。CyberLink 的 site 上是 `customfield_10033`（Story Points），Jira Cloud 預設的 `customfield_10016`（Story point estimate）在這裡是空的。
  - Core 依序嘗試候選欄位，取第一個數值；設定中可覆寫欄位 ID。
- `--web` 登入會由 acli 在 host 機器上開啟瀏覽器。VibeFlow host 只綁 loopback，所以使用者與 host 一定在同一台機器上，這個假設成立。
- 「active sprint」依 Jira 的 `openSprints()` 判斷，沒有排進 sprint 的 Done ticket 不會出現（使用者已確認）。

## 待確認事項

- 無。四項主要決策與以下預設已於 2026-10-07 確認：
  - Jira 卡片額外顯示 status 標籤；
  - Jira 建卡的標題加上 key 前綴；
  - 建立成功後 modal 不關閉、畫面留在 Issues & PRs；
  - Story Points 欄位 ID 可在設定中覆寫。
