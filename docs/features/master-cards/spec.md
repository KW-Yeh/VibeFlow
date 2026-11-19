# Master 卡片（Orchestrator）— Spec（草稿）

> 狀態：**已實作**（Phase 1–5，以及 D2 第二階段：主動回報與 `task send`）。
> **Phase 7 修訂（已確認 2026-11-19，未實作）**：master 改為「規劃＋派工」，見文末〈Phase 7〉。D2 與
> 「Master 專屬 prompt」兩節中與它衝突的部分以 Phase 7 為準。
> UI 方案比較見同目錄的 design artifact（連結於對話中提供）。

## 問題

一個需求常常要拆成多張卡片、跨多個 repo 執行。現在只能由人手動拆卡、手動把卡拉進
In Progress、再逐張看進度。需要一個**不隸屬任何 repo** 的 Agent 負責拆解、派工、監聽。

## 名詞

| 名詞 | 意義 |
|---|---|
| Slave 卡片 | 現有的卡片。綁一個 git 專案，有自己的 branch + worktree。 |
| Master 卡片 | 新角色。不綁 repo、不建 branch / worktree，在一個工作目錄裡跑 agent，透過 board CLI 建立、啟動、監聽 slave。 |

## 範圍

### 要做

1. **建立卡片時選角色**：Slave（預設，舊行為完全不變）或 Master。
   - Master：title、prompt（description）、agent、model、effort、auto mode、附件照舊；
     **不選專案、不選 base / branch、不檢查是否為 git folder**。
   - CLI：`task create --role master`，不需要 `--project`。
2. **Master 的工作目錄** ⚠️（見決策 D1）。
3. **Master 專屬 prompt**：master 啟動時，在使用者的 system prompt 與卡片內容之外，
   額外注入一段 master 指引（怎麼拆卡、怎麼用 CLI 派工與監聽、何時回報）。
   slave（有 `masterId` 的卡）只拿 `slaveSystemPrompt()`，不套用使用者的 system prompt（2026-11-03，見 [jev-routing](../jev-routing/spec.md)）。
   這是 AGENTS.md「launch 只送 system prompt + title + description」規則的**明確例外**，
   需同步改 AGENTS.md。
4. **Slave 歸屬**：slave 最多一個 master；master 不能再有 master（不巢狀）。
   - `task create --master <id>`：建立時直接掛到 master 下（master 自己用
     `$VIBEFLOW_TASK_ID`）。
   - `task update --master <id|none>`：事後掛上 / 拿掉（UI 也能做）。
5. **用指令啟動卡片**：新增 `task start --task <id>`，效果等同在 UI 把卡片拉進
   In Progress：移欄、標 `launchedAt`、provision branch/worktree、**由 host 直接起 session**
   （不依賴瀏覽器開著）。需要 host 在跑；沒在跑就報錯，不偷偷只改 store。
6. **監聽**：新增 `task list --master <id> --json` / `task show --task <id> --json`，
   回傳每張 slave 的欄位、是否在跑、todo 進度（x/y）、最後活動、token、PR、`launchError`、
   完成時的 `outcome`。⚠️ 主動通知見決策 D2。
7. **UI**
   - 建立卡片對話框重新設計（方案見 design artifact）。
   - Board 上看得出：哪些 slave 有 master、master 是誰；slave 歸在 master 下方。
   - Master 卡片與 master workspace 額外顯示：擁有的 slave、各自負責什麼、目前進度。
8. **TUI**：至少能顯示 master/slave 關係與用 `n` 建立 master；細節以 Web UI 為準。

### 不做（這次）

- Master 巢狀（master 底下再掛 master）。
- Master 自動合併 slave 的 PR、由 master 的 agent 自行把 slave 拉到 Done（完成仍需人確認，因為會刪 worktree）。
  人在 master 的完成對話框勾選「一併完成子卡」則可以，見生命週期表。
- Master 跨機器 / 雲端派工。

## 資料形狀（會留存 → 需要 migration 說明）

`Task` 新增兩個**可選**欄位：

```ts
role?: 'master'          // 缺省 = slave，舊卡不需改寫
masterId?: string        // 只出現在 slave 上
workDir?: string         // master 指定的資料夾；缺省 = VibeFlow 自建
```

- Master 卡片：沒有 `projectPath` / `baseBranch`；`branch` 為空字串（避免改動必填型別的所有使用端）；
  `worktreePath` 指向 master 的工作資料夾；另有 `workDir?`（使用者指定的資料夾）。
- **Migration**：兩個欄位皆可選、缺省語意等於舊行為，舊 store 不需轉換。
  反向相容：舊版本 app 讀到新 store 時，master 卡片沒有 `projectPath`，舊版會把它當壞卡
  —— 接受此風險，在 release note 說明。
