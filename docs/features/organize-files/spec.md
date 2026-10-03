# Spec：整理專案文件

- 狀態：已確認
- Ticket：尚無（VibeFlow 卡片「整理文件」）
- 需求來源：VibeFlow 卡片描述「整理專案中過時的文件，值得保存的轉移到 doc 資料夾中，而不是散落在 root，同時更新 agents.md。」
- 更新日期：2026-10-03
- 確認紀錄：2026-10-03 依任務指示授權（卡片要求先規劃 spec／plan、完成後自動開 PR），未另行逐份確認；範圍內的取捨記在 `feature-organize-files.DECISIONS.md`。

## 問題與目標

repo 根目錄除了 `README.md`、`LICENSE`、`AGENTS.md`、`CLAUDE.md` 之外，還散落 7 份 Markdown：
一份設計系統參考（`DESIGN.md`）與六份功能規劃／規格（`*_PLAN.md`、`REMOTE_SPEC.md`）。
其中多份已實作完成、內容停留在 Electron 時代，但檔頭沒有標示狀態，讀者分不清哪份還有效。
`test/README.md` 的測試清單也只列出 6 支、實際已有 31 支。

目標：根目錄只留專案入口文件；值得保存的文件集中到 `docs/`，並有一份索引說明每份文件的性質與狀態；
`AGENTS.md` 指向新位置，並規定之後的文件放哪裡。

## 範圍

### 本次包含

- 建立 `docs/`，把根目錄的 `DESIGN.md` 與六份規劃文件移入（`git mv`，保留歷史）。
- 新增 `docs/README.md` 索引：列出每份文件、性質（現行參考／已完成的決策記錄）、狀態與對應程式碼位置。
- 為內容已過時的規劃文件加上狀態註記（不改寫正文）。
- 更新所有指向舊路徑的引用（`AGENTS.md`、`renderer/styles/globals.css` 註解、`packages/core/IPC_API_MAP.md`、文件之間的互相引用）。
- 更新 `AGENTS.md`：project structure 加入 `docs/`，新增文件放置規則。
- 更新 `test/README.md` 已過時的內容（測試清單、指向 `CLAUDE.md` 的說明）。

### 本次不包含

- 改寫規劃文件正文、或把它們翻譯／重構成新格式。
- 搬移與程式碼同處的文件（`packages/core/IPC_API_MAP.md`、`test/README.md` 留在原位）。
- `.claude/skills/`、`.agents/skills/` 等 agent 設定。
- 任何程式行為、依賴（例如 `peerjs` / `qrcode`）的變更。

## 行為

| 情境或觸發條件 | 預期行為 |
| --- | --- |
| 在 repo 根目錄 `ls *.md` | 只剩 `README.md`、`AGENTS.md`、`CLAUDE.md` |
| 開啟 `docs/README.md` | 看得到每份文件的路徑、性質、狀態，以及現行實作在哪裡 |
| 開啟已完成的規劃文件 | 檔頭標示「已實作／僅供決策記錄」，並說明哪些描述已過時 |
| agent 讀 `AGENTS.md` | 知道設計系統參考在 `docs/DESIGN.md`、規劃文件在 `docs/plans/`、新功能的 spec／plan 放 `docs/features/<slug>/` |
| 在 repo 中搜尋舊路徑（例如 `CORE_SPLIT_PLAN`） | 只會找到指向 `docs/` 新位置的引用，沒有斷掉的連結 |
| `npm run build:npm` 打包 | 套件內容不變（只帶 `README.md`、`LICENSE`、`dist`） |

## 驗收條件

- [x] AC-1：根目錄的 Markdown 只剩 `README.md`、`AGENTS.md`、`CLAUDE.md`；其餘 7 份以 `git mv` 移到 `docs/`，`git log --follow` 可追到原歷史。
- [x] AC-2：`docs/README.md` 列出 `docs/` 內每一份文件，並標示性質與狀態。
- [x] AC-3：內容與現況不符的規劃文件檔頭有狀態註記，註記內容與程式碼現況一致。
- [x] AC-4：`git grep` 舊檔名，所有引用都指向新路徑；Markdown 相對連結可解析到實際檔案。
- [x] AC-5：`AGENTS.md` 的 project structure 含 `docs/`，並有「文件放哪裡」的規則。
- [x] AC-6：`test/README.md` 的測試清單與 `test/*.test.mjs` 一致，不再引用 `CLAUDE.md` 作為說明來源。
- [x] AC-7：`npm test` 綠燈；`npx tsc --noEmit -p tsconfig.json` 與 renderer typecheck 無新增錯誤（僅改註解，但 `ui-consistency` 會掃 renderer）。（`npm test` 有 2 個 symlink 測試因本機 Windows 權限 `EPERM` 失敗，與本次無關，見 plan.md 紀錄）

## 限制與依賴

- 依 `AGENTS.md`：commit 訊息英文、Conventional Commits，結尾 `Co-Authored-By`。
- 卡片要求 PR 內容以繁體中文撰寫、以 Conventional Commits 架構組織。

## 待確認事項

- 無
