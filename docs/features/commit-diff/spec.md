# Spec：Git diff 依 commit 分類

- 狀態：已確認
- Ticket：尚無
- 需求來源：使用者對話（2026-11-10）
- 更新日期：2026-11-10
- 確認紀錄：2026-11-10 使用者確認整份 Spec（「確認，寫 Plan」）；2026-11-10 UI 設計稿確認，同時追加「移除決策分頁」；2026-11-10 使用者確認更新後 Spec（「確認，開始實作」）

## 問題與目標

工作區的「Git diff」分頁目前只列出整個 branch 相對 base 的全部變更，看不出每一步做了什麼；
Done 卡則完全沒有 diff，只剩 outcome 的 commit 標題與檔案清單。

目標：

1. In Progress 卡的 Git diff 分頁可以依 commit 檢視：先看 commit 清單，點進某個 commit 看它改的檔案，再點檔案看 diff。
2. Done 卡也能用同樣方式看每個 commit 的變更；資料在點開時才抓。
3. 移除「決策」分頁：不再在工作區與 Done sheet 顯示 branch 的 `spec.md`。

## 已確認決策（2026-11-10）

- Live 卡：保留現有「全部」平面清單，**加一個切換「全部／依 commit」**，不取代原檢視。
- Done 卡資料來源：branch 通常已刪，**先從 base 找 commit**（commit 已經在 base 歷史裡就用本地 git），**找不到再用 `gh`** 抓。
- `gh` 抓回的 diff 是 unified patch，**直接渲染 patch**，不額外抓前後完整檔案。
- Done 卡在 sheet **新增「Git diff」分頁**。
- UI 設計稿（https://claude.ai/artifact/FUSHCXSsXU2eJwFuYR8nQH）已確認。
- **移除「決策」分頁**（工作區與 Done sheet 都移除），不再需要顯示 spec.md。

## 範圍

### 本次包含

- Live 卡 Git diff 分頁的「全部／依 commit」切換，選擇記在本機（跟現有 split / 全文 context 偏好放一起）。
- 依 commit 檢視：「未 commit 的變更」一組 + branch 上的 commit 清單 → commit 的檔案清單 → 單檔 diff。
- Done sheet 的「Git diff」分頁：commit 清單 → 點開時抓該 commit 的檔案與 diff。
- Done 卡的資料來源：本地 base 歷史 → `gh`（需有 PR）→ 都沒有就說明抓不到。
- 移除「決策」分頁，以及只為它存在的 core 讀取邏輯（`task:getSpecs` handler、`specs.ts`、其測試）。

### 本次不包含

- 全畫面（放大）檢視的依 commit 版本 —— 放大檢視維持「全部」。
- TUI。
- 在 Done 卡看「整個 branch 的總 diff」（outcome 的檔案清單已有統計，不另抓內容）。
- 改變 outcome 在完成時擷取的內容（不改存放格式）。
- feature-spec-plan skill 照舊寫 `spec.md` 進 repo；只是 VibeFlow 不再顯示它。
- `decisions.ts`（刪除舊 `.DECISIONS.md` 殘檔）不動。

## 行為

### In Progress 卡（live）

| 情境 | 預期行為 |
| --- | --- |
| 開 Git diff 分頁 | 頂端有「全部／依 commit」切換；預設「全部」，與現在完全相同。之後沿用上次選擇。 |
| 切到「依 commit」 | 列表：若有未 commit 變更（含 untracked），最上面一組「未 commit 的變更」；下面是 `base..HEAD` 的 commit，新到舊，每列顯示短 sha、標題、相對時間、+/− 行數、檔案數。 |
| 點一個 commit | 換成該 commit 的檔案清單（相對它的第一個 parent），上方有返回與 commit 標題；點檔案開與現在相同的單檔 diff modal（完整前後內容、split／全文切換照舊）。 |
| 點「未 commit 的變更」 | 檔案清單為 working tree 相對 HEAD；點檔案同上。 |
| branch 內的 merge commit（例如把 base merge 進來） | 列出，標示 merge；檔案清單相對第一個 parent。 |
| 沒有任何 commit 也沒有未 commit 變更 | 顯示與現在相同的「與基準分支相比沒有變更」。 |
| commit 數超過上限（50，與 outcome 相同） | 只列最新 50 個並註明。 |
| 輪詢 | 清單沿用現有 3 秒、不 fetch 的輪詢；新 commit 出現時自動出現在清單。 |

