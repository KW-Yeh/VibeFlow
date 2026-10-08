# Spec：CLI 自動更新

- 狀態：已確認
- Ticket：尚無
- 需求來源：本次 VibeFlow 任務「新增 CLI 功能：Update」與使用者補充的工作流程
- 更新日期：2026-10-08
- 確認紀錄：2026-10-08，使用者回覆「按照建議」，確認只支援全域 npm 安裝，更新完成後提示自行重啟 host。

## 問題與目標

目前 npm 安裝的使用者要更新 VibeFlow，必須自行查文件並重跑全域安裝指令。新增頂層 `vibeflow update`，讓使用者在終端機用一個指令取得 npm 的 `latest` 版本並安裝，清楚得知成功或失敗。

## 範圍

### 本次包含

- 在 CLI 加入 `vibeflow update` 指令、`--help` 說明和 README 使用方式。
- 從目前執行的已發佈套件辨識正確 npm 套件名稱，透過 npm 安裝其 `latest` 發佈版。
- 顯示執行進度、更新結果和失敗原因；安裝失敗時回傳非零退出碼。
- 以不接觸使用者真實全域安裝的方式驗證更新命令及錯誤路徑。
- 辨識目前 CLI 是否來自 npm 全域安裝；來源不符時不執行安裝。

### 本次不包含

- Web UI / TUI 更新按鈕、背景自動更新或排程更新。
- 變更 npm 發佈流程或版本編號。
- 更新 Claude Code、Codex 或其他外部工具。

## 行為

| 情境或觸發條件 | 預期行為 |
| --- | --- |
| 以 npm 發佈套件執行 `vibeflow update` | 使用目前套件名稱向 npm 安裝 `@latest`，顯示結果並以 0 結束。 |
| npm 下載、安裝或權限檢查失敗 | 顯示可理解的錯誤，回傳非零退出碼，不宣稱更新成功。 |
| 從原始碼 checkout、`npx` 或專案本地 npm 安裝執行 | 不執行全域安裝，也不更動目前安裝；顯示本指令只適用於全域 npm 安裝。 |
| 已有 VibeFlow host 正在執行 | 更新不修改目前執行的 host；完成後提示自行重啟以載入新版本。 |
| `vibeflow --help` | 列出 `update` 用途；既有 `vibeflow task update` 繼續更新卡片。 |

## 驗收條件

- [x] AC-1：從 npm 套件安裝環境執行 `vibeflow update`，會請 npm 安裝該套件的 `latest` 發佈版並顯示明確結果。
- [x] AC-2：更新失敗時保留 npm 的可診斷錯誤資訊，退出碼非零。
- [x] AC-3：從原始碼、`npx` 或專案本地 npm 安裝執行時，不會修改安裝；顯示適用提示並回傳非零退出碼。
- [x] AC-4：CLI help、README 說明新指令，`task update` 既有行為維持正常。
- [x] AC-5：完成後提示使用者自行重啟 host，以載入更新版本；不自動終止執行中的 session。

## 限制與依賴

- npm 是本專案的套件管理與發佈方式；發佈包的 `package.json` 由 `scripts/build-npm.mjs` 產生。
- npm 的 `@latest` dist-tag 決定「最新」版本；安裝仍受目前 npm 設定、registry、網路及全域目錄權限影響。
- 驗證不可直接更新使用者目前的全域 VibeFlow 安裝。

## 待確認事項

無。
