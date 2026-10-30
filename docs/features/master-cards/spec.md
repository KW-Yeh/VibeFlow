# Master 卡片（Orchestrator）— Spec（草稿）

> 狀態：**實作中**。
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
- Master 自動合併 slave 的 PR、自動把 slave 拉到 Done（完成仍需人確認，因為會刪 worktree）。
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
| 完成（Done） | 不刪 worktree（沒有），只結束 session；若仍有未完成 slave 先警告 | 照舊 |
| 退回 Backlog | 清 session；slave 不動 | 照舊 |
| Diff / 決策 / PR tab | 不顯示 | 照舊 |

## 決策

- **D1 Master 工作目錄（已定）**：預設 `<storeDir>/masters/<id>/work`（store 目錄跟著
  `--profile` / `--store-path`），第一次啟動時建立；建立時可改成任意既有資料夾，不必是 git。
  刪卡只刪 `<storeDir>/masters/<id>`，使用者指定的資料夾不動。實作上 master 的資料夾放在
  `worktreePath`，所以 terminal / transcript / artifacts 沿用，所有 git 操作前檢查 `isMasterTask`。
- **D2 監聽方式（暫定）**：第一階段由 master 自行輪詢 `task list --master`；
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
