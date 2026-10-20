# Jira 四欄與抓取範圍

- 需求來源：2026-10-20 使用者要求工作項目中的 Jira 分頁滿版、固定四欄，並讓抓取範圍可篩選。
- 本文件覆蓋 [work-order-page](../work-order-page/spec.md) 中依實際 status 動態產生欄位的舊規則。

## 目標

Jira 分頁在可用寬度內呈現四個固定欄位，空欄也顯示。使用者可切換送給 Jira 的查詢範圍，並在重新整理或重開頁面後保留選擇。

## 行為

1. 欄位順序固定為 To Do、In Progress、To be Released、Done。寬視窗四欄撐滿列表區；窄視窗只在列表區水平捲動。
2. `To be Released` 精確歸入同名欄；其他狀態依 Jira status category 歸入 To Do、In Progress 或 Done，卡片保留原始狀態標籤。每欄沿用期限與 key 排序。
3. 抓取範圍提供「目前工作」（原有查詢）、「Active Sprint」（指派給自己且在 active sprint）、「全部指派給我」（不加狀態或 sprint 條件）。切換時重新查詢 Jira；重新整理只更新目前範圍。範圍存在瀏覽器本機。
4. 沒有符合範圍的 ticket 時仍呈現四個零筆欄位及空狀態提示。登入、詳情與建卡流程維持原有行為。

## 驗收

- 四欄固定且順序正確，其他狀態沒有遺失，空資料時仍有四欄。
- 不同抓取範圍送出不同 JQL，快取互不混用，非法範圍遭 handler 拒絕。
- 切換範圍與重新整理後顯示對應資料；重新載入仍保留選擇。
- 完成 core 與 renderer 型別檢查、單元測試、Web build、E2E 及實際 Web UI 版面檢查。
