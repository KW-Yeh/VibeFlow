# Plan：Issues & PRs 篩選

- 狀態：已確認
- 對應 Spec：[spec.md](./spec.md)
- Spec 確認依據：spec.md 2026-10-07 版（含追加的「我 review 過的 PR」，與本 Plan 一併重新確認）
- 更新日期：2026-10-07
- 確認紀錄：2026-10-07 使用者確認 Plan（含 core 的 `reviewed-by:@me` 階段），授權依計畫實作、分批 commit、push 並開 Draft PR

## 現有程式碼調查

| 檔案 | 現有行為、可重用模式與調查依據 |
| --- | --- |
| `renderer/components/github-view.tsx` | 頂列用 `ProjectFilter`（單選），`projectFilter` 由 props 傳入；`issues`／`prs` 由 `repos` flatMap 後以 `byNewest` 排序；`failed` 只看篩選後的 repo；`selected` 從篩選後的清單找，找不到就不顯示抽屜（但 `selectedKey` 仍保留）。空狀態文案在 `Column` 的 `empty` |
| `renderer/components/board-columns.tsx` | `ProjectFilter`（單選下拉，看板也用）、私有的 `useDismissible`（點外部／Esc 收起）與 `MENU_ITEM` class。看板檢視的篩選本次不改 |
| `renderer/pages/home.tsx` | `githubProject: string \| null` 狀態；`selectGithubProject` 設定專案並切到 github 檢視；傳給 `SideMenu.activeProject` 與 `GithubView.projectFilter` |
| `renderer/components/side-menu.tsx` | 專案列 `active = view === 'github' && activeProject === name`；點擊呼叫 `onSelectProject(active ? null : name)` |
| `packages/core/src/github.ts` | `GithubItemBase.author: GithubUser \| null`、`assignees: GithubUser[]`；資料形狀不需改。`fetchRepoItems` 平行跑 5 個 `gh` 查詢（Issue：assignee／author；PR：assignee／author／`--search review-requested:@me`），`mergeItems` 依編號去重 |
| `test/github.test.mjs` | 用假 runner 依參數回應（`has('pr', 'review-requested:@me')`），可直接加一組 `reviewed-by:@me` |
| `renderer/lib/diff-state.ts` + `test/diff-state.test.mjs` | renderer 純函式可以用相對路徑 `import type` 後由 `npm test` 直接測，這是放篩選邏輯的模式 |
| `e2e/fake-gh.mjs` + `e2e/web.e2e.mjs` | 假 `gh` 有兩個 repo（VibeFlow、clcom-frontend）、三個使用者（kw-yeh、dev-amy、dev-ben），e2e 已驅動 Issues & PRs 檢視，可延伸驗篩選 |
| `test/ui-consistency.test.mjs` | 手寫 `<button>` 必須有 `focus-visible:ring-[3px]`、不得用裸 `rounded` |

## 方案與取捨

- **我 review 過的 PR**：`fetchRepoItems` 多一個 `listPrs(run, repo, ['--search', 'reviewed-by:@me'])`，併入 `mergeItems`。GitHub 的 `reviewed-by:` 涵蓋 approve、要求修改、review comment，符合已確認的範圍；不需要額外抓 `reviews` 欄位。
- **篩選邏輯放純函式** `renderer/lib/github-filter.ts`：選項彙整、比對（同篩選 OR、跨篩選 AND、未指派）、排序（專案名稱 → 編號大到小）。元件只負責呈現，邏輯由 `npm test` 覆蓋。
- **「未指派」用一個不可能是 GitHub login 的哨兵值**（含 `:`，GitHub login 只允許英數與 `-`），讓三個篩選共用 `string[]` 形狀。
- **新增複選下拉元件** `renderer/components/github-filter-menu.tsx`，外觀沿用 `ProjectFilter`（同一顆觸發按鈕樣式、同一個 menu 容器與 `MENU_ITEM`），差別只在：勾選後不收起、`role="menuitemcheckbox"` + `aria-checked`、按鈕文字依勾選數量變化。為了重用，把 `board-columns.tsx` 的 `useDismissible` 與 `MENU_ITEM` 改為 export（行為不變）。
  - 不改造 `ProjectFilter` 成通用複選：看板仍要單選，合併會讓看板也被迫處理多選狀態。
