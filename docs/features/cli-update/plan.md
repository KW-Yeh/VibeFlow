# Plan：CLI 自動更新

- 狀態：待確認
- 對應 Spec：[spec.md](./spec.md)
- Spec 確認依據：2026-10-08，使用者回覆「按照建議」，確認全域 npm 安裝與手動重啟 host
- 更新日期：2026-10-08
- 確認紀錄：尚未確認

## 現有程式碼調查

| 檔案或專案 | 現有行為、可重用模式與調查依據 |
| --- | --- |
| `packages/cli/src/main.ts` | 頂層指令解析與 dispatch 集中於此；`detectLayout()` 已區分 source 與 npm bundle，讀取 bundle 旁的 `package.json` 取得版本。 |
| `scripts/build-npm.mjs` | 預設產出 `@kw-yeh/vibeflow` 套件，並允許 `--name` 覆寫套件名稱；包內 `dist/vibeflow.mjs` 為 CLI 入口。 |
| `packages/cli/src/task-command.ts` | `vibeflow task update` 已存在，功能是修改看板卡片，須與頂層 `update` 區分。 |
| `README.md` | 安裝方式說明目前以 `npm i -g @kw-yeh/vibeflow@latest` 手動更新。 |
| `test/README.md`、`scripts/run-tests.mjs` | Node 內建測試框架，測試檔位於 `test/*.test.mjs`；新增 CLI 測試後需更新測試索引。 |

## 方案與取捨

新增獨立的 `packages/cli/src/update-command.ts` 處理辨識與安裝，`main.ts` 僅連接 dispatch 和 help。從目前執行的 bundle 旁讀取 npm 套件名稱，並以 `npm root -g` 確認該 bundle 位於 npm 的全域套件目錄；兩側路徑正規化以支援 symlink 及跨平台路徑。確認後以參數陣列執行 `npm install -g <package>@latest`，不經 shell，以免套件名稱或路徑被解讀成命令。npm 命令繼承終端機輸出以保留下載進度及原始錯誤。成功時印出完成與手動重啟提示；失敗時回傳非零退出碼。

不預先向 registry 查版本：npm 安裝指令本身會取得 `latest` 並處理相同版本情況，額外查詢會增加失敗點，也可能與實際安裝結果不同。來源非全域安裝時提前結束，不在 checkout、`npx` cache 或本地依賴執行全域安裝。

## 預計修改

| 檔案 | 修改內容 | 對應驗收條件 |
| --- | --- | --- |
| `packages/cli/src/update-command.ts`（新增） | 判斷全域 npm 安裝、執行更新、處理訊息與錯誤 | AC-1、AC-2、AC-3、AC-5 |
| `packages/cli/src/main.ts` | 加入頂層 `update` dispatch 與 help | AC-1、AC-4 |
| `test/update-command.test.mjs`（新增） | 用隔離的假 npm 與測試目錄驗證來源、參數、成功及失敗；不碰真實全域安裝 | AC-1、AC-2、AC-3、AC-5 |
| `test/README.md` | 登錄新增測試套件 | AC-4 |
| `README.md`、`AGENTS.md` | 記錄新指令、適用範圍、手動重啟語意與開發命令 | AC-4、AC-5 |
| `docs/features/cli-update/spec.md`、`plan.md` | 保留需求、方案與實際驗證結果 | 全部 |

## 實作順序

1. 建立更新流程與隔離測試，檢查 source、`npx`、本地與全域安裝的辨識，以及 npm 錯誤傳遞；完成後 commit。
2. 接上頂層 CLI dispatch，更新 help 與使用文件；完成後 commit。
3. 執行型別檢查、全測試、npm 打包與暫存目錄安裝驗證；修正實際問題並記錄結果，必要時追加獨立 commit。
4. 完成驗收後建立 Draft PR；若有錄製驗收影片，再以額外 PR comment 上傳影片。CLI 功能本身不需 UI 像素級比對。

## 風險與依賴

- npm 全域根目錄可透過使用者設定變更；須以當前 npm 的結果判斷，而非硬編系統預設路徑。
- npm 更新可能因網路、registry、權限或 `node-pty` postinstall 失敗；需保留 npm 的訊息與非零狀態，避免誤報成功。
- 目前執行中的 VibeFlow host 不會因磁碟套件更新而自行換版，需提示重啟。
- 測試以假 npm 驗證命令行為，真實套件驗證僅安裝到暫存 prefix，不更新使用者的全域套件。

## 驗證計畫

| 檢查 | 命令或操作 | 對應驗收條件 |
| --- | --- | --- |
| 更新流程單元測試 | `node scripts/run-tests.mjs ./test/update-command.test.mjs` | AC-1、AC-2、AC-3、AC-5 |
| packages 型別檢查 | `npx tsc --noEmit -p tsconfig.json` | 工程品質 |
| 全部 Node 測試 | `npm test` | AC-4、回歸 |
| npm 套件打包 | `npm run build:npm`、`npm pack ./dist-npm` | AC-1、發佈布局 |
| 暫存 prefix 驗收 | 安裝 tarball 到暫存 prefix，執行 `vibeflow doctor --skip agents`，並以假 npm 檢查打包後的 `vibeflow update` | AC-1、AC-2、AC-3、AC-5 |
| 指令操作 | 從原始碼執行 `vibeflow update`、`vibeflow --help` 及 `vibeflow task --help` | AC-3、AC-4 |

## 待確認事項

無。

## 實作與驗證紀錄

尚未實作；確認 Plan 後記錄實際結果。
