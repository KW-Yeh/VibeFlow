# VibeFlow

VibeFlow 是一款專為本地開發設計的「意圖驅動」看板平台。它將 Claude Code CLI 的強大生成能力與 Git Worktree 的多工隔離機制結合，讓開發者能透過視覺化看板同時管理多個開發任務，並在獨立的工作區中安全地進行代碼實驗與自動化實作。

## 🛠 核心技術棧 (Tech Stack)

* **核心**: `packages/core` — 任務、git worktree、agent 指令組裝、session 管理，不依賴任何 UI
* **前端**: 本機 Web UI（Next.js 靜態輸出，由 core 提供）· 終端機 TUI（Ink）· Electron 桌面版（選用）
* **看板**: `@hello-pangea/dnd`
* **終端**: `xterm.js` ↔ WebSocket ↔ core；session 由 tmux（macOS / Linux）或 `node-pty` 持有
* **儲存**: core 自有的 JSON store（`packages/core/src/json-store.ts`，沿用原 electron-store 的檔案）

## 📦 安裝與執行

| 方式 | 指令 | 適合對象 |
|---|---|---|
| 免安裝試用 | `npx vibeflow` | 第一次接觸的人 |
| 全域安裝 | `npm i -g vibeflow`，之後執行 `vibeflow` | 日常使用者 |
| 從原始碼執行 | `git clone` → `npm install` → `npm start` | 貢獻者、想改程式的人 |
| 桌面版（Electron） | 從 [GitHub Releases](https://github.com/KW-Yeh/VibeFlow/releases) 下載 | 偏好獨立視窗的人 |

`vibeflow` 會在本機啟動 core，並用瀏覽器開啟 Web UI。它不是需要簽章的 App，所以不會被 Gatekeeper 或 SmartScreen 攔下。

```bash
vibeflow                 # 啟動（或沿用已在執行的）core，開啟 Web UI
vibeflow tui             # 終端機介面，和 Web UI 操作同一份看板與 session
vibeflow status          # host、執行中的 session、看板摘要
vibeflow stop <id> | --all   # 停止 agent session
vibeflow shutdown        # 停止 host（tmux 裡的 agent 會繼續執行）
vibeflow open <path>     # 把專案資料夾加入最近使用清單，再開啟 Web UI
vibeflow doctor          # 檢查前置需求，並列出修正指令
vibeflow task create …   # 不開 UI 直接建卡（vibeflow task --help）
```

同一台機器同時只會有一個 core（`<appData>/vibeflow/core.lock`）。再次執行 `vibeflow` 或 `vibeflow tui` 時，會連到已在執行的那一個。

**任務不綁 UI**：有 tmux 時，每張卡片的 agent 跑在 `tmux -L vibeflow` 的 session 裡。關掉瀏覽器、TUI，甚至 core 本身，agent 都會繼續執行，重新開啟即可接回。沒有 tmux 時（包括 Windows），agent 由 core 直接持有，會隨 core 一起結束。

### ✅ 前置需求

1. **Node.js 22 以上**。
2. **Git 2.30 以上**，且要操作的專案必須是 Git repository。若要使用「Approve & Push」，推送認證（SSH key 或 credential helper）需事先設定好。
3. **tmux**（建議；macOS 用 `brew install tmux`）。沒有時會自動改用 node-pty，並在 `vibeflow doctor` 裡提示。
4. **claude 或 codex CLI 至少一個，已登入**：
   ```bash
   npm install -g @anthropic-ai/claude-code   # 或官方 installer：curl -fsSL https://claude.ai/install.sh | bash
   ```
5. **Windows**：需要 Git for Windows 的 Git Bash（agent 的啟動指令是 POSIX sh）。

有問題時先執行 `vibeflow doctor`。第一次啟動若偵測到問題，也會自動檢查一次。

### 🔒 本機伺服器的安全性

core 的 Web 伺服器能啟動 agent 和寫入終端機，因此：

- 只綁定 `127.0.0.1` / `::1`，使用隨機 port。
- 必須帶每次啟動時產生的 token 才能進入。`vibeflow` 開啟的網址會帶上 token，載入後換成 HttpOnly、SameSite=Strict 的 cookie，並從網址列移除。
- WebSocket 握手會同時檢查 cookie 與 `Origin`，其他網頁無法從你的瀏覽器連進來。
- `Host` 標頭必須是 loopback，用來防範 DNS rebinding。
- 鎖檔權限為 0600。
- API 只接受 core 認得的 task id，不接受任意路徑或指令。

### 🖥 桌面版（Electron）注意事項

- **macOS**：App 僅做 ad-hoc 簽章、未經 Apple 公證，首次開啟會被 Gatekeeper 攔下。請對 App **按右鍵 → 打開**，或執行：
  ```bash
  xattr -dr com.apple.quarantine /Applications/VibeFlow.app
  ```
- **Windows**：未簽章，SmartScreen 會跳出警告，點「其他資訊 → 仍要執行」。
- **Linux**：下載後先 `chmod +x VibeFlow-*.AppImage` 再執行。

## 🚢 發佈新版本（Maintainers）

CI（`.github/workflows/release.yml`）在推送 `v*` tag 時會：

1. 在 Ubuntu、macOS、Windows 上跑 typecheck、`npm test`、Web UI 端對端測試與 `vibeflow doctor`。
2. `npm pack` 後以全域安裝方式驗證能啟動，再執行 `npm publish --provenance`（需要 `NPM_TOKEN` secret）。
3. 桌面版保留期間，同時打包三平台安裝檔並上傳到 **draft** GitHub Release。

```bash
# 1. 更新 package.json 的 version 並 commit
# 2. 上 tag 並推送
git tag v4.0.0
git push origin v4.0.0
# 3. 到 GitHub Releases 頁面檢查 draft 的產物，確認後按 Publish release
```

本地驗證：`npm run build:npm && npm pack ./dist-npm`（npm 套件），`npm run build`（桌面版，產物在 `dist/`）。

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