- **篩選狀態留在 `home.tsx`**：側邊欄點專案要改寫專案篩選，所以狀態維持在兩者共同的父層，型別從 `string | null` 改為 `GithubFilters`。只存在 React state，不寫 store／localStorage（Spec：不保留）。
- **側邊欄**：`activeProject: string | null` 改為 `activeProjects: string[]`；切換規則（只勾該專案 ↔ 清空）放在 `home.tsx`，側邊欄只回報被點的專案名稱。
- **抽屜**：`selectedKey` 指向的項目被篩掉時清掉 `selectedKey`，避免清除篩選後抽屜又自己跳出來。

## 預計修改

| 檔案 | 修改內容 | 對應驗收條件 |
| --- | --- | --- |
| `packages/core/src/github.ts` | `fetchRepoItems` 加 `reviewed-by:@me` 查詢；更新函式註解 | AC-7 |
| `test/github.test.mjs` | 新增：只出現在 `reviewed-by:@me` 的 PR 會列出、與其他查詢重複時只出現一次 | AC-7 |
| `e2e/fake-gh.mjs` | 加一個「已 approve、非指派、非作者」的 PR，只回應 `reviewed-by:@me` 搜尋 | AC-7 |
| `AGENTS.md` | Issues & PRs 慣例段落的資料範圍補上「reviewed by」 | 文件 |
| `renderer/lib/github-filter.ts`（新增） | `GithubFilters`、`EMPTY_GITHUB_FILTERS`、`UNASSIGNED`、`githubFilterOptions`、`matchesGithubFilters`、`compareByProjectThenNumber`、`hasGithubFilters`、`toggleValue` | AC-1、AC-2、AC-3 |
| `test/github-filter.test.mjs`（新增） | 上述純函式的單元測試 | AC-1～AC-3 |
| `renderer/components/github-filter-menu.tsx`（新增） | 複選下拉元件 | AC-1 |
| `renderer/components/board-columns.tsx` | export `useDismissible`、`MENU_ITEM`（不改行為） | — |
| `renderer/components/github-view.tsx` | props 改為 `filters`／`onFiltersChange`；頂列三個下拉 + 清除篩選；套用篩選與新排序；篩選後空狀態文案；被篩掉時清掉選取；頂列說明文字與 PR 空狀態文案加入「review 過」 | AC-1～AC-4、AC-7 |
| `renderer/pages/home.tsx` | `githubProject` → `githubFilters`；側邊欄點專案的切換規則 | AC-5、AC-6 |
| `renderer/components/side-menu.tsx` | `activeProject` → `activeProjects`，點擊只回報專案名稱 | AC-5 |
| `e2e/web.e2e.mjs` | 在既有 Issues & PRs 段落加入篩選／清除／排序斷言 | AC-1～AC-4 |
| `test/README.md`、`docs/README.md` | 登記新測試與新功能文件 | 文件規則 |

## 實作順序

1. **文件**：spec.md + plan.md、`docs/README.md` 登記 → commit `docs:`。
2. **Core**：`github.ts` 加 `reviewed-by:@me` + `test/github.test.mjs` + fake gh + AGENTS.md → `npx tsc --noEmit -p tsconfig.json`、`npm test` → commit `feat(github):`。
3. **純邏輯**：`github-filter.ts` + 測試 → `npm test`、tsc → commit `feat:`。
4. **UI**：下拉元件、github-view、home、side-menu → 兩個 tsc、`npm test`（ui-consistency）、`npm run build:web` → commit `feat:`。
5. **E2E 與驗收**：e2e 斷言、`npm run test:e2e`、像素比對、驗收影片 → commit `test:` 與 plan 紀錄 `docs:`。
6. push、開 Draft PR，另外新增一則 comment 上傳驗收影片。

## 風險與依賴

- **頂列寬度**：三個篩選 + 清除按鈕 + 右側說明文字。右側文字已是 `truncate`，篩選按鈕 `shrink-0`；在 1440 寬與側邊欄展開時實際截圖確認不溢出。
- **契約變動**：`GithubViewProps`、`SideMenu` props 改形狀；使用端只有 `renderer/pages/home.tsx`（已用 grep 確認），一併修改。
- **API 用量**：每個 repo 每次抓取從 6 次增為 7 次 `gh` 呼叫，仍走 5 分鐘快取與手動重新整理。
- **選取的值消失**：重新整理後已勾的使用者可能不在資料中；選項為「資料中的值 ∪ 已勾選的值」，確保能取消。

## 驗證計畫

