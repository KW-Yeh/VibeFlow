# Plan：調整工單頁面

- 狀態：已確認
- 對應 Spec：[spec.md](./spec.md)
- Spec 確認依據：2026-10-08 使用者回覆「確認」，採用「工作項目」、依 Status 分欄、附件檔名清單與 Jira 外部開啟
- 更新日期：2026-10-08
- 確認紀錄：2026-10-08 使用者回覆「確認」，同意依本 Plan 分階段實作、驗收與提交。

## 現有程式碼調查

| 檔案或專案 | 現有行為、可重用模式與調查依據 |
| --- | --- |
| `renderer/components/ui/view-tabs.tsx`、`renderer/components/side-menu.tsx` | 上方檢視與側邊欄收合狀態分別寫死 `Issues & PRs`；內部識別值是 `github`，只需改文案，不改儲存或導覽協定。 |
| `renderer/components/jira-panel.tsx` | Jira 工具列有 Status 複選 filter；卡片在自適應 grid；詳情 footer 的專案 `<select>` 只列 `projects`，沒有瀏覽資料夾；底部有「在 Jira 開啟」按鈕，Parent key 位於 meta 區。 |
| `renderer/components/inbox-view.tsx`、`renderer/pages/home.tsx` | `jiraFilters` 從 `home` 經 `inbox-view` 傳到 `jira-panel`；`projects` 由看板卡片及最近使用的專案組成。`home` 已提供 `pickProjectFolder()`，但只傳給 GitHub 詳情與新增任務。 |
| `renderer/components/github-view.tsx`、`renderer/lib/api.ts` | GitHub 詳情已有「從資料夾選擇專案」IconButton，`pickFolder()` 可呼叫主機原生選擇器；不可用時可輸入絕對路徑，取消回傳 `null`。Jira 詳情可沿用相同 callback。 |
| `renderer/lib/jira-filter.ts`、`test/jira-filter.test.mjs` | `jiraStatusOptions` 已按 category、名稱排序；`jiraEntries` 已按期限與 key 排序。改為純 `jiraStatusColumns` helper，刪除 filter state 與舊測試，補分欄順序、數量及欄內排序測試。 |
| `packages/core/src/jira.ts`、`test/jira.test.mjs` | `buildViewArgs` 對每張 Jira ticket 已並行抓詳情；`toTicket` 從回應產生 renderer 使用的資料。可在同一 `view --fields` 加入 `attachment`。本機 `acli` 1.3.39 實測 `fields.attachment[]` 含 `id`、`filename`、`size`、`content`；`attachment list --json` 也可用，但無需額外呼叫。 |
| `packages/core/src/service.ts` | `shell:openExternal` 只接受 HTTP(S)，瀏覽器開啟由 host 處理。附件 URL 要在 core 以已驗證的 Jira site 與數字附件 id 組成，避免採用原始回應中的任意 URL。 |
| `e2e/web.e2e.mjs` | Jira 假 runner、隔離 store、假專案 repo 與 Playwright 已具備。可將假 `PlatformServices.pickFolder` 設為另一個新 repo，測試從未在看板出現的專案建卡。 |
| `docs/DESIGN.md`、`test/ui-consistency.test.mjs` | 新的狀態欄與附件區使用現有暗色 token、圓角與 focus ring；renderer 變更需通過 UI 一致性檢查。 |

## 方案與取捨

1. **維持 `BoardView` 內部值 `github`，只改顯示名稱。** 避免為文案改動牽動大量狀態與 handler；README、E2E 可見文案同步更新。
2. **Jira 改為依實際 Status 建立欄位。** 純 helper 先依 category（new、indeterminate、done）和名稱排序欄位，再以現有期限/key 規則排序欄內 ticket。列表容器在窄視窗內水平捲動，每欄有可讀的固定最小寬度；頁面不產生水平溢出。取消 Jira filter state，GitHub 的各自篩選保留。
3. **Jira 詳情沿用 `onBrowseProject`。** 系統選到不在 `projects` 的路徑時，插入目前選項讓 `<select>` 可顯示該路徑；取消維持原值，建立流程由既有 `createTask` 驗證路徑與 repo。
4. **附件在 core 轉成最小、可信任的資料。** `JiraTicket.attachments` 僅含數字 id、檔名、大小，以及由 `site` 與 id 組成的 Jira HTTPS content URL；忽略格式不完整的附件。不要將原始 `content` URL 直接交給 `shell:openExternal`。詳情只顯示檔名與大小，點擊交由系統瀏覽器與 Jira 登入處理；無附件時隱藏清單。
5. **只對穩定區域要求像素一致。** 先用隔離 store 與固定 fixture 擷取現況，完成後在 375／768／1440px 同資料條件下做像素差圖；刻意改動的頁籤、Status 欄、Jira 詳情用截圖逐張檢查及座標／溢出斷言，未改動的 GitHub 區域比對像素。再以 `visual-parity` 跑 responsive 與互動流程，保存報告與必要的驗收圖片或短影片。

