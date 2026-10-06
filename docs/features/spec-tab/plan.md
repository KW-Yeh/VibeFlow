# 決策 tab 改顯示 spec.md — Plan

**Spec:** [spec.md](spec.md)

## 修改

| 檔案 | 改動 |
|---|---|
| `packages/core/src/specs.ts`（新） | `readWorktreeSpecs`（worktree，用 `collectDiffEntries`）、`readBranchSpecs`（`refs/heads/<branch>` + `git show`） |
| `packages/core/src/git.ts` | export `resolveBaseRef`、`collectDiffEntries` 給 specs.ts 重用 |
| `packages/core/src/decisions.ts` | 只留舊檔清理：`decisionsKey`、`decisionsPath`、`deleteDecisions` |
| `packages/core/src/launch.ts` | 移除決策書 prompt |
| `packages/core/src/service.ts` | `task:getDecisions` → `task:getSpecs` |
| `packages/core/src/client.ts`、`renderer/lib/api.ts`、`renderer/lib/types.ts` | `getSpecs` / `TaskSpec` |
| `renderer/components/task-workspace-panel.tsx` | `useTaskSpecs`（panel 層輪詢）+ `SpecContent`；tab 依 spec 有無過濾 |

## 取捨

- 不用 `getWorktreeDiffEntries`：它截在 80 個檔案，大改動的卡會漏掉 spec。
- 完成的卡優先用 `outcome.files`：merge 之後 `base...branch` 是空的。
- 只比對檔名 `spec.md`，不綁 `docs/features/`：feature-spec-plan 允許專案沿用自己的文件位置。

## 驗證

- `node scripts/run-tests.mjs ./test/specs.test.mjs`：base 既有 spec 不算、未 commit/已 commit、刪除、完成後從 branch 讀、merge 後靠 outcome 清單、branch 不存在。
- `npx tsc --noEmit -p tsconfig.json`、`npx tsc --noEmit -p renderer/tsconfig.json`、`npm test`、`npm run build:web`、`npm run test:e2e`。
- Web UI 實際操作：見總結。
