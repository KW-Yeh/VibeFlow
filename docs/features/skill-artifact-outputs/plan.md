# Plan：內建 skill 產出預設寫進 Artifacts

- 狀態：已確認
- 對應 Spec：[spec.md](./spec.md)
- Spec 確認依據：2026-10-20 版，使用者以「送出」放行
- 更新日期：2026-10-20
- 確認紀錄：2026-10-20 使用者要求直接往下做，不再另外確認 Plan

## 現有程式碼調查

| 檔案或專案 | 現有行為、可重用模式與調查依據 |
| --- | --- |
| `packages/core/src/launch.ts:112-113` | `boardEnvPrefix` export `VIBEFLOW_ARTIFACTS_DIR` / `VIBEFLOW_SCRATCH_DIR`；artifactsDir 不明時兩者都不 export |
| `packages/core/src/artifacts.ts` | `listArtifacts` 走到 `MAX_DEPTH = 3` 層，一層子資料夾（`visual-parity/`、`pr/`）會出現在 Artifacts 分頁；`scratch/` 底下標成 scratch 並收合 |
| `packages/core/builtin-skills/visual-parity/scripts/parity.py` | `--out` 預設 `parity-diff.md` / `parity-responsive.md` / `parity-flow.md`；`--video` 先寫 webm 再轉 mp4；錄影暫存目錄用 `tempfile.mkdtemp`，跑完刪掉；`screenshot` 直接用 `step["path"]`；檔案開頭 import playwright，失敗就 `sys.exit` |
| `packages/core/builtin-skills/pr/SKILL.md` | 通用版 pr，沒有任何截圖或影片的指示 |
| `scripts/build-npm.mjs:68` | `cpSync` 整個 `builtin-skills` 目錄到 `dist-npm/dist/builtin-skills`，不需要改 |
| `packages/core/src/library-builtins.ts` | 內建內容 hash 變了：沒改過的 Library 副本自動更新，改過的顯示「有新版」，不需要改 |
| `.github/workflows/release.yml` | `npm test` 在 ubuntu / macOS / Windows 跑；Windows 不一定有 `python3`，只有 `python` |

## 方案與取捨

採 Spec 的方案 B。`parity.py` 新增兩個純函式：

- `output_path(path)`：絕對路徑原樣回傳；`VIBEFLOW_ARTIFACTS_DIR` 為空或不存在時原樣回傳（行為不變）；否則回傳 `<artifacts>/visual-parity/<path>` 並建立上層目錄，建立失敗就印提示並回傳原 path。
- `scratch_dir()`：`VIBEFLOW_SCRATCH_DIR` 有值且可建立時回傳它，否則 `None`（`tempfile.mkdtemp(dir=None)` = 系統 temp）。

`main()` parse 完後統一套用到 `--out`、`--video`；`run_flow` 在 `screenshot` 動作套用到 `step["path"]`；錄影暫存目錄改成 `mkdtemp(dir=scratch_dir())`。selftest 傳絕對路徑，不受影響。

測試：新增 `test/parity-paths.test.mjs`，用 `spawnSync` 跑 Python，在 `sys.modules` 塞假的 `playwright.sync_api` 再載入 `parity.py`，只呼叫兩個純函式——CI 不需要裝 Playwright。依序試 `python3`、`python`，兩者都沒有就 `t.skip` 並註明原因（環境依賴，不是遮掉失敗）。

## 預計修改

| 檔案 | 修改內容 | 對應驗收條件 |
| --- | --- | --- |
| `packages/core/builtin-skills/visual-parity/scripts/parity.py` | `output_path` / `scratch_dir`，套用到 out、video、screenshot、錄影暫存目錄 | AC-1、AC-2、AC-3 |
| `test/parity-paths.test.mjs`（新增） | 路徑解析：有 env、無 env、空字串、絕對路徑、目錄建立失敗、scratch | AC-4 |
| `test/README.md` | 補 suite 說明 | AC-4 |
| `packages/core/builtin-skills/visual-parity/SKILL.md` | 「輸出位置」一節、steps / map JSON 與中間檔的位置、回歸測試例外 | AC-5 |
| `packages/core/builtin-skills/pr/SKILL.md` | 「Screenshots and recordings」一節 | AC-5 |
| `docs/README.md` | 列出本功能文件 | 文件規則 |

## 實作順序

1. 文件：spec.md、plan.md、docs/README.md → commit。
2. `parity.py` + 測試 → `node scripts/run-tests.mjs ./test/parity-paths.test.mjs`、`parity.py selftest` → commit。
3. 兩份 SKILL.md → commit。
4. 驗收：AC-1 / AC-2 / AC-3 手動跑、`npm test`、`npx tsc`、`npm run build:npm` 比對 → 結果寫進本檔 → commit。

## 風險與依賴

- 在 VibeFlow 內用同一個相對路徑去讀報告會找不到 → SKILL.md 明寫「用 stdout 印出的路徑」。
- 使用者若早已在 VibeFlow 卡片裡依賴 cwd 下的報告檔（例如外部腳本）→ 改傳絕對路徑即可回到舊行為，寫進 SKILL.md。
- 已修改過內建 skill 的使用者不會自動拿到新版，只會看到「有新版」→ 沿用既有 Library 規則，不另處理。

## 驗證計畫

| 檢查 | 命令或操作 | 對應驗收條件 |
| --- | --- | --- |
| 路徑解析測試 | `node scripts/run-tests.mjs ./test/parity-paths.test.mjs` | AC-4 |
| parity 自測 | `python3 packages/core/builtin-skills/visual-parity/scripts/parity.py selftest` | AC-4 |
| 有 env 的實跑 | 在拋棄式 git repo 中設兩個 env，跑 `diff` 與 `flow --video x.mp4`（含 screenshot），檢查 Artifacts 內容、scratch 沒有殘留、`git status --porcelain` 為空 | AC-1 |
| 絕對路徑 | 同上加 `--out /abs/...` | AC-3 |
| 無 env 的實跑 | unset 後同指令，輸出在 cwd、stdout 與舊版一致 | AC-2 |
| Typecheck | `npx tsc --noEmit -p tsconfig.json` | AC-7 |
| 全部測試 | `npm test` | AC-7 |
| 打包 | `npm run build:npm` 後 `diff -r packages/core/builtin-skills dist-npm/dist/builtin-skills` | AC-6 |

本次不動 renderer、handler table、transport，不跑 build:web / e2e；沒有 UI 改動，不做像素比對。

## 待確認事項

- 無

## 實作與驗證紀錄

（實作後填寫）