## 預計修改

| 檔案 | 修改內容 | 對應驗收條件 |
| --- | --- | --- |
| `packages/core/src/jira.ts` | `buildViewArgs` 加 `attachment`；新增附件型別、解析與安全 URL 建立。 | AC-5 |
| `test/jira.test.mjs` | 驗證附件解析、缺失欄位、惡意 id/URL 不進入可開啟資料。 | AC-5 |
| `renderer/lib/jira-filter.ts` → `renderer/lib/jira-columns.ts` | 移除 filter，輸出依 category/status 分欄且欄內排序的純 helper。 | AC-2 |
| `test/jira-filter.test.mjs` → `test/jira-columns.test.mjs` | 驗證動態欄位、欄位筆數、期限/key 排序及空資料。 | AC-2 |
| `renderer/components/ui/view-tabs.tsx`、`renderer/components/side-menu.tsx` | 將對外名稱改為「工作項目」。 | AC-1 |
| `renderer/pages/home.tsx`、`renderer/components/inbox-view.tsx` | 移除 `jiraFilters` state/props；把 `pickProjectFolder` 傳入 Jira 詳情。 | AC-2、3 |
| `renderer/components/jira-panel.tsx` | Status 分欄與可捲動容器、欄首筆數；專案資料夾 IconButton；key/Parent 連結與附件清單；移除底部 Jira 按鈕。 | AC-2–6 |
| `e2e/web.e2e.mjs` | 將原 Status filter 驗收改為欄位驗收；新增新專案資料夾建卡、key/Parent、附件與響應式檢查。 | AC-1–6 |
| `README.md`、`docs/README.md`、`test/README.md` | 更新名稱、功能摘要與測試索引。 | AC-1、7 |
| `docs/features/work-order-page/{spec,plan}.md` | 記錄確認決策、階段、實際驗證與限制。 | AC-7 |

## 實作順序與待辦

1. [x] **階段 A：基準與資料層。** 用隔離 store 和固定 Jira fixture 擷取現況；實作附件資料解析與單元測試，跑 core 型別及對應測試；完成後提交 `feat: expose Jira attachment metadata`。
2. [x] **階段 B：Jira 清單與詳情。** 實作「工作項目」文案、Status 欄位、資料夾選取、key/Parent 連結及附件列表；更新純 helper 測試，跑 renderer 型別、`npm test`、Web build；完成後提交 `feat: organize Jira tickets by status`。
3. [x] **階段 C：E2E 與畫面驗收。** 擴充瀏覽器流程；在 375／768／1440px 產生像素差圖、檢查截圖與水平溢出；跑全套 Definition of Done 與 live Web UI；更新 README 和本 Plan 的實測結果。錄影若有產出，存到指定 Artifacts 根目錄。完成後提交 `test: cover work item page flows`（若含文件可改成最貼切的 conventional commit）。
4. [x] **階段 D：交付。** 檢查 diff、提交狀態和驗收證據；push 分支，依 repo `pr` skill 建立英文標題／內容的 Draft PR。已產出驗收影片，並在 PR 新增獨立 comment 上傳影片。

每階段只提交本次任務檔案；不提交 `app/`、`renderer/.next/`、Artifacts 或 scratch。

## 風險與依賴

- **不同 Jira site 的附件欄位可能缺失。** 以 `[]` 處理；單張詳情讀取失敗仍由現有 Jira inbox 警示處理，不阻斷 ticket 建卡。
- **瀏覽器附件授權取決於使用者的 Jira 網頁登入狀態。** 若未登入，Jira 會要求登入；VibeFlow 不取得或轉存附件內容。
- **動態 Status 數量多時欄位超出可用寬度。** 只讓 Jira 列表區水平捲動；保留鍵盤焦點及卡片可達性，檢查 375／768px modal/footer 與頁面不溢出。
- **系統資料夾選擇器在部分 host 不受支援。** 現有 `pickFolder` 已提供手輸路徑備援；E2E 用假 platform 驗證，live Web UI 另驗實際對話框。
- **既有文案在測試與文件中出現多次。** 逐一更新使用者可見項目及斷言；內部 `github` 識別值和 GitHub 專用名稱保持原意。
- **錄影上傳到 GitHub comment 的方式需在 PR 建立階段核對。** 驗收影片先保存在指定 Artifacts；若 GitHub 上傳不可用，記錄具體阻礙，不貼只有本機可存取的連結。