- 刪除 master：其 slave 的 `masterId` 一併清掉（slave 卡片保留）。
- 刪除 slave：master 不受影響。

## Master 生命週期

| 動作 | Master | Slave |
|---|---|---|
| 拉進 In Progress | 不 provision，直接在工作目錄啟動 agent | 照舊 provision + 啟動 |
| 完成（Done） | 不刪 worktree（沒有），只結束 session；若仍有未完成 slave，對話框列出它們，並提供預設不勾的「一併完成執行中的子卡」 | 勾選時：In Progress 的 slave 一起移到 Done 並依序清理（同 repo 不可並行切 base）；Backlog 的 slave 保留不動 |
| 退回 Backlog | 清 session；slave 不動 | 照舊 |
| Diff / 決策 / PR tab | 不顯示 | 照舊 |

## 決策

- **D1 Master 工作目錄（已定）**：預設 `<storeDir>/masters/<id>/work`（store 目錄跟著
  `--profile` / `--store-path`），第一次啟動時建立；建立時可改成任意既有資料夾，不必是 git。
  刪卡只刪 `<storeDir>/masters/<id>`，使用者指定的資料夾不動。實作上 master 的資料夾放在
  `worktreePath`，所以 terminal / transcript / artifacts 沿用，所有 git 操作前檢查 `isMasterTask`。
- **D2 監聽方式（已定，第二階段已實作；Phase 7 起 slave 不再回報、通知只剩 launch_failed／all_done，見文末）**：master 不輪詢。slave 用 `task send` 回報；slave 自己說不出口的
  （卡在權限、啟動失敗、session 結束、回合結束沒回報）由 host 代打一則 note 進 master。訊息一律以
  bracketed paste ＋ Enter 打進對方 terminal，包上 `<vibeflow from="…">` 標記；不打進權限對話框、等使用者
  停手 3 秒、同一 terminal 的寫入不交錯（`mailbox.ts`、`notifier.ts`）。只允許 master ↔ 自己的卡傳話，卡與卡
  之間經 master 轉傳；master 工作中照樣送（當插話），在權限對話框或 session 不在時排隊；佇列只在 host 記憶體。
  Codex 沒有 hook，偵測不到權限對話框，所以這兩項保護對 Codex 不生效。
  **修訂（Phase 6）**：打字會把使用者還沒送出的草稿一起送出，所以 Claude 卡改走 inbox：訊息放進
  `<worktree>/.vibeflow-inbox/`，由 agent 自己的 hook（PostToolUse／UserPromptSubmit 帶入、Stop 讓它接著做）讀取，
  不碰輸入框；只有 agent 閒置、輸入框沒有草稿、沒有人直接 tmux attach 時才打字叫醒。Codex 與沒有 inbox hook
  的舊 session 仍打字，但等到沒有草稿才送。PR 由 master 交代開發卡用 `pr` skill 開。
  原本第一階段的做法如下，保留作紀錄：第一階段由 master 自行輪詢 `task list --master`；
  「slave 狀態變化時 host 把事件推進 master terminal」列為第二階段。
- **D3 派工後是否啟動（已定）**：跟著 master 卡片的 auto mode。開 → master 直接
  `task start`；關 → slave 留在 Backlog，master 列出清單等使用者啟動。
- **D4 建立對話框（已定）：A1**。頂端 Slave／Master 切換，單頁雙欄；切換只換左欄
  （Slave：專案／Base／Branch；Master：工作目錄），標題、描述、agent、effort、附件保留。
  現有 modal 的兩步驟改成單頁。
- **D5 看板呈現（已定）：B2 巢狀**。
  - Slave 不再單獨出現在欄位裡，而是收在 master 卡片下方（master 在哪欄就跟到哪欄），
    每列以狀態點表示 slave 自己的欄位（Backlog／執行中／等待權限／Done／launchError），
    並顯示 todo 進度 x/y。
  - Master 卡片顯示「n 個 slave · m 完成」與整體進度條；巢狀清單可收合。
  - 點 slave 列 → 選取該 slave，開它的工作區；slave 的移欄透過工作區按鈕
    （開始／完成／退回）或右鍵選單，而不是拖曳。
  - 拖動 master 只移動 master 本身，slave 的欄位不變。
  - 沒有 master 的 slave 照舊顯示在欄位裡。
- **D6 Master 工作區（暫定）：C1**。Terminal 旁常駐 slave 表格；slave 工作區頂端顯示所屬
  master，可點回去。

## 驗收

- 建 master 不需選專案；啟動後 agent 在 D1 決定的目錄跑，沒有 branch/worktree 產生。
- master 用 CLI 建出的 slave 帶 `masterId`，`task start` 後 slave 在 In Progress 並有 session，
  瀏覽器重新整理後點開能接上同一個 session。
