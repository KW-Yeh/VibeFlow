# Jira 四欄與抓取範圍：實作記錄

- 對應需求：[spec.md](./spec.md)
- 2026-10-20：使用者指定直接在 `main` 修改、push 並 release。
- 2026-10-20：使用者確認抓取範圍為「全部／Active Sprint」；移除暫定的第三個範圍。

## 設計

- `jira-columns.ts` 統一將 ticket 分配到固定四欄；原始 Jira status 留在卡片上，避免隱藏未列出的工作流程狀態。
- Jira 查詢由 core 持有有限的 scope 選項與 JQL；Web UI 只傳 scope 值，handler 驗證後才交給 `acli`。每個 site 與 scope 分開快取。
- Web UI 在 `localStorage` 記住 scope；切換時暫時隱藏前一範圍的結果。四欄以可撐滿容器的 grid 呈現，窄視窗在列表內捲動。
- 兩種範圍都使用 `--paginate` 且不加筆數上限。預設 Active Sprint，避免啟動時自動抓取整段 Jira 歷史；從上一版保存的 `current` 選擇遷移到 Active Sprint。

## 驗證

- `test/jira-columns.test.mjs`：固定欄、未知狀態及欄內排序。
- `test/jira.test.mjs`、`test/service.test.mjs`：JQL、範圍快取與 handler 驗證。
- `e2e/web.e2e.mjs`：四欄、切換範圍、重新載入保留選擇，並覆蓋既有詳情與建卡流程。