## 驗證計畫

| 檢查 | 命令或操作 | 對應驗收條件 |
| --- | --- | --- |
| Core 型別 | `npx tsc --noEmit -p tsconfig.json` | AC-5、7 |
| Renderer 型別 | `npx tsc --noEmit -p renderer/tsconfig.json` | AC-1–6、7 |
| Headless 測試 | `npm test` | AC-2、5、7 |
| Web build | `npm run build:web`（受限執行環境用 `-- --webpack`） | AC-7 |
| E2E | `npm run test:e2e`，用固定 Jira/專案 fixture 測各互動狀態 | AC-1–7 |
| Live Web UI | `npm start -- --store-path <隔離目錄> --no-open --port <可用埠>`，保留 `?token=…`，操作 Jira Status 欄、資料夾選擇、連結與附件 | AC-2–6 |
| 像素與 RWD | 同一 fixture 在 375／768／1440px 截前後畫面、輸出像素差圖；`visual-parity` responsive；逐張檢查重疊、溢出、空白、截字、水平溢出 | AC-1、2、4–6 |
| 驗收錄影 | 若錄製，短片展示一條建卡互動路徑，存入指定 Artifacts 並在 Draft PR comment 上傳 | AC-3、7 |

## 待確認事項

- 無。

## 實作與驗證紀錄

- 2026-10-08，階段 A：以隔離 store、三張固定 Jira ticket 擷取改動前 375／768／1440px 的清單與詳情畫面，基準圖留在 Artifacts `scratch/`。本機 `acli` 1.3.39 確認 `--fields attachment` 回傳 `fields.attachment[]`（id、filename、size、content）；附件 URL 由 site 與純數字 id 組成，忽略原始 content URL。`node scripts/run-tests.mjs ./test/jira.test.mjs` 9/9 通過，`npx tsc --noEmit -p tsconfig.json` 通過。
- 2026-10-08，階段 B：依實際 Status 分欄、移除 Jira Status filter、加入資料夾選擇、Jira key/Parent 連結與附件清單；截圖目視檢查 375／768／1440px 的清單和詳情，無明顯重疊或頁面水平溢出。`node scripts/run-tests.mjs ./test/jira-columns.test.mjs` 2/2、`npx tsc --noEmit -p renderer/tsconfig.json`、`npm test` 426/426、`npm run build:web` 均通過；完整像素差圖與 E2E 待階段 C。
- 2026-10-08，階段 C：`npm run test:e2e` 2/2 通過，且針對模型清單載入競態調整後連續兩次通過；假 platform 驗證資料夾取消與新專案建卡，外部 Jira key、Parent、附件 URL 均送到 host。改動前後同 fixture 的 375／768／1440px 像素差圖顯示，預期改動區外的差異像素為 0；document `scrollWidth` 均等於 viewport。`visual-parity responsive` 在未改動看板上 768／1440px 各 30 個配對元素、0 個屬性差異；375px 的 2 個寬度差異由頁籤縮短增加可用空間造成。驗收錄影 9/9 步驟、5.08 秒。真實 `acli` 的 live Web UI 使用隔離 store 讀取 18 張 ticket、3 個 Status 欄，無 console/request 錯誤。詳情第一張正式 ticket 無附件；附件 UI 由固定 fixture 驗證。完整報告與截圖在 worktree 旁的 Artifacts `ACCEPTANCE.md`。
- 2026-10-08，階段 D：`git diff --check origin/main...HEAD` 通過，前三階段 commit 與 Artifacts 根目錄證據均已核對。建立 [Draft PR #109](https://github.com/KW-Yeh/VibeFlow/pull/109)，並在[獨立留言](https://github.com/KW-Yeh/VibeFlow/pull/109#issuecomment-6052807415)上傳影片；GitHub 回傳正式附件 URL，已核對 PR 為 Draft。
