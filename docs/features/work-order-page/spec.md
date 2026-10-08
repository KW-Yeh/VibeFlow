# Spec：調整工單頁面

- 狀態：已確認
- Ticket：尚無
- 需求來源：使用者於 2026-10-08 提出的「調整工單頁面」需求；現有行為參考 [Jira inbox spec](../jira-inbox/spec.md)
- 更新日期：2026-10-08
- 確認紀錄：2026-10-08 使用者回覆「確認」，採用前述三項建議：頁籤「工作項目」、依 Jira Status 分欄、附件顯示檔名清單並從 Jira 開啟。

## 問題與目標

目前上方檢視稱為「Issues & PRs」，但頁面也收錄 Jira ticket。Jira 詳情建立卡片時只能從看板或最近使用的專案中選取，第一次使用的本機專案無法直接透過系統選擇。Jira 清單的 Status 篩選增加一次操作；詳情中的 Jira key 與 Parent 分散在標題和內文，而連往 Jira 的入口位於 Modal 底部。附件尚未顯示，查看完整上下文不便。

本次讓頁面名稱符合資料來源、讓 Jira ticket 不經篩選即可直接瀏覽、能從本機任意選取專案、在詳情中快速開啟 Jira 連結，並提供附件的可行瀏覽入口。

## 範圍

### 本次包含

- 將上方檢視頁籤與側邊欄入口改稱「工作項目」；Jira／Issues／Pull Requests 三個內部分頁保留。
- Jira 分頁移除 Status 篩選和「清除篩選」，依實際 Status 名稱將所有 ticket 分欄；帳號、筆數、更新時間與重新整理保留。
- Jira 詳情建卡的專案控制項增加系統資料夾選取，允許選擇尚未出現在看板或最近使用清單的專案。
- Jira 詳情內的 ticket key 與 Parent 放在同一個中繼資料區塊，兩者各自可開啟對應 Jira 頁面；移除 Modal 底部的「在 Jira 開啟」按鈕。
- Jira 詳情顯示附件檔名與大小，點擊後由外部瀏覽器在 Jira 開啟該附件。
- 更新受影響的測試、使用者文件，並以瀏覽器驗收及像素級畫面比對檢查 375／768／1440px 版面。

### 本次不包含

- 更動 GitHub Issues／Pull Requests 的內容、篩選與建卡流程。
- 在 Jira 編輯 ticket、寫回附件、變更權限或新增登入方式。
- 更動看板卡片與任務工作區。
- 在 VibeFlow 內下載、快取、預覽或上傳附件。

## 行為

| 情境或觸發條件 | 預期行為 |
| --- | --- |
| 檢視切換 | 上方頁籤與側邊欄入口均顯示「工作項目」；Jira／Issues／Pull Requests 分頁與既有導覽行為不變。 |
| Jira 分頁有 ticket | 不顯示 Status 篩選；每個實際出現的 Status 占一欄，欄首顯示名稱與筆數。欄位依 Status category（To Do → 進行中 → Done）排序，同類依名稱排序；欄內 ticket 依期限由近到遠排列，無期限的在最後，同期限依 key 數字由大到小。每張卡片保留 key、summary、Story Points、期限與 status 資訊。 |
| Jira 分頁沒有 ticket | 顯示既有「目前沒有指派給你的 Jira ticket」空狀態；載入、錯誤、未登入與重新整理行為保留。 |
| Jira 詳情建立卡片 | 可選既有專案，也可點資料夾圖示開啟系統資料夾選擇器；新路徑可顯示為目前選取項目。取消選擇器不改變已選路徑。沒有選專案時仍停用建立按鈕；建立失敗顯示現有錯誤訊息。 |
| Jira 詳情中繼資料 | 顯示目前 ticket key 與 Parent key（若有）；各自為可用鍵盤操作的 Jira 連結。沒有 Parent 時仍顯示目前 ticket key。底部不再顯示「在 Jira 開啟」。 |
| Jira 詳情有附件 | 在內文後顯示附件清單，列出檔名與檔案大小。點擊檔名以外部瀏覽器開啟同一 Jira site 的附件內容網址；無附件時不顯示空區塊，附件欄位缺失不阻止閱讀 ticket 或建立卡片。 |
| 狹窄視窗 | Jira Status 欄位在列表區內可水平捲動，頁面本身不水平溢出；375／768px 下沒有重疊、截字或無法觸及的欄位和操作；1440px 有清楚的多欄層級。 |

## 驗收條件

- [x] AC-1：上方與側邊欄的檢視名稱一致，能切換進出原本的三個來源分頁。
- [x] AC-2：Jira 分頁不再有 Status 篩選，所有 ticket 依實際 Status 分欄，欄首顯示名稱與筆數；欄位及欄內排序、ticket 資訊和重新整理符合上述規則。
- [x] AC-3：Jira 詳情可透過系統資料夾選擇器選取從未建卡的有效專案，並成功建立 Backlog 卡片；取消選擇器、未選專案及建立失敗各有正確狀態。
- [x] AC-4：Jira 詳情中 ticket key 與 Parent key 在同一中繼資料區塊，各自開啟正確 Jira URL；無 Parent 的 ticket 仍可開啟自身。底部沒有「在 Jira 開啟」。
- [x] AC-5：有附件的 ticket 顯示檔名與大小，點擊後以外部瀏覽器開啟對應 Jira 附件；無附件或附件欄位缺失時詳情與建卡仍可使用。
- [x] AC-6：375／768／1440px 的 Jira 分頁及詳情完成像素級畫面比對與互動驗收；沒有水平溢出、重疊或重要操作被遮住。
- [x] AC-7：受影響範圍通過 `AGENTS.md` Definition of Done 要求的型別、測試、建置、E2E 與 live Web UI 驗證。

## 限制與依賴

- 前端仍透過 core handler 取得 Jira 資料，不新增 API token。本機 `acli` 1.3.39 已驗證 `jira workitem view <KEY> --fields attachment --json` 回傳 `fields.attachment[]`，含 `id`、`filename`、`size` 和 `content`；現有的詳情補全流程可同時取得，不需額外 CLI 呼叫。外部附件網址須由已驗證的 site 與數字 id 組成。
- GitHub Issues／PRs 的既有 `onBrowseProject` 專案資料夾選擇流程可重用；系統選擇器可能回傳 `null`，應保持原選取值。
- `docs/features/jira-inbox/` 記錄前一版已完成的行為；本 Spec 的 AC 明確覆蓋其頁籤名稱、Jira Status 篩選、Jira 詳情連結與專案選擇的舊規則。

## 待確認事項

- 無。