- Board 上 slave 歸在 master 下、master 卡片顯示 slave 清單與 x/y 進度。
- 舊 store（無新欄位）開起來行為與現在完全相同。

---

## Phase 7：Master 改為「規劃＋派工」

- 狀態：已確認
- Ticket：尚無
- 需求來源：使用者 2026-11-19 對話：「多數時候 master 與 slave 不太需要互相傳訊息，要 slave 做什麼我直接去該卡互動」；想要的流程是「任務交給 master → master 理解並拆解 → 派 slave 卡完成」。
- 更新日期：2026-11-19
- 確認紀錄：2026-11-19 使用者確認，Q1–Q5 全部照建議定案（見〈決策〉）。

### 問題與目標

現行設計（D2、`masterSystemPrompt()` 第 4–7 步）把 master 當成一直在迴圈裡的主管：slave 每做完、卡住就 `task send`
回報，回合結束沒回報時 host 也會通知 master，驗收問題由 master 轉傳，PR 等 master 交代才開。`slaveSystemPrompt()`
則告訴 slave「使用者主要透過 master 跟你協作」「沒有 master 要求就不要開 PR」，而且 slave 拿不到使用者的
custom system prompt 與 Library snippet。

實際用法是使用者直接和 slave 互動。這時：

- slave 把結果回報給沒人在看的 master，回報指令與「聽 master 的」指示和使用者的直接指示互相干擾。
- master 被大量回合結束、權限等通知叫醒，消耗 token 卻沒有產出。
- slave 少了使用者在 Settings 設定的 system prompt 與 Library，跟一般卡片行為不同。

目標：master 只做它不可取代的三件事——**理解並拆解**、**排定先後**、**收尾總結**；執行期間不在迴圈裡，
使用者直接和每張 slave 協作。

### 範圍

#### 本次包含

1. **Master 流程改為：規劃 → 等確認 → 派工 → 結束回合**。
   - 規劃：唯讀了解相關 repo，產出拆解計畫（每張卡的標題、專案、自包含 prompt、相依關係、卡與卡的介面約定），
     寫成 Artifact `plan.md` 並在 terminal 摘要。
   - 確認：依 master 的 auto mode（D8）。
   - 派工：建卡、宣告相依、啟動沒有前置的卡，然後結束回合；不輪詢、不監工。
2. **Slave 的 system prompt 改為一般卡片＋一段背景**：照一般卡片送 Library snippet、script listing 與使用者的
   custom system prompt，再加一段背景——屬於哪張 master 的計畫、兄弟卡各負責什麼、自己和它們的介面約定。
   移除「照 master 指示」「完成要回報」「沒有 master 要求不開 PR」等指示。
3. **宣告式相依 `after`**：`task create --after <id>`（可重複）／`task update --after <id|none>`。
   前置卡全部移到 Done 時，由 host 啟動這張卡（等同 `task start`），不需要 master 醒著判斷。
4. **Notifier 只送生命週期事件給 master**：移除 `blocked`、`turn_unreported`、`exited` 三種通知；
   保留 `launch_failed`；新增「這張 master 底下所有 slave 都已 Done」一則，叫醒 master 寫總結。
5. **Master 的相關專案**：建 master 卡時可選填多個專案（`--project` 可重複；UI 用既有的專案選擇器多選），
   存成 `Task.projects?: string[]`，啟動時交給 agent 作為可讀目錄（Claude `--add-dir`；Codex 對應設定）。
   只在 Backlog 可編輯，與其他欄位一致。
6. **UI**：master 底下的 slave 列顯示「等待 <id>」；master 卡片／工作區顯示計畫 Artifact 的入口。
7. 更新 AGENTS.md「What a launch sends」「Master cards」兩節與 `docs/README.md`（若新增文件）。

#### 本次不包含

- 移除 `task send`／`mailbox.ts`／`inbox.ts`：保留作為選用工具（使用者要 master 轉達、或 slave 真的需要問 master 時），
  只是不再是預設流程。
- 跨 master 或無 master 卡片之間的 `after`（只限同一張 master 底下的卡）。
- master 自動合併 PR、把 slave 移到 Done（維持人確認）。
- 相依卡從前置卡的 branch 接續開發（stacked branch）；相依卡照「Provisioning at launch」從啟動當下的 base 開分支。

### 行為

