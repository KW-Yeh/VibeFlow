# Plan：看板篩選（專案、標籤）

- Spec：[spec.md](spec.md)
- 更新日期：2026-11-25

## 變更

1. `renderer/lib/board-filter.ts`：純函式 `projectLabel`、`boardFilterOptions`、`matchesBoardFilters`、
   `masterMatch`（master 自己符合 / 只因底下卡符合）、`hasBoardFilters`。
2. `renderer/lib/view-persistence.ts`：`readBoardFilters` / `writeBoardFilters`（新 key，舊版沒有存過，不需 migration）。
3. `renderer/components/board-columns.tsx`：頂列以兩個 `GithubFilterMenu` 取代 `ProjectFilter`，
   `visible()` 與 master 底下卡清單改用 `board-filter.ts`。`projectLabel` 由 lib re-export，既有 import 不變。
4. `test/board-filter.test.mjs`：OR／AND、無標籤、master 規則、選項彙整。

## 驗證

- `npx tsc --noEmit -p renderer/tsconfig.json`、`npm test`、`npm run build:web`、`npm run test:e2e`
- 在 live Web UI（throwaway `--store-path`）實際勾選確認三欄同時套用。