| 檢查 | 命令或操作 | 對應驗收條件 |
| --- | --- | --- |
| Typecheck（renderer） | `npx tsc --noEmit -p renderer/tsconfig.json` | 工程品質 |
| Typecheck（core，測試引用 renderer lib 無影響仍跑一次） | `npx tsc --noEmit -p tsconfig.json` | 工程品質 |
| 單元測試 + ui-consistency | `npm test` | AC-1～AC-3 |
| 建置 | `npm run build:web` | 工程品質 |
| Core 單元測試 | `node scripts/run-tests.mjs ./test/github.test.mjs` | AC-7 |
| E2E | `npm run test:e2e`（含 approve 過的 PR 出現在清單） | AC-1～AC-4、AC-7 |
| 實際操作（Playwright 錄影） | 用 fake gh + 拋棄式 `--store-path` 起 host：開 Issues & PRs → 各篩選複選 → 未指派 → 跨篩選 AND → 清除篩選 → 側邊欄點專案 → 重新整理頁面回到全部；錄成驗收影片 | AC-1～AC-6 |
| 像素比對 1：前後版本 | 同一份 fake gh 資料、1440×900，`main` 與本分支的 Issues & PRs 檢視（未篩選）各截一張比對；差異應只在頂列篩選區與因排序改變的卡片順序 | AC-3、回歸 |
| 像素比對 2：下拉樣式一致性 | 截看板檢視的 `ProjectFilter` 下拉與新的「專案」複選下拉（相同選項），裁切 menu 區域比對；容器、列高、字級、勾號位置應一致 | AC-1、設計一致性 |
| RWD／溢出 | 1440 與 1024 寬、側邊欄展開與收合，檢查頂列無水平溢出 | 工程品質 |
| 留存檢查 | 篩選後讀 store JSON 與 `localStorage`，確認沒有篩選資料 | AC-6 |

## 待確認事項

- 無

## 實作與驗證紀錄

2026-10-07 依計畫完成，分支已 rebase 到最新 `main`（含 #105）。

| 檢查 | 結果 |
| --- | --- |
| `npx tsc --noEmit -p tsconfig.json` | 通過 |
| `npx tsc --noEmit -p renderer/tsconfig.json`（先刪 `renderer/.next`） | 通過 |
| `npm test` | 411／411 通過（新增 `github-filter.test.mjs` 8 項；`github.test.mjs` 加入 `reviewed-by:@me`，快取測試的 `gh` 呼叫次數依每次抓取 6 次更新） |
| `npm run build:web` | 通過 |
| `npm run test:e2e` | 1／1 通過；新增：#107（我 approve 過、未指派）有列出、排序 `[112, 108, 107, 105, 103]`、發起人 OR、跨篩選 AND、未指派、清除篩選 |
| 實際操作（Playwright，1440×900，fake gh） | 各步驟清單符合預期；重新整理後回到全部；store 不含篩選資料、`localStorage` 沒有 key；console 無錯誤；1024 寬無水平溢出。驗收影片 `issues-prs-filters-acceptance.mp4` |
| 像素比對 1：前後版本（同一份舊 fake gh 資料） | 全畫面差異 1.93%。頂列 x<370（分頁與「專案」按鈕）完全一致，差異只在新增的兩個篩選與右側說明文字；卡片區差異來自排序改變；下半部差異是「最近使用的專案」下拉 placeholder 的載入時機，看板檢視（未修改）也有同樣差異。證據：`pixel-view-before-after.png`、`pixel-diff.json` |
| 像素比對 2：新下拉 vs 看板 `ProjectFilter` | 差異 0.229%，只在裁切邊界的背景；新下拉 vs 舊 Issues & PRs 專案下拉 0.082%。證據：`pixel-menu-board-vs-github.png`、`pixel-menu-before-after.png` |

證據放在任務 artifacts 資料夾（不進 git）。

實作中的發現：

- rebase 前，e2e 在模型選單（`Fable 5.1` 選項）逾時，與本功能無關；`main` 的 #105（`fix/agent-default-model`）修正後通過。
- `useDismissible`／`MENU_ITEM` 改為 export，讓新下拉沿用看板下拉的行為與樣式；看板的 `ProjectFilter` 本身未改。
- 新下拉把 `useDismissible` 的 ref 掛在包含觸發按鈕的外層容器，讓「選單開啟時再點按鈕」能正常收起。看板 `ProjectFilter` 的 ref 只掛在選單上，依程式推論可能有「點按鈕先關又開」的問題，**未實際驗證**，也未修改（不在範圍內）。
