# VibeFlow

[![npm version](https://img.shields.io/npm/v/@kw-yeh/vibeflow.svg)](https://www.npmjs.com/package/@kw-yeh/vibeflow)
[![npm downloads](https://img.shields.io/npm/dm/@kw-yeh/vibeflow.svg)](https://www.npmjs.com/package/@kw-yeh/vibeflow)
[![node](https://img.shields.io/node/v/@kw-yeh/vibeflow.svg)](https://www.npmjs.com/package/@kw-yeh/vibeflow)

**讓多個 coding agent 同時開工的本機看板。**

每張卡片是一個任務。卡片一開始，VibeFlow 就幫它開一條獨立的 Git 分支與 worktree，在裡面啟動 Claude Code 或 Codex，並把即時終端機放在卡片旁邊。好幾張卡可以同時跑，彼此不會改到同一份檔案，你的專案資料夾本身也不會被切換分支。

```bash
npm i -g @kw-yeh/vibeflow@latest
vibeflow
```

一切都在你的電腦上執行：不需要另外註冊帳號，看板與程式碼都留在本機。

---

## 它能幫你做什麼

- **一卡一分支一 worktree**：卡片開始執行時，從當下最新的基準分支自動建立分支與 worktree、複製 `.env` 等被忽略的檔案，相依套件也在背景複製好，worktree 建好就能直接跑。
- **看板式管理多個 agent**：Backlog → In Progress → Done。把卡片拖進 In Progress，agent 就在它的 worktree 裡開始工作。
- **即時終端機**：每張卡都有自己的互動式終端機，agent 要你確認時直接在畫面上回答。
- **關掉也不會中斷**：裝了 tmux 時，agent 跑在背景 session 裡；關掉瀏覽器甚至 VibeFlow 本身，任務都會繼續，重新開啟就接回來。
- **看得到 agent 做了什麼**：每張卡有 diff 檢視、artifacts，以及「決策」分頁：顯示這張卡的分支新增或修改的 `spec.md`（agent 做了哪些決定、為什麼）。卡片完成後打開時預設顯示決策；本地分支刪掉後，會改從 `origin/<branch>` 或 GitHub PR 的 merge commit 讀回合併當時的內容（squash／rebase merge 的卡片讀不回來）。
- **選你要的 agent**：Claude Code 或 Codex，每張卡可以各自指定 model、推理強度（effort）與 Auto Mode（是否免確認執行）。
- **Web UI 與終端機 UI 共用同一個看板**：習慣瀏覽器用 Web UI，習慣終端機用 `vibeflow tui`。
- **內建 skill，可自行調整**：每個人的 Library（設定 → Library）都附帶 `visual-parity`、`pr` 兩個 skill，兩個 agent 都會載入。可以直接編輯、停用或刪除，隨時能還原成 VibeFlow 出貨的版本；沒改過的會跟著 VibeFlow 升級更新。`visual-parity` 需要 Python 與 `pip install playwright && playwright install chromium`。
- **也能用指令操作**：`vibeflow task create` 不開 UI 直接建卡；agent 自己也能在看板上建立後續的卡片。

---

## 快速開始

### 1. 先準備好這些

| 需要 | 說明 |
|---|---|
| **Node.js 22+** | [nodejs.org](https://nodejs.org) |
| **Git 2.30+** | 要操作的專案必須是 Git repository |
| **Claude Code 或 Codex CLI，且已登入** | 至少一個。Claude Code：`npm install -g @anthropic-ai/claude-code`（或 `curl -fsSL https://claude.ai/install.sh \| bash`），裝完執行一次 `claude` 完成登入 |
| tmux（建議） | macOS：`brew install tmux`。沒有也能用，只是關掉 VibeFlow 時 agent 會一起結束 |
| Git Bash（僅 Windows） | 隨 [Git for Windows](https://git-scm.com/download/win) 安裝 |

### 2. 安裝並啟動

```bash
npm i -g @kw-yeh/vibeflow@latest
vibeflow
```

VibeFlow 會在本機啟動，並自動用瀏覽器開啟看板。第一次啟動時如果偵測到缺了什麼，會直接告訴你該怎麼補。

### 3. 開第一張卡

1. 按側邊欄的 **＋**，或 Backlog 欄的 **新建任務**。
2. 選一個專案資料夾（必須是 Git repo），選要從哪條分支開始。
3. 寫下標題與你要 agent 做的事，選 agent，按建立。
4. 把卡片拖到 **In Progress**，agent 就開始工作；點開卡片就能看到它的即時終端機。
5. 做完之後在卡片上檢查 diff；要留下的變更請讓 agent commit、push 或開 PR。
6. 把卡片移到 **Done**：VibeFlow 會刪掉這張卡的 worktree 與本地分支。**尚未 commit 的變更會一起消失**，移動前會再跟你確認一次。已 push 的 `spec.md` 之後仍會顯示在卡片的「決策」分頁。

有問題時先跑：

```bash
vibeflow doctor
```

它會逐項檢查 Node、Git、tmux、終端機模組與 agent CLI，並列出修正指令。

---

## 安裝方式

| 方式 | 指令 | 適合 |
|---|---|---|
| **全域安裝（建議）** | `npm i -g @kw-yeh/vibeflow@latest`，之後執行 `vibeflow` | 大多數人 |
| 免安裝試用 | `npx @kw-yeh/vibeflow` | 只想先看看、不想安裝 |
| 從原始碼一鍵啟動 | clone 後雙擊 `start.command`（macOS／Linux）或 `start.cmd`（Windows） | 想用最新的 `main`，或要改程式 |

三種方式讀寫的是同一份看板，可以隨時換。

之後要更新到最新版，再執行一次同一行安裝指令即可：

```bash
npm i -g @kw-yeh/vibeflow@latest
```

### 安裝時出現 `EACCES: permission denied`

代表 npm 的全域目錄屬於系統管理員（從 nodejs.org 下載安裝檔裝 Node 時常見）。建議不要用 `sudo`，改成讓全域套件裝在你自己的家目錄：

```bash
mkdir -p ~/.npm-global
npm config set prefix ~/.npm-global
echo 'export PATH="$HOME/.npm-global/bin:$PATH"' >> ~/.zshrc
source ~/.zshrc
npm i -g @kw-yeh/vibeflow@latest
```

用 Homebrew（`brew install node`）或 [nvm](https://github.com/nvm-sh/nvm) 裝的 Node 本來就不需要 `sudo`。已經用 `sudo` 裝好也能正常使用；若 `vibeflow doctor` 回報終端機模組沒有執行權限，照它列出的 `sudo chmod +x …` 指令執行一次即可。

---

## 常用指令

```bash
vibeflow                     # 啟動（或連到已在執行的）VibeFlow，開啟 Web UI
vibeflow tui                 # 終端機介面，和 Web UI 操作同一個看板
vibeflow status              # 目前的 host、執行中的 session、看板摘要
vibeflow stop <id> | --all   # 停止某張卡（或全部）的 agent
vibeflow shutdown            # 關閉 VibeFlow（tmux 裡的 agent 會繼續執行）
vibeflow open <path>         # 把專案資料夾加進最近使用清單並開啟 Web UI
vibeflow doctor              # 檢查前置需求
vibeflow task create …       # 不開 UI 直接建卡，選項見 vibeflow task --help
```

沒有全域安裝、改用 `npx` 時，把 `vibeflow` 換成 `npx @kw-yeh/vibeflow`。

---

## 運作方式

**檔案放在哪裡**

- 每張卡的 worktree 建在「工作站資料夾」底下：`<工作站>/<專案名>/<分支名>`。工作站預設是 `~/Desktop`，可在 **設定** 裡改。
- 你的專案資料夾本身不會被切換分支，也不會多出 worktree。
- 專案有 remote 時，新分支會在建卡時 push 到 origin；有設 CI 的話可能會被觸發。
- 看板資料存在 `~/Library/Application Support/vibeflow/`（macOS）、`%APPDATA%\vibeflow\`（Windows）或 `~/.config/vibeflow/`（Linux）。

**同一台電腦只有一個 VibeFlow**

再次執行 `vibeflow` 或 `vibeflow tui` 時，會連到已在執行的那一個，不會開出第二份。

**本機伺服器的安全性**

VibeFlow 的本機伺服器能啟動 agent、寫入終端機，因此：

- 只綁定 `127.0.0.1`／`::1`，預設固定用 port 47820（被占用時改用隨機 port），瀏覽器的通知權限才不會在 host 重啟後失效。
- 每次啟動產生一組 token，網址帶上它才能進入；載入後換成 HttpOnly、SameSite=Strict 的 cookie，並從網址列移除。
- WebSocket 連線同時檢查 cookie 與 `Origin`，`Host` 必須是 loopback，其他網頁無法從你的瀏覽器連進來。
- API 只接受 VibeFlow 認得的卡片 id，不接受任意路徑或指令。

---

## 參與開發

```bash
git clone https://github.com/KW-Yeh/VibeFlow.git
cd VibeFlow
./start.command          # 或：npm install && npm start
```

架構、慣例、測試指令與完成標準都在 [AGENTS.md](AGENTS.md)。

### 發佈新版本（Maintainers）

推送 `v*` tag 會觸發 [CI](.github/workflows/release.yml)：在 Ubuntu、macOS、Windows 上跑 typecheck、測試、端對端測試與 `vibeflow doctor`，打包後實際安裝驗證，再以 npm Trusted Publishing（OIDC，不需要 token）發佈 `@kw-yeh/vibeflow`。

```bash
npm version <x.y.z> -m "chore: release v%s"
git push origin main --follow-tags
```

本地驗證打包：`npm run build:npm && npm pack ./dist-npm`。

## License

[MIT](LICENSE)
