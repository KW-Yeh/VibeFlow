# VibeFlow

VibeFlow 是一款專為本地開發設計的「意圖驅動」看板平台。它將 Claude Code CLI 的強大生成能力與 Git Worktree 的多工隔離機制結合，讓開發者能透過視覺化看板同時管理多個開發任務，並在獨立的工作區中安全地進行代碼實驗與自動化實作。

## 🛠 核心技術棧 (Tech Stack)

* **外殼**: Electron (Node.js 原生 API 支援)
* **前端**: Next.js (React) + Tailwind CSS + shadcn/ui
* **看板**: `@hello-pangea/dnd`
* **終端**: `xterm.js` + `node-pty` (處理雙向互動式 CLI)
* **儲存**: `electron-store` (本地持久化)

## 📦 下載與安裝

到 [GitHub Releases](https://github.com/KW-Yeh/VibeFlow/releases) 下載對應平台的安裝檔:

| 平台 | 檔案 |
|---|---|
| macOS (Apple Silicon) | `VibeFlow-<版本>-mac-arm64.dmg` |
| macOS (Intel) | `VibeFlow-<版本>-mac-x64.dmg` |
| Windows | `VibeFlow-<版本>-win-x64.exe`(實驗性) |
| Linux | `VibeFlow-<版本>-linux-x86_64.AppImage`(實驗性) |

### ✅ 使用前提(Prerequisites)

VibeFlow 本身不需要 Node.js 執行環境(Electron 已內建),但它是 Claude Code CLI 與 Git 的「指揮台」,因此你的機器上必須具備:

1. **Git ≥ 2.5**(`git worktree` 的最低需求,建議 2.30+),且 `git` 指令在 PATH 中可用。
2. **Claude Code CLI 已安裝並登入** — 終端機輸入 `claude` 必須能啟動:
   ```bash
   # 擇一安裝
   npm install -g @anthropic-ai/claude-code
   # 或使用官方 installer
   curl -fsSL https://claude.ai/install.sh | bash
   ```
   並完成 `claude` 首次登入(需要 Claude Pro/Max 訂閱或 Anthropic API key)。
3. **要操作的專案必須是 Git repository**。若要使用「Approve & Push」,該 repo 的推送認證(SSH key 或 credential helper)需事先設定好;若 repo 使用 Git LFS,需先安裝 `git-lfs`。
4. **作業系統**:macOS 12+(主要支援、開發平台)。Windows / Linux 版由 CI 產出但未經完整測試,屬實驗性質。

### ⚠️ 首次啟動注意事項

- **macOS**:App 僅做 ad-hoc 簽章、未經 Apple 公證,首次開啟會被 Gatekeeper 攔下。請對 App **按右鍵 → 打開**,或執行:
  ```bash
  xattr -dr com.apple.quarantine /Applications/VibeFlow.app
  ```
- **Windows**:未簽章,SmartScreen 會跳出警告,點「其他資訊 → 仍要執行」。
- **Linux**:下載後先 `chmod +x VibeFlow-*.AppImage` 再執行。

## 🚢 發佈新版本(Maintainers)

CI(`.github/workflows/release.yml`)會在推送 `v*` tag 時自動打包三平台並上傳到 **draft** GitHub Release:

```bash
# 1. 更新 package.json 的 version(例如 0.2.0)並 commit
# 2. 上 tag 並推送
git tag v0.2.0
git push origin v0.2.0
# 3. 到 GitHub Releases 頁面檢查 draft 的產物,確認後按 Publish release
```

本地驗證打包(不會上傳):`npm run build`,產物在 `dist/`。

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

* [x] 搭建 Electron + Next.js 環境。
* [x] 實作看板拖曳介面。
* [x] 整合 `electron-store` 紀錄本地專案路徑與卡片狀態。

### 第二階段：Git 自動化 (Day 3-4)

* [x] 實作 `git remote` 偵測與分支選擇彈窗。
* [x] 實作自動建立 Worktree 與分支推送的後端邏輯。
* [x] 確保 `.vibeflow/` 資料夾被正確忽略。

### 第三階段：互動終端 (Day 5-7)

* [x] 在主進程封裝 `node-pty` 與 `claude` CLI。
* [x] 前端整合 `xterm.js`，達成雙向串流（輸出顯示 + 鍵盤輸入）。
* [x] 實作多卡片並行的 PTY 進程管理。

### 第四階段：Review & Cleanup (Day 8-10)

* [x] 整合 `react-diff-viewer` 呈現程式碼變更。
* [x] 實作 Approve 後的自動提交與 Worktree 清理機制。

## ⚠️ 開發提醒

1. **Native Modules**: `node-pty` uses packaged prebuilt binaries where available. Do not run `electron-builder install-app-deps` / `electron-rebuild` for routine verification; use `npm run check:node-pty` to confirm the installed binary loads.
2. **互動處理**: 確保 `xterm.js` 的輸入能即時傳回 PTY，這對於 Claude Code 的互動式提問（Type A）至關重要。
3. **環境變數**: Electron 呼叫 `claude` 時需手動注入使用者的 `PATH`，否則會找不到指令。
