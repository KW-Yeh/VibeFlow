# Spec：GitHub Issue 與 PR 檢視

- 狀態：已確認
- Ticket：尚無
- 需求來源：VibeFlow 卡片「加入 Issue 與 PR」的任務描述（2026-10-06），以及 design 畫布
  <https://claude.ai/artifact/RA72hrtsXNvGpF5VzkNU5q> 上使用者選定的方案
- 更新日期：2026-10-06
- 2026-10-08 需求更新：Issues／PRs 改為跨所有 GitHub repo 搜尋與登入者相關的 open 項目，不再以看板專案決定抓取範圍。沒有對應看板專案的 repo 仍顯示；從其 Issue／PR 建卡時，先選擇本機專案資料夾。
- 確認紀錄：2026-10-06 部分決策已確認（不是整份 Spec 確認）——layout 採方案 C（主畫面分頁 + 詳情抽屜）；
  任務卡片採變體 2（編號併入分支列）；資料範圍為「指派給我 + 我建立的」；需求中的「tag」= GitHub Issue Type。
  2026-10-06 整份 Spec 確認——側邊欄專案列的「在此專案新增任務」與「刪除整個專案」兩個操作都移除；
  轉卡確認重用現有新增任務表單並預填；Issues & PRs 檢視只取代上半部看板區，保留下半部工作區與分隔線。

## 問題與目標

側邊欄目前列出各專案底下的任務。看板已經呈現同一批卡片，所以這份列表的資訊和看板重疊，實用性不高。
使用者真正想看到的是「GitHub 上有哪些 Issue／PR 等我處理」，並能把它們一鍵轉成 VibeFlow 的
Backlog 卡片交給 agent 處理；處理中的卡片也要看得出對應哪張 Issue／PR。

目標：

1. 在「Issues & PRs」檢視列出所有 GitHub repo 中跟我有關的 open Issue 與 PR，無須先建立看板卡片。
2. 可查看單一 Issue／PR 的詳細內容並前往 GitHub。
3. 經確認後把 Issue／PR 轉成 Backlog 卡片。
4. 看板上的任務卡片顯示它對應的 Issue／PR。

## 範圍

### 本次包含

- 側邊欄移除依專案分組的任務樹與「搜尋任務」，改為：
  - 「檢視」：看板／Issues & PRs（帶 open 數量）。
  - 「專案」：看板上的專案清單，每列顯示 Issue 數 · PR 數；點擊 = 在 Issues & PRs 檢視篩選該專案。
    原本 hover 時的「在此專案新增任務」與「刪除整個專案」移除（新增任務仍可從「新增任務」按鈕選專案）。
- 主畫面上半部（目前的看板區）頂部加入「看板 ｜ Issues & PRs」分頁切換；下半部工作區（終端機、新增任務表單）維持不變。
- Issues & PRs 檢視：Issues 與 Pull Requests 兩欄卡片，加上右側詳情抽屜。
- 卡片欄位——Issue：標題、#編號、專案名稱、發起人、assignee、建立時間、labels、Issue Type。
  PR：標題、#編號、專案名稱、發起人、assignee、建立時間、狀態（Draft／Open／Review 狀態）。
- 詳情抽屜：上述欄位、milestone、內文（markdown）、「在 GitHub 開啟」、「轉為 Backlog 卡片」。
- 轉為 Backlog 卡片（流程見「行為」），新卡片記住來源 Issue／PR。
- 看板任務卡片的分支列右側顯示對應的 Issue／PR 編號，以圖示顏色表示狀態，點擊開啟 GitHub。
- 手動重新整理按鈕，並顯示「N 分鐘前更新」。

### 本次不包含

- 在 VibeFlow 內留言、改 label／assignee、關閉或合併 Issue／PR（只讀＋轉卡片）。
- 非 GitHub 的 remote（GitLab 等）、GitHub Enterprise 主機。
- TUI 與遠端控制（手機）畫面：core API 會提供，但這兩個 frontend 本次不加 UI。
- 已 closed／merged 的 Issue／PR 清單（只列 open；任務卡片上的連結仍會顯示 merged／closed 狀態）。
- 背景自動輪詢通知新 Issue。

## 行為