### Done 卡

| 情境 | 預期行為 |
| --- | --- |
| Done 卡有 outcome commits | sheet 多一個「Git diff」分頁，列出 outcome 存的 commit（短 sha + 標題）。不打開分頁就不抓任何東西。 |
| 點一個 commit | 顯示載入中，然後列出它改的檔案（+/−）。 |
| 資料來源：commit 在 base 歷史中 | 在卡的專案 repo 內（先嘗試 `git fetch origin <base>`，失敗不擋）確認 commit 可從 base 抵達，就用本地 git 讀；點檔案看完整前後內容的 diff（與 live 相同元件）。 |
| 資料來源：base 找不到（squash／rebase merge、PR 未 merge、專案資料夾已不存在） | 卡有 PR 時用 `gh` 從該 PR 的 commits 找到完整 sha，再抓該 commit 的檔案與 patch；點檔案以 unified patch 顯示。 |
| 兩者都抓不到（沒 PR、`gh` 未安裝或未登入、網路失敗） | 該 commit 顯示原因（例如「此卡沒有 PR，且 base 中找不到這個 commit」），不影響其他分頁。 |
| GitHub 未提供某檔 patch（二進位、過大） | 該檔列出但註明「GitHub 未提供此檔的 diff」。 |
| 同一個 commit 再點一次 | 在 sheet 開著期間用快取，不重抓。 |

### 移除決策分頁

| 情境 | 預期行為 |
| --- | --- |
| 開 In Progress 卡的工作區 | 分頁只剩 任務／Artifacts／Git diff（master 卡維持原本的分頁，只少決策）。 |
| 開 Done 卡 sheet | 分頁為 任務／Git diff（master：子卡／任務）；預設開在「任務」。 |
| 之前記住的分頁是「決策」 | 落回預設分頁，不報錯。 |

## 驗收條件

- [ ] AC-1：In Progress 卡 Git diff 分頁預設「全部」，畫面與現在一致；切到「依 commit」後重開頁面仍是「依 commit」。
- [ ] AC-2：有 2 個 commit + 1 個未 commit 修改的卡，「依 commit」顯示「未 commit 的變更」與 2 個 commit；點各自只看到該組的檔案，點檔案開 diff modal 內容正確。
- [ ] AC-3：Done 卡（commit 已 merge 進 base，非 squash）點開「Git diff」分頁的 commit，從本地 git 讀出檔案清單，檔案 diff 可切 split／全文。
- [ ] AC-4：Done 卡（squash merge，有 PR）點開 commit，經 `gh` 讀出檔案清單，檔案以 unified patch 顯示。
- [ ] AC-5：Done 卡沒有 PR 且 base 找不到 commit 時，顯示原因，不報錯、不卡住。
- [ ] AC-6：Done sheet 不打開「Git diff」分頁時不執行任何 git／gh 指令。
- [ ] AC-7：所有新 handler 驗證參數、只收 task id 與 sha（sha 只接受 hex），不接受路徑。
- [ ] AC-8：工作區與 Done sheet 都沒有「決策」分頁；開卡時不再呼叫 `task:getSpecs`（handler 已移除）。

## 限制與依賴

- `gh` 只用使用者自己的登入（與 Issues & PRs 相同），不存 token。
- outcome 只存短 sha；`gh` 路徑以 PR 的 commit 清單比對前綴取得完整 sha。
- 本地 git 路徑依賴 `Task.projectPath` 仍存在且是 git repo。
- 新的偏好欄位加在既有 `DiffViewPrefs`（localStorage），舊值缺欄位時視為「全部」，不需 migration。
- handler table 變動需同步 `packages/core/IPC_API_MAP.md`。

## 待確認事項

- 無
