# VibeFlow

VibeFlow 是一款專為本地開發設計的「意圖驅動」看板平台。它將 Claude Code CLI 的強大生成能力與 Git Worktree 的多工隔離機制結合，讓開發者能透過視覺化看板同時管理多個開發任務，並在獨立的工作區中安全地進行代碼實驗與自動化實作。

## 🛠 核心技術棧 (Tech Stack)

* **外殼**: Electron (Node.js 原生 API 支援)
* **前端**: Next.js (React) + Tailwind CSS + shadcn/ui
* **看板**: `@hello-pangea/dnd`
* **終端**: `xterm.js` + `node-pty` (處理雙向互動式 CLI)
* **儲存**: `electron-store` (本地持久化)

## 📂 專案資料結構與 Worktree 隔離設計

VibeFlow 會在您開啟的專案中建立一個隱藏的暫存空間，確保主目錄程式碼在開發過程中保持乾淨：

```
[專案目錄] /
├── .vibeflow/                      <-- 自動加入 .gitignore
│   ├── task-uuid-1/                <-- 卡片 A 的獨立 Worktree (分支: vf-task-1)
│   └── task-uuid-2/                <-- 卡片 B 的獨立 Worktree (分支: vf-task-2)
├── src/
└── package.json
```

## 🚀 核心工作流

### 1. 任務初始化 (Task Creation)

* **路徑偵測**: 使用者選擇本地專案資料夾，App 自動檢查 Git 狀態與 Remote 資訊。
* **分支策略**: 若有 Remote，彈窗讓使用者選擇基準分支（Base Branch）。
* **背景準備**:
   1. 自動將 `.vibeflow/` 寫入 `.gitignore`。
   2. 執行 `git worktree add -b vf-[id] .vibeflow/vf-[id] origin/[選定分支]`。
   3. 執行 `git push -u origin vf-[id]` 將工作分支同步至雲端。

### 2. 交互執行 (Execution & Live Terminal)

* **PTY 整合**: 當卡片拖入 `In Progress` 或點擊執行，Electron 主進程透過 `node-pty` 在該 Worktree 路徑啟動 `claude` CLI。
* **互動模式 (Type A)**:
   * 卡片展開為 **互動式終端機**。
   * 使用者可直接在畫面上回答 Claude 的提問（例如：`y/n` 或確認指令）。
* **多工並行**: 支援同時啟動多張卡片，每張卡片擁有獨立的 PTY 進程與 Worktree 環境，互不干擾。

### 3. 審查與清理 (Review & Finalize)

* **視覺化 Diff**: 任務完成後，讀取該 Worktree 的 `git diff` 並以 Side-by-side 模式呈現。
* **一鍵合併**: 使用者點擊 Approve 後，App 在 Worktree 執行 `git commit` 與 `git push`。
* **自動清理**: 卡片移至 `Done` 後，App 自動執行 `git worktree remove`，徹底刪除 `.vibeflow/` 下的暫存資料夾，保持硬碟整潔。

## 📅 開發階段 (Milestones)

### 第一階段：基礎架構 (Day 1-2)

* [ ] 搭建 Electron + Next.js 環境。
* [ ] 實作看板拖曳介面。
* [ ] 整合 `electron-store` 紀錄本地專案路徑與卡片狀態。

### 第二階段：Git 自動化 (Day 3-4)

* [ ] 實作 `git remote` 偵測與分支選擇彈窗。
* [ ] 實作自動建立 Worktree 與分支推送的後端邏輯。
* [ ] 確保 `.vibeflow/` 資料夾被正確忽略。

### 第三階段：互動終端 (Day 5-7)

* [ ] 在主進程封裝 `node-pty` 與 `claude` CLI。
* [ ] 前端整合 `xterm.js`，達成雙向串流（輸出顯示 + 鍵盤輸入）。
* [ ] 實作多卡片並行的 PTY 進程管理。

### 第四階段：Review & Cleanup (Day 8-10)

* [ ] 整合 `react-diff-viewer` 呈現程式碼變更。
* [ ] 實作 Approve 後的自動提交與 Worktree 清理機制。

## ⚠️ 開發提醒

1. **Native Modules**: `node-pty` 在安裝後需執行 `electron-rebuild` 以匹配 Electron 版本。
2. **互動處理**: 確保 `xterm.js` 的輸入能即時傳回 PTY，這對於 Claude Code 的互動式提問（Type A）至關重要。
3. **環境變數**: Electron 呼叫 `claude` 時需手動注入使用者的 `PATH`，否則會找不到指令。