| 情境或觸發條件 | 預期行為 |
| --- | --- |
| 開啟 Issues & PRs 分頁，或按重新整理 | 跨 GitHub repo 搜尋 open Issue（指派給我或我建立的）與 open PR（指派給我、我建立的、請我 review 或我已 review 的），再抓各 repo 詳情；看板專案 `origin` 只用於對應本機路徑 |
| 資料已在 5 分鐘內抓過 | 直接顯示快取，不重新抓；重新整理按鈕一律強制重抓 |
| 某專案沒有 GitHub `origin` | 跳過該專案，不視為錯誤 |
| 未安裝 `gh` 或未登入 | 檢視顯示說明，並提供按鈕開啟設定中既有的 GitHub 登入 |
| 單一 repo 抓取失敗（網路、權限） | 其他 repo 照常顯示；失敗的 repo 在檢視上方列出錯誤訊息 |
| 沒有任何符合的 Issue／PR | 各欄顯示「沒有指派給你或你建立的 open Issue／PR」 |
| 點側邊欄專案 | 切到 Issues & PRs 分頁並只顯示該專案；再點一次或選「所有專案」取消篩選 |
| 點卡片 | 右側抽屜顯示詳細內容，卡片呈選取樣式；Esc 或關閉按鈕收起抽屜 |
| 點「在 GitHub 開啟」 | 以系統瀏覽器開啟該 Issue／PR 的 URL |
| 點「轉為 Backlog 卡片」 | 開啟新增任務表單並預填：專案 = 該 repo 對應的本機專案路徑、標題 = Issue／PR 標題、描述 = 連結 + 內文；PR 另外預填分支 = PR 的 head branch、base = PR 的 base branch。使用者可修改，按建立才真正新增 |
| 建立成功 | 卡片進入 Backlog，記住來源 Issue／PR；Issues & PRs 檢視中該項目標示「已在看板」 |
| 同一 Issue／PR 已有看板卡片 | 抽屜改顯示「已在看板」並提供「前往卡片」，仍允許再建一張（例如重做） |
| 任務卡片有對應 Issue／PR | 分支列右側顯示 `#編號`：Issue 圖示、PR 圖示各自上色（綠 = open、灰 = draft、藍 = merged、紅 = closed）；點擊開啟 GitHub，不觸發選取卡片 |
| 任務卡片如何找到對應 PR | 由卡片分支名稱對到該 repo 的 PR head branch；已完成卡片沿用完成時記錄的 `outcome.pr` |
| 任務卡片如何找到對應 Issue | 由 Issue 轉成的卡片記住來源；其他卡片取其 PR 的 closing issues（`Closes #N`） |
| 側邊欄收合 | 收合列只保留圖示：看板、Issues & PRs、新增任務、設定 |

時間文案：卡片用相對時間（「2 天前」），抽屜用絕對時間（`YYYY-MM-DD HH:mm`）。

## 驗收條件

- [ ] AC-1：側邊欄不再出現任務樹與「搜尋任務」，改為「檢視」與「專案」兩區；專案列顯示 Issue · PR 數量。
- [ ] AC-2：看板區頂部可切換「看板 ｜ Issues & PRs」，切換時下半部工作區不受影響（終端機不重啟）。
- [ ] AC-3：Issues & PRs 檢視列出所有 repo 中指派給我或我建立的 open Issue，以及指派給我、我建立、請我 review 或我已 review 的 open PR；沒有看板卡片的 repo 也要出現。
- [ ] AC-4：點卡片開啟詳情抽屜，顯示內文與所有欄位；「在 GitHub 開啟」開到正確 URL。
- [ ] AC-5：「轉為 Backlog 卡片」開啟預填好的新增任務表單；建立後 Backlog 出現新卡，分支列顯示該 Issue／PR 編號。
- [ ] AC-6：由 PR 轉成的卡片，分支 = PR head branch；啟動時沿用 origin 上的該分支，而不是從 base 新開。
- [ ] AC-7：既有任務若分支已有 PR，卡片分支列顯示 PR 編號與狀態色；PR 有 `Closes #N` 時也顯示該 Issue。
- [ ] AC-8：沒有 `gh`、未登入、repo 非 GitHub、單一 repo 失敗時，都依「行為」表顯示，不會整個檢視壞掉。
- [ ] AC-9：重新開啟 app 後，由 Issue／PR 轉成的卡片仍保有對應關係（資料有存進 store）。

## 限制與依賴

- 依賴使用者本機的 `gh` CLI 及其登入狀態（與現有 PR 狀態、GitHub 登入功能相同）；不另存 token。
- `issueType` 欄位需要較新的 `gh`（本機 2.96.0 可用）；舊版不支援時隱藏 Issue Type，不讓整次抓取失敗。
- GitHub API 有速率限制：每次抓取每個 repo 約 6 次 `gh` 呼叫（實測單次約 1 秒，可平行），因此採快取加手動重新整理，不做背景輪詢。
- 會留存的資料：Task 新增可選欄位記錄來源 Issue／PR。舊卡片沒有這個欄位，視為「沒有來源」，不需轉換既有資料，但 Plan 中要列出相容性檢查。
- 視覺沿用 `docs/DESIGN.md`／`globals.css` 的 token 與 `ui-consistency` 規則；實作完成後與設計畫布做像素級比對。

## 待確認事項

- 無