| 情境或觸發條件 | 預期行為 |
| --- | --- |
| master 拉進 In Progress | agent 讀需求、唯讀看相關 repo（`projects` 內的不跳權限確認），產出 `plan.md` Artifact 與 terminal 摘要 |
| master auto mode 關 | 產出計畫後停下等使用者回覆；使用者同意（或修改後同意）才建卡；建好的卡留 Backlog，由使用者啟動 |
| master auto mode 開 | 產出計畫後直接建卡，並啟動沒有 `after` 的卡 |
| 派工完成 | master 結束回合，列出 `<id>「<標題>」` 清單與相依；之後不主動輪詢 |
| 使用者在 slave 卡輸入 | slave 照使用者指示做；不會把結果 `task send` 給 master |
| slave 需要開 PR | 照一般卡片的行為（使用者的 system prompt／Library 決定），不再等 master 交代 |
| 卡片的前置卡全部 Done，且 master auto mode 開 | host 啟動這張卡（Backlog → In Progress + agent 啟動），從當下的 base provision |
| 前置卡全部 Done，master auto mode 關 | 不自動啟動；卡片在 Backlog 顯示「前置已完成，可開始」 |
| 前置卡被刪除 | 從 `after` 移除該 id；剩下的前置都 Done 時照上面規則處理 |
| 前置卡退回 Backlog | 相依卡繼續等待，不啟動 |
| `after` 指向不同 master 的卡、自己、或形成循環 | `task create`／`update` 拒絕（明確錯誤碼，例如 `INVALID_DEPENDENCY`） |
| slave 卡在權限確認、session 結束、回合結束 | 不通知 master（使用者直接在該卡看得到） |
| slave 啟動失敗（`launchError`） | 照舊通知 master 一次 |
| master 底下所有 slave 都 Done | 通知 master 一次；master 整理每張卡的結果與 PR 連結交給使用者 |
| 舊 session（Phase 7 之前啟動的 master／slave） | 沿用啟動時拿到的舊 prompt，`task send` 仍可用；重新啟動或 `--new-session` 後才換新 prompt |

### 驗收條件

- [ ] AC-1：auto mode 關的 master 啟動後產出 `plan.md` Artifact，在使用者同意前沒有建出任何卡片。
- [ ] AC-2：auto mode 開的 master 建出帶 `masterId` 的卡，沒有 `after` 的卡進 In Progress，有 `after` 的留在 Backlog，master 回合結束。
- [ ] AC-3：slave 的啟動指令包含使用者的 custom system prompt 與已啟用的 Library snippet，並含 master 背景段；不含「回報 master」「沒有 master 要求不開 PR」指示（`test/` 以 `launch.ts` 單元測試鎖定）。
- [ ] AC-4：前置卡移到 Done 後，auto mode 開的 master 底下相依卡由 host 啟動並 provision；auto mode 關時只顯示可開始。
- [ ] AC-5：`after` 的循環、指向別的 master 或自己時被拒絕；前置卡刪除後 `after` 被清理。
- [ ] AC-6：slave 卡在權限、回合結束、session 結束時，master 收不到通知；`launchError` 與「全部 Done」各收到一則。
- [ ] AC-7：帶 `projects` 的 master 啟動指令含每個專案的可讀目錄參數；不帶時沒有多餘參數。
- [ ] AC-8：沒有 `after`／`projects` 欄位的舊 store 開起來行為不變；舊卡不需轉換。

### 限制與依賴

- **資料形狀**：`Task` 新增兩個可選欄位：`after?: string[]`（只出現在有 `masterId` 的卡上）、`projects?: string[]`（只出現在 master 上）。Migration：兩者皆可選、缺省等於舊行為，舊 store 不需轉換；舊版 app 讀到會忽略（不會自動接力、master 讀 repo 會跳權限確認，但卡片可正常使用）。
- **契約變動**：`slaveSystemPrompt()`／`masterSystemPrompt()` 的內容、`NoteKind`、`task create`／`update` CLI flag、`vibeflow:createTask`／`updateTask` payload、`TaskSummary`（多回傳 `after`）、`IPC_API_MAP.md`。實作計畫要有「檢查所有使用端」階段。
- master 規劃時要讀 repo：master 的 cwd 不是 repo，Claude 讀 cwd 以外的路徑會跳權限確認，所以有 `projects`（D11）。
- 自動接力會在沒人看著時啟動 agent 並 provision 分支，只在 master auto mode 開時發生，與 D3 一致。

### 決策（2026-11-19 確認）

- **D7 相依接力**：host 依 `after` 自動啟動，master 不必醒著；只在 master auto mode 開時自動接力。
- **D8 規劃確認關卡**：跟著 master 的 auto mode——關 → 產出計畫後等使用者確認才建卡；開 → 直接派工。
- **D9 slave 背景段**：兄弟卡的 id、標題、一句話職責與介面約定；不放兄弟卡的完整 prompt。
- **D10 通知**：`launch_failed` 保留（會中斷相依鏈）；新增「全部 Done」；移除 `blocked`／`turn_unreported`／`exited`。
- **D11 master 讀 repo**：master 卡可選填相關專案 `projects`，啟動時作為可讀目錄交給 agent；不填則照 agent 自己的權限確認。

### 待確認事項

- 無
