# Library 內建 skill Implementation Plan

## 2026-10-21：預設輸出至 Artifact 的修正流程

本節追蹤本次修正；原實作計畫保留為歷史。本次 Spec 與以下實作 Plan 已於 2026-10-21 確認。
環境未提供 `TaskCreate`／`TaskUpdate`／`update_plan`，以此表替代；最多一項 `in_progress`，驗證通過才標記 `completed`，每項完成各自 commit。發現新工作時先新增列。2026-10-21 將原 O2 拆成「完成規劃」與「確認規劃」，避免文件已寫好卻把尚未取得的確認標成完成。

| ID | 步驟 | 狀態 | 完成依據 |
| --- | --- | --- | --- |
| O1 | 調查兩個 built-in skill、輸出路徑及打包流程，更新既有 Spec | completed | 已讀取兩個 SKILL.md、parity.py、build-npm.mjs 與既有測試；8 項驗收條件、7 項步驟及文件連結檢查通過，git diff --check 通過 |
| O2 | 記錄 Spec 確認，完成方案比較並更新既有 Plan | completed | Spec 確認、方案比較、8 項驗收對應、8 項步驟、文件連結及驗證命令檢查通過；git diff --check 通過 |
| O2b | 確認本次實作 Plan | completed | 2026-10-21 使用者回覆「yes」確認上一輪提供的 Plan；確認紀錄與 git diff --check 通過 |
| O3 | 修正 visual-parity 輸出指示與可執行範例 | completed | 10 次環境矩陣執行通過（5 情境各重跑兩次）、JSON 絕對路徑及空白路徑通過；library-builtins 21/21；diff check 通過；script 未改 |
| O4 | 修正通用 pr 的證據來源、儲存與 GitHub 網頁上傳規則 | completed | Artifact 取檔、新截圖、scratch、缺變數 fallback、網頁上傳、影片 comment 及禁止 commit 規則檢查通過；library-builtins 21/21；diff check 通過 |
| O5 | 驗收有／無環境變數、影片及適用的像素比對，完成 DoD | completed | core typecheck、npm test 454/454、Python selftest、7 項 runtime 檢查皆通過；錄影中間檔觀測位於 scratch 並已清除；前後 git status 皆乾淨；host 已 shutdown |
| O6 | 驗證 dist-npm 與 tarball 內容，暫存安裝並執行 doctor | completed | build:npm、npm pack 成功；3 個 skill 檔案在 source／dist-npm／tarball bytes 一致且未夾帶證據；暫存 prefix 安裝成功，doctor 7/7 全正常 |
| O7 | 整理結果、建立 Draft PR | completed | Draft PR #115 已建立並 self-assign，base main；變更與測試結果已寫入 PR，確認 draft 與 head branch 正確 |
| O8 | 在獨立 comment 上傳驗收影片 | in_progress | 新增：影片選擇器已操作，但 Chrome 擴充功能未開啟 Allow access to file URLs；等待使用者設定後重試，comment 未送出，不標完成 |

實作與驗證結果逐項記錄於本節；以下原計畫的預期結果不代表本次驗證已通過。

### 本次 Plan 狀態與依據

- 狀態：已確認。
- 對應 Spec：[2026-10-21 輸出位置修正](spec.md#2026-10-21-修正default-built-in-skill-outputs-to-vibeflow_artifacts_dir)。
- Spec 確認依據：2026-10-21 使用者回覆「yes，可以使用 update_plan 製作待辦清單」。
- Plan 確認紀錄：2026-10-21 使用者回覆「yes」，確認上一輪提供的 Plan，授權依此實作；每階段 commit 與最終 Draft PR 按原任務指示執行。
- 本次只改 skill 指示與既有文件，不修改 Python、core、CLI、renderer、打包程式或 npm 依賴。

### 現有程式碼調查

| 檔案 | 實際行為與可重用之處 |
| --- | --- |
| `packages/core/builtin-skills/visual-parity/SKILL.md` | diff／responsive／flow 範例皆輸出 cwd 相對路徑，沒有目錄初始化；結尾建議將新 flow JSON 存入 repo，需改成 Artifact 預設，保留使用者明確選擇版本控管回歸測試的能力 |
| `packages/core/builtin-skills/visual-parity/scripts/parity.py` | `--out` 有既有預設值；`--steps` 是輸入路徑；screenshot 直接讀 JSON path，JSON 不會展開 shell 變數；錄影使用 `tempfile.mkdtemp`，可透過該 process 的 `TMPDIR` 指定暫存 root；已有 ffmpeg／webm fallback，無須修改 |
| `packages/core/builtin-skills/pr/SKILL.md` | 已有 gh Draft PR 流程，尚無截圖／影片規則；只補證據來源、儲存位置及 GitHub 網頁上傳，不改分支與 push 規則 |
| `test/library-builtins.test.mjs` | 既有檢查涵蓋 skill frontmatter、通用性、LF、script 存在及 pr 分支規則；修改後跑原測試，不增加只比對新文句的測試 |
| `scripts/build-npm.mjs` | 遞迴複製出貨來源到 `dist-npm/dist/builtin-skills`，只排除 `__pycache__`；既有流程能帶入新版 Markdown，無須改程式 |
| `docs/features/prompt-free-artifacts/spec.md` | Artifact／scratch 由 runtime 準備，Library 不投遞；本次不擴張 launch 或 Library 行為 |

### 方案與取捨

| 方案 | 優點 | 相容性與限制 | 決定 |
| --- | --- | --- | --- |
| 只改 SKILL.md：初始化目錄、傳入絕對輸出路徑，單次 process 設定 TMPDIR | 直接涵蓋遵循 skill 的 agent；steps、像素圖、獨立 Playwright 腳本及 pr 證據都能使用相同規則；script 介面不變 | 未遵循 skill、直接呼叫 script 的使用者仍沿用原路徑；指示需要明確覆蓋每個範例，且須實跑驗證 | 採用 |
| script 自己讀 env 決定預設 `--out` 與暫存位置 | 可讓省略 `--out` 的直接呼叫自動選 Artifact | 只改 argparse 預設值仍無法涵蓋明確相對 `--out`／`--video`、JSON screenshot 及 agent 建立的 steps；若全部重定向，會改既有明確路徑語意，需擴大測試與介面規格 | 本次不採用 |

問題發生在 agent 選擇輸出位置。以 skill 統一這個選擇就能滿足本次範圍；不為強制所有 script 呼叫改動路徑契約。若實作發現指示方案不能通過已確認驗收，將揭露原因並重新確認受影響方案，不直接擴張 script 行為。

### 預計修改與執行細節

| 檔案 | 修改內容 | 對應驗收 |
| --- | --- | --- |
| `packages/core/builtin-skills/visual-parity/SKILL.md` | 增加前置輸出目錄初始化與檔案分類；改寫所有 CLI、screenshot、steps、錄影與回歸重跑範例 | OUT-1、OUT-2、OUT-3、OUT-5、OUT-7 |
| `packages/core/builtin-skills/pr/SKILL.md` | 新增證據來源、截圖位置、無 env fallback、GitHub 網頁上傳與禁止 commit 規則 | OUT-4、OUT-8 |
| `docs/features/builtin-skills/spec.md`、`plan.md`、`docs/README.md` | 維護本次確認、進度、實測與打包結果 | OUT-5、OUT-6、OUT-8 |

visual-parity 的範例採用以下約定：

1. 有 Artifact root 時，先建立 `<root>/visual-parity/`，以安全的唯一目錄建立方式配置本次執行目錄，存入 `PARITY_OUT`。無 Artifact root 時用目前 cwd，維持舊範例檔名。預設不覆蓋之前的驗收證據。
2. 暫存 root 依序採用 `VIBEFLOW_SCRATCH_DIR`、`<Artifact root>/scratch`、原系統暫存目錄；在其下配置本次獨立目錄並存入 `PARITY_SCRATCH`。空值視為未設定，不把變數寫回 VIBEFLOW 的原變數。
3. 範例維持原本 Bash 語法與 Python／python3 提醒；路徑全部引用，無 env 時仍可直接執行。說明 PowerShell 使用者依同一目錄優先順序設定並傳入實際路徑，不將 Bash 語法宣稱為 PowerShell 語法。
4. diff／responsive 明確給 `--out "$PARITY_OUT/<原檔名>"`。flow 明確給同目錄的 `--steps`、`--out`、`--video`；Python process 使用 `TMPDIR="$PARITY_SCRATCH"` 前綴，讓 Playwright 錄影中間檔走既有 tempfile 機制。這個設定只作用於該次 process。
5. 提供可執行的 steps 寫入範例，以 Python JSON serializer 將實際 screenshot 絕對路徑寫入 JSON；不可將未展開的 `$PARITY_OUT` 寫成 JSON 字串。截圖、像素圖（若另行產生）、最終 webm／mp4、Markdown 報告與新 steps 都放同一證據目錄。
6. 額外 console／network log、一次性的 Playwright 腳本及其他中間檔放 scratch；使用者刻意保存的程式碼回歸測試仍可留在原 repo，不自動搬移既有檔案。不更動既有明確路徑的解讀。
7. pr 先依本次變更從 Artifact 子目錄挑選實際檔案；新截圖亦放 Artifact 下的獨立子目錄。沒有 env 時使用既有證據路徑或 agent scratchpad。截圖與影片以 GitHub 網頁上傳；有驗收影片的本任務 Draft PR 另加影片 comment，不以 repo 內檔案或本機路徑代替上傳。

### 實作順序與 commit

依追蹤表 O2 → O2b → O3 → O4 → O5 → O6 → O7 → O8 執行，完成後立即更新狀態並 commit，再開始下一項。O2b 取得確認後更新確認紀錄並 commit，才進入 O3。驗證失敗時維持該項進行中，若需額外修復工作先新增項目。實際遇到影片上傳的 Chrome 權限缺口後，將 O7 拆成已完成的 PR 建立與新增的 O8 上傳工作。

- O3：修改 visual-parity 指示，執行目錄初始化／JSON 範例的環境矩陣與既有 library-builtins 測試後 commit。
- O4：修改 pr 指示，檢查來源、fallback、上傳與禁止 commit 規則，重跑 library-builtins 測試後 commit。
- O5：跑完整測試及 runtime 驗收，保存輸出清單、影片路徑與 git status 證據；實際結果寫回本 Plan 後 commit。
- O6：打包、比對、安裝與 doctor；結果寫回 Plan，清理本次建置產物後 commit。
- O7：確認前項全數通過，按專案 pr skill 建 Draft PR；影片透過 GitHub 網頁上傳至獨立 comment。紀錄最終證據，不將影片、截圖或 tarball 納入 commit。

### 驗證計畫

| 檢查 | 命令或操作、通過標準 | 對應驗收 |
| --- | --- | --- |
| 目錄範例矩陣 | 將即將修改的 SKILL.md 範例原樣執行於隔離目錄：兩 env 都有、兩者 unset、兩者空值、各只設一個；涵蓋空白路徑、目錄不存在與連續重跑。檢查實際路徑、有效 JSON、證據不互相覆寫及零意外 repo 輸出 | OUT-1、OUT-2、OUT-3 |
| 既有 skill 測試 | `node scripts/run-tests.mjs ./test/library-builtins.test.mjs`；原測試通過，保留 LF 與通用性 | OUT-4、OUT-5 |
| Python 自檢 | `python3 packages/core/builtin-skills/visual-parity/scripts/parity.py selftest`；不修改 script，仍驗證原工具可用 | OUT-3、OUT-5 |
| Core typecheck 與完整測試 | `npx tsc --noEmit -p tsconfig.json`、`npm test`；全部通過，skip 不視為已驗收 | 工程品質 |
| 真實瀏覽器驗收 | 以拋棄式 `--store-path` 啟動 VibeFlow host，使用保留 token 的 URL；按新版範例跑 diff、responsive 及含 screenshot、點擊、assertion、`--video` 的 flow。比對前後 git status，檢查 scratch 中間檔及最終影片可讀 | OUT-1、OUT-7 |
| 無 env 相容性 | 使用同一受測頁面，在隔離 cwd unset 兩變數，跑原版 `git show 05e7917:packages/core/builtin-skills/visual-parity/scripts/parity.py` 的暫存副本與目前 script 的同等命令；報告／影片／screenshot 仍依原指定相對路徑落在 cwd | OUT-2、OUT-3 |
| ffmpeg fallback | 針對單一 Python process 限制 ffmpeg 發現能力，仍能啟動瀏覽器並完成錄影；核對實際 webm、報告連結與可播放性，保留 Python／Node／瀏覽器必要執行路徑 | OUT-3 |
| 像素比對適用性 | 本方案沒有 renderer 或外觀修改，無新舊 UI 像素驗收項；保存驗收截圖。若後續新增 UI 外觀修改，先補工作項目，對相同 viewport 做像素級比對；不以 computed-style 報告替代 | OUT-7 |
| Web 建置與 E2E 適用性 | 本次無 renderer、transport、handler table 變更，因此不要求額外 UI flow E2E；npm 打包需要 Web export，缺少時先 `npm run build:web -- --webpack`。若實作擴及 UI flow，補兩組 typecheck、Web build 與 `npm run test:e2e` | 專案 DoD |
| npm 出貨內容 | `npm run build:npm`，將 `npm pack ./dist-npm --pack-destination <scratch>` 的 tarball 解到暫存目錄；逐檔比對兩個 SKILL.md 與 parity.py 在來源、dist-npm、tarball 的 bytes，確認新版標記且無證據檔混入 | OUT-6 |
| 暫存安裝 | `npm install --prefix <scratch/install> <tarball>`，以該 prefix 的 `node_modules/.bin/vibeflow` 搭配拋棄式 `--store-path` 執行 `doctor`；保留結果及任何環境限制，不修改專案依賴、不 publish | OUT-6 |
| PR 與最終清理 | 檢查 branch diff 與乾淨 git status，移除本次生成的 `app`／`renderer/.next`；依來源挑選影片上傳 GitHub comment，確認取得 GitHub 影片連結 | OUT-4、OUT-8 |

### 風險、依賴與現況

- 前置檢查已確認 Node v24.18.0、Python 3.13.7、Python Playwright、ffmpeg、node_modules 與既有 Web build 存在；Chromium cache 存在不代表 launch 已成功，仍須 runtime 驗收。
- `TMPDIR` 對 Python 標準 tempfile 生效；Playwright 自身可能另有內部暫存，此方案規範並驗證本工具可控制的錄影與 agent 工作檔，不宣稱能控制瀏覽器所有內部暫存。
- Bash 與 PowerShell 的引用語法不同；文件需明示，不新增 shell 依賴或假設 JSON 能展開環境變數。
- 證據上傳可能受 GitHub 登入或瀏覽器工具能力限制；若無法完成，O7 保持未完成並揭露具體阻礙，不能將本機影片路徑當作已上傳。
- 暫存 prefix 安裝會下載已存在的 runtime 依賴，符合打包 DoD；不新增專案 npm 依賴、不執行 publish。

### 待確認事項與實作紀錄

- 已確認「只改兩個 SKILL.md，保留 parity.py 路徑語意」的 Plan，依上方追蹤表執行。
- 已完成：Spec 確認、程式碼與環境前置調查、方案比較及上述驗證規劃。
- O3 實測：直接從 SKILL.md 擷取 Bash 初始化與 JSON 產生範例，於隔離目錄執行。兩 env 都有、只有 Artifact、只有 scratch、兩者 unset、兩者空值各跑兩次；10/10 通過，涵蓋不存在的目錄、空白路徑、證據重跑隔離與 JSON screenshot 絕對路徑。紀錄：`$VIBEFLOW_ARTIFACTS_DIR/scratch/builtin-output-validation/directory-matrix.json`。
- O3 回歸：`node scripts/run-tests.mjs ./test/library-builtins.test.mjs`，21 pass、0 fail、0 skip；`git diff --check` 通過。
- O4 實測：逐項核對證據來源、截圖儲存、scratch／unset／空值 fallback、明確路徑優先、GitHub 網頁上傳、影片獨立 comment、無影片略過與禁止 commit 規則；既有 library-builtins 再跑 21 pass、0 fail、0 skip；diff check 通過。
- O5：`npx tsc --noEmit -p tsconfig.json` 通過；`npm test` 454 pass、0 fail、0 skip；Python selftest 通過（另以 scratch TMPDIR 執行亦通過）。完整測試紀錄位於 `scratch/builtin-output-validation/npm-test.log`。
- O5 runtime：以獨立 store 與假 agent CLI 啟動真實 VibeFlow host，保留 token URL；diff、responsive（375/768/1440）、8-step flow（開設定、assertion、兩張截圖、MP4）通過，console／network 錯誤為 0。觀測到錄影 `parity-video-*` 位於 `PARITY_SCRATCH`，執行後已清除。以 ffprobe 確認 MP4 為 H.264；缺 ffmpeg 時仍產生可讀 WebM，報告回報實際路徑。
- O5 相容性：以 `git show 05e7917:.../parity.py` 取得原工具，確認其 bytes 與目前工具相同；在 unset 兩個 VibeFlow env 的隔離 cwd 分別執行原版與現版 flow＋video，5 個輸出檔名一致、Markdown 報告 bytes 相同，維持相對路徑行為。
- O5 證據：`$VIBEFLOW_ARTIFACTS_DIR/visual-parity/run-z6ks6X/` 保存 reports、steps.json、settings.png、parity-flow.png、parity-flow.mp4 及 without-ffmpeg/ 的最終 WebM；驗證摘要在 `scratch/builtin-output-validation/runtime-results.json`。實際執行前後 `git status --porcelain` 皆空；拋棄式 host 已用同 store 的 CLI shutdown 停止。未改 renderer／UI 外觀，像素比對不適用。
- O6：`npm run build:npm`、`npm pack ./dist-npm --pack-destination <scratch>` 成功。`pr/SKILL.md`、`visual-parity/SKILL.md`、`visual-parity/scripts/parity.py` 在來源、dist-npm、實際 tarball bytes 完全一致；出貨 skill 未夾帶 png、mp4、webm 或 log。
- O6 安裝：將 tarball 安裝至 Artifact scratch 下的獨立 npm prefix，使用安裝後 CLI 與拋棄式 store 執行 doctor，exit 0；Node、Git、tmux、node-pty、agent CLI、Web UI、資料目錄 7 項全正常。結果保存在 `scratch/builtin-output-validation/packaging-results.json`、`doctor.log`。
- O7：[Draft PR #115](https://github.com/KW-Yeh/VibeFlow/pull/115) 已建立、self-assign；base `main`，head `fix/default-built-in-skill-outputs-to`。標題、內容與實測結果已完成，未將證據檔 commit。
- O8 未完成：已在 GitHub 網頁準備獨立影片 comment 並透過 file chooser 選取 `visual-parity/run-z6ks6X/parity-flow.mp4`，但 Chrome ChatGPT 擴充功能未允許 file URL，`setFiles` 被拒絕。Browser 的 `chrome-file-upload-troubleshooting` 要求使用者開啟 `chrome://extensions` → ChatGPT → Details → Allow access to file URLs；未自行修改這項存取權限，未送出無附件 comment。影片仍在 Artifact，畫面已保存為同目錄 `pr-upload-pending.jpg`，待使用者設定後重試。說明：[Chrome extension file uploads](https://developers.openai.com/codex/app/chrome-extension#upload-files)。

---

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** VibeFlow 隨 npm 出貨內建 skill（`visual-parity`、通用版 `pr`），自動放進每個用戶的 Library，可編輯、停用、刪除、還原，未修改的隨版本自動更新。

**Architecture:** 出貨來源 `packages/core/builtin-skills/`，npm 打包進 `dist/builtin-skills/`，`PlatformServices.builtinSkillsDir()` 依 `sourceRoot` / `cliEntry` 推得位置。`library.ts` 的 index 記錄多兩個欄位（`builtinHash`、`builtinDeleted`），新檔 `library-builtins.ts` 負責同步／還原／已移除清單；host 啟動時同步一次。面板讀 `LibraryEntry.builtin` 顯示狀態。

**Tech Stack:** Node（`--experimental-strip-types`，只能用可擦除 TS）、`node:test`、Next.js 16 + React 19 + Tailwind v4（renderer）、esbuild（npm 打包）。

**Spec:** [spec.md](spec.md)

## Global Constraints

- `packages/` 只能寫可擦除 TypeScript：不用 enum、namespace、constructor parameter properties（`test/core-boundary` 檢查）。
- 新 handler 一律驗證參數（`obj`、`str`），只收 skill 名稱，不收路徑。
- 每個新 handler 依序加到 `service.ts` → `client.ts` → `renderer/lib/api.ts`（bridge 不存在時回 `null` / `[]`）→ `packages/core/IPC_API_MAP.md`。
- `index.json` 新欄位全部可省略，舊 index 免遷移。
- 同步失敗只記 log，不阻擋 host 啟動。
- renderer 用 shadcn token class，不用原始顏色；圓角只用 `rounded-xs/sm/md/lg/xl/full`；手寫 `<button>` 要有 `focus-visible:ring-[3px]`。
- commit 訊息英文、conventional-commit 前綴，結尾 `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`。
- 不新增 npm 依賴。

## Review Focus

1. **刪除後又自建同名項目**：用戶刪掉內建 `pr` 後自己 `新建` 一個叫 `pr` 的 skill → 已移除清單不應再列出 `pr`（否則按「還原」會覆蓋用戶的檔案）。測試在 Task 2。
2. **停用狀態跨升級**：用戶停用了未修改的內建 skill，升級後自動更新 → 必須維持停用。測試在 Task 2。
3. **Python 執行留下的 `__pycache__`**：在 Library 版的 visual-parity 目錄裡跑過 script 後，不應被判成「已修改」。測試在 Task 1。
4. **出貨目錄不存在**（如舊版、測試、`task` CLI 的 platform）→ 列表、同步、刪除都正常，還原回清楚的錯誤。測試在 Task 2、Task 3。
5. **非法名稱還原**：`library:restoreBuiltin` 收到 `../x` 或不存在的名稱 → 回錯，不碰檔案系統。測試在 Task 2、Task 3。

---

### Task 1: index 欄位、內容 hash、列表狀態、刪除留 tombstone

**Files:**
- Modify: `packages/core/src/library.ts`
- Test: `test/library.test.mjs`

**Interfaces:**
- Produces（`library.ts` 新增或改為 export）：
  - `export interface IndexRecord { sourcePath?: string; importedAt?: number; enabled?: boolean; description?: string; builtinHash?: string; builtinDeleted?: boolean }`
  - `export function readIndex(root: string): LibraryIndex`（原為私有，改 export）
  - `export function writeIndex(root: string, index: LibraryIndex): void`（同上）
  - `export function annotate(root: string, key: string, patch: Partial<IndexRecord>): void`（同上）
  - `export function hashSkillDir(dir: string): string`
  - `export function markBuiltinDeleted(root: string, key: string): void`
  - `LibraryEntry.builtin?: { modified: boolean; updateAvailable: boolean }`
  - `listLibrary(root: string, builtinDir?: string | null): LibraryEntry[]`（新增可省略參數）

- [ ] **Step 1: 寫失敗測試**

在 `test/library.test.mjs` 的 import 加入 `annotate`、`hashSkillDir`，檔尾加：

```js
// --- built-in status ---

test('hashSkillDir — stable, content-sensitive, ignores __pycache__', async () => {
  const root = await tmpDir()
  const dir = await makeSkillDir(root)
  const first = hashSkillDir(dir)
  assert.equal(hashSkillDir(dir), first)

  await fs.mkdir(path.join(dir, 'scripts', '__pycache__'), { recursive: true })
  await fs.writeFile(path.join(dir, 'scripts', '__pycache__', 'x.pyc'), 'bytecode')
  assert.equal(hashSkillDir(dir), first, '__pycache__ must not count as a modification')

  await fs.writeFile(path.join(dir, 'scripts', 'run.py'), 'print(1)')
  assert.notEqual(hashSkillDir(dir), first)
})

test('listLibrary — reports modified / updateAvailable only for built-in skills', async () => {
  const root = await tmpDir()
  const shippedRoot = await tmpDir('vf-builtin-')
  const shipped = await makeSkillDir(shippedRoot)
  const lib = ensureLibrary(root)
  await fs.cp(shipped, path.join(lib.skills, 'probe'), { recursive: true })
  annotate(root, 'skill/probe', { builtinHash: hashSkillDir(shipped), enabled: true })
  await makeSkillDir(lib.skills, 'mine')

  let [mine, probe] = listLibrary(root, shippedRoot)
  assert.equal(mine.builtin, undefined)
  assert.deepEqual(probe.builtin, { modified: false, updateAvailable: false })

  await fs.appendFile(path.join(lib.skills, 'probe', 'SKILL.md'), 'user edit\n')
  ;[, probe] = listLibrary(root, shippedRoot)
  assert.deepEqual(probe.builtin, { modified: true, updateAvailable: false })

  await fs.appendFile(path.join(shipped, 'SKILL.md'), 'new release\n')
  ;[, probe] = listLibrary(root, shippedRoot)
  assert.deepEqual(probe.builtin, { modified: true, updateAvailable: true })

  ;[, probe] = listLibrary(root)
  assert.deepEqual(probe.builtin, { modified: true, updateAvailable: false }, 'no shipped dir, no update')
})

test('deleteEntry — a built-in skill leaves a tombstone, a user entry leaves nothing', async () => {
  const root = await tmpDir()
  const lib = ensureLibrary(root)
  await makeSkillDir(lib.skills, 'probe')
  await makeSkillDir(lib.skills, 'mine')
  annotate(root, 'skill/probe', { builtinHash: 'abc', enabled: true })
  annotate(root, 'skill/mine', { enabled: true })

  deleteEntry(root, 'skill', 'probe')
  deleteEntry(root, 'skill', 'mine')

  const index = JSON.parse(await fs.readFile(path.join(root, 'index.json'), 'utf8'))
  assert.deepEqual(index.entries['skill/probe'], { builtinDeleted: true })
  assert.equal(index.entries['skill/mine'], undefined)
  assert.equal(fsSync.existsSync(path.join(lib.skills, 'probe')), false)
})
```

- [ ] **Step 2: 跑測試確認失敗**

Run: `node scripts/run-tests.mjs ./test/library.test.mjs`
Expected: FAIL — `annotate` / `hashSkillDir` 不是 export（SyntaxError: does not provide an export named …）。

- [ ] **Step 3: 實作**

`packages/core/src/library.ts`：

1. 檔頭 import 加 `import { createHash } from 'crypto'`。
2. 把 `LibraryIndex` 的 record 型別抽成 export：

```ts
/** Provenance + enablement. Disk decides what exists; this only annotates it. */
export interface IndexRecord {
  sourcePath?: string
  importedAt?: number
  enabled?: boolean
  description?: string
  /** Hash of the built-in version VibeFlow last installed. Present = built-in. */
  builtinHash?: string
  /** The user deleted this built-in; sync must not bring it back. */
  builtinDeleted?: boolean
}

export interface LibraryIndex {
  version: 1
  entries: Record<string, IndexRecord>
}
```

3. `LibraryEntry` 加欄位：

```ts
  /** Set for skills VibeFlow ships; see syncBuiltinSkills. */
  builtin?: {
    /** The files no longer match what VibeFlow installed. */
    modified: boolean
    /** Modified, and the shipped version moved on since — "restore" would update it. */
    updateAvailable: boolean
  }
```

4. `readIndex`、`writeIndex`、`annotate` 前面加 `export`；`annotate` 的 `patch` 型別改成 `Partial<IndexRecord>`。
5. 在 `listLibrary` 上方加：

```ts
/** Files a runtime drops into a skill that say nothing about its content. */
const HASH_IGNORED = new Set(['__pycache__', '.DS_Store'])

/**
 * Content hash of a skill directory: every file's relative path and bytes, in
 * path order. Line endings are not normalized — both sides of a comparison
 * are always on the same machine.
 */
export function hashSkillDir(dir: string): string {
  const files: string[] = []
  const walk = (rel: string) => {
    for (const dirent of fs.readdirSync(path.join(dir, rel), { withFileTypes: true })) {
      if (HASH_IGNORED.has(dirent.name)) continue
      const child = rel ? `${rel}/${dirent.name}` : dirent.name
      if (fs.statSync(path.join(dir, child)).isDirectory()) walk(child)
      else files.push(child)
    }
  }
  walk('')
  const hash = createHash('sha256')
  for (const rel of files.sort()) {
    hash.update(rel).update('\0').update(fs.readFileSync(path.join(dir, rel))).update('\0')
  }
  return hash.digest('hex')
}

function builtinStatus(
  full: string,
  name: string,
  recorded: string,
  builtinDir: string | null | undefined
): NonNullable<LibraryEntry['builtin']> {
  const modified = hashSkillDir(full) !== recorded
  let updateAvailable = false
  if (modified && builtinDir) {
    const shipped = path.join(builtinDir, name)
    if (fs.existsSync(path.join(shipped, 'SKILL.md'))) {
      updateAvailable = hashSkillDir(shipped) !== recorded
    }
  }
  return { modified, updateAvailable }
}
```

6. `listLibrary` 簽名改 `export function listLibrary(root: string, builtinDir?: string | null): LibraryEntry[]`，`entries.push({...})` 內 `enabled` 之後加：

```ts
        builtin:
          wantsDirectory && record.builtinHash
            ? builtinStatus(full, name, record.builtinHash, builtinDir)
            : undefined,
```

7. 新增並改寫 `deleteEntry`：

```ts
/** Forget a built-in's provenance but remember the user removed it. */
export function markBuiltinDeleted(root: string, key: string): void {
  const index = readIndex(root)
  index.entries[key] = { builtinDeleted: true }
  writeIndex(root, index)
}

export function deleteEntry(root: string, kind: LibraryKind, name: string): void {
  fs.rmSync(entryPath(root, kind, name), { recursive: true, force: true })
  const key = entryKey(kind, name)
  const record = readIndex(root).entries[key]
  if (record?.builtinHash || record?.builtinDeleted) {
    markBuiltinDeleted(root, key)
    return
  }
  const index = readIndex(root)
  delete index.entries[key]
  writeIndex(root, index)
}
```

- [ ] **Step 4: 跑測試確認通過**

Run: `node scripts/run-tests.mjs ./test/library.test.mjs`
Expected: 全部 PASS（含既有案例）。

- [ ] **Step 5: 型別檢查並 commit**

```bash
npx tsc --noEmit -p tsconfig.json
git add packages/core/src/library.ts test/library.test.mjs
git commit -m "feat(library): track built-in provenance and report modified skills"
```

---

### Task 2: 同步、還原、已移除清單（`library-builtins.ts`）

**Files:**
- Create: `packages/core/src/library-builtins.ts`
- Test: `test/library-builtins.test.mjs`

**Interfaces:**
- Consumes（Task 1）：`readIndex`、`writeIndex`、`annotate`、`hashSkillDir`、`markBuiltinDeleted`、`listLibrary(root, builtinDir)`、`IndexRecord`；既有 `ensureLibrary`、`entryKey`、`entryPath`、`safeLibraryName`、`skillNamesIn`、`libraryRoot`。
- Produces：
  - `export function builtinSkillsDir(): string | null`
  - `export function syncBuiltinSkills(root: string, builtinDir: string | null): { installed: string[]; updated: string[] }`
  - `export function restoreBuiltinSkill(root: string, builtinDir: string | null, name: string): LibraryEntry`
  - `export function removedBuiltinSkills(root: string, builtinDir: string | null): string[]`
  - `export async function syncBuiltinsAtStartup(): Promise<void>`

- [ ] **Step 1: 寫失敗測試**

建立 `test/library-builtins.test.mjs`：

```js
import test from 'node:test'
import assert from 'node:assert/strict'
import os from 'node:os'
import path from 'node:path'
import fs from 'node:fs/promises'
import fsSync from 'node:fs'
import {
  annotate,
  createEntry,
  deleteEntry,
  ensureLibrary,
  hashSkillDir,
  listLibrary,
  setEntryEnabled,
  updateEntry,
} from '../packages/core/src/library.ts'
import {
  removedBuiltinSkills,
  restoreBuiltinSkill,
  syncBuiltinSkills,
} from '../packages/core/src/library-builtins.ts'

const skillMd = (name, extra = '') => `---\nname: ${name}\ndescription: ${name} skill\n---\n${extra}`

async function setup(t) {
  const base = await fs.mkdtemp(path.join(os.tmpdir(), 'vf-builtins-'))
  t.after(() => fs.rm(base, { recursive: true, force: true }))
  const root = path.join(base, 'library')
  const shipped = path.join(base, 'builtin-skills')
  for (const name of ['probe', 'other']) {
    await fs.mkdir(path.join(shipped, name, 'scripts'), { recursive: true })
    await fs.writeFile(path.join(shipped, name, 'SKILL.md'), skillMd(name))
    await fs.writeFile(path.join(shipped, name, 'scripts', 'run.py'), 'print(1)\n')
  }
  return { root, shipped }
}

const read = (root, name) => fsSync.readFileSync(path.join(root, 'skills', name, 'SKILL.md'), 'utf8')
const index = (root) => JSON.parse(fsSync.readFileSync(path.join(root, 'index.json'), 'utf8'))
const release = (shipped, name, text) =>
  fs.writeFile(path.join(shipped, name, 'SKILL.md'), skillMd(name, text))

test('first sync installs every shipped skill, with its files, enabled', async (t) => {
  const { root, shipped } = await setup(t)
  assert.deepEqual(syncBuiltinSkills(root, shipped), { installed: ['other', 'probe'], updated: [] })
  assert.ok(fsSync.existsSync(path.join(root, 'skills', 'probe', 'scripts', 'run.py')))
  const probe = listLibrary(root, shipped).find((e) => e.name === 'probe')
  assert.equal(probe.enabled, true)
  assert.deepEqual(probe.builtin, { modified: false, updateAvailable: false })
  assert.deepEqual(syncBuiltinSkills(root, shipped), { installed: [], updated: [] }, 'idempotent')
})

test('an unmodified built-in follows the shipped version and keeps its enabled flag', async (t) => {
  const { root, shipped } = await setup(t)
  syncBuiltinSkills(root, shipped)
  setEntryEnabled(root, 'skill', 'probe', false)
  await release(shipped, 'probe', 'v2\n')

  assert.deepEqual(syncBuiltinSkills(root, shipped), { installed: [], updated: ['probe'] })
  assert.match(read(root, 'probe'), /v2/)
  const probe = listLibrary(root, shipped).find((e) => e.name === 'probe')
  assert.equal(probe.enabled, false)
  assert.deepEqual(probe.builtin, { modified: false, updateAvailable: false })
})

test('a modified built-in is left alone and flagged updateAvailable', async (t) => {
  const { root, shipped } = await setup(t)
  syncBuiltinSkills(root, shipped)
  updateEntry(root, 'skill', 'probe', skillMd('probe', 'mine\n'))
  await release(shipped, 'probe', 'v2\n')

  assert.deepEqual(syncBuiltinSkills(root, shipped).updated, [])
  assert.match(read(root, 'probe'), /mine/)
  const probe = listLibrary(root, shipped).find((e) => e.name === 'probe')
  assert.deepEqual(probe.builtin, { modified: true, updateAvailable: true })
})

test('a deleted built-in stays deleted and is listed as removed', async (t) => {
  const { root, shipped } = await setup(t)
  syncBuiltinSkills(root, shipped)
  deleteEntry(root, 'skill', 'probe')
  await release(shipped, 'probe', 'v2\n')

  assert.deepEqual(syncBuiltinSkills(root, shipped), { installed: [], updated: [] })
  assert.equal(fsSync.existsSync(path.join(root, 'skills', 'probe')), false)
  assert.deepEqual(removedBuiltinSkills(root, shipped), ['probe'])
})

test('a built-in directory removed by hand counts as deleted', async (t) => {
  const { root, shipped } = await setup(t)
  syncBuiltinSkills(root, shipped)
  await fs.rm(path.join(root, 'skills', 'probe'), { recursive: true })

  syncBuiltinSkills(root, shipped)
  assert.equal(fsSync.existsSync(path.join(root, 'skills', 'probe')), false)
  assert.deepEqual(index(root).entries['skill/probe'], { builtinDeleted: true })
})

test("a user's own same-name entry is never taken over", async (t) => {
  const { root, shipped } = await setup(t)
  ensureLibrary(root)
  createEntry(root, 'skill', 'probe', skillMd('probe', 'my own\n'))

  assert.deepEqual(syncBuiltinSkills(root, shipped).installed, ['other'])
  assert.match(read(root, 'probe'), /my own/)
  assert.equal(listLibrary(root, shipped).find((e) => e.name === 'probe').builtin, undefined)
})

test('a removed built-in recreated by the user is no longer offered for restore', async (t) => {
  const { root, shipped } = await setup(t)
  syncBuiltinSkills(root, shipped)
  deleteEntry(root, 'skill', 'probe')
  createEntry(root, 'skill', 'probe', skillMd('probe', 'my own\n'))

  assert.deepEqual(removedBuiltinSkills(root, shipped), [])
  syncBuiltinSkills(root, shipped)
  assert.match(read(root, 'probe'), /my own/)
})

test('restore brings back a deleted or modified built-in, enabled', async (t) => {
  const { root, shipped } = await setup(t)
  syncBuiltinSkills(root, shipped)
  updateEntry(root, 'skill', 'probe', skillMd('probe', 'mine\n'))
  setEntryEnabled(root, 'skill', 'probe', false)
  deleteEntry(root, 'skill', 'other')

  const probe = restoreBuiltinSkill(root, shipped, 'probe')
  assert.deepEqual(probe.builtin, { modified: false, updateAvailable: false })
  assert.equal(probe.enabled, true)
  assert.doesNotMatch(read(root, 'probe'), /mine/)

  restoreBuiltinSkill(root, shipped, 'other')
  assert.deepEqual(removedBuiltinSkills(root, shipped), [])
  assert.equal(index(root).entries['skill/other'].builtinDeleted, undefined)
  assert.equal(index(root).entries['skill/other'].builtinHash, hashSkillDir(path.join(shipped, 'other')))
})

test('restore refuses names that are not shipped, and a missing shipped dir', async (t) => {
  const { root, shipped } = await setup(t)
  assert.throws(() => restoreBuiltinSkill(root, shipped, 'nope'), /內建/)
  assert.throws(() => restoreBuiltinSkill(root, shipped, '../probe'), /內建/)
  assert.throws(() => restoreBuiltinSkill(root, null, 'probe'), /內建/)
  assert.equal(fsSync.existsSync(path.join(root, 'skills')), false, 'nothing written')
})

test('no shipped dir: sync and the removed list are no-ops', async (t) => {
  const { root } = await setup(t)
  assert.deepEqual(syncBuiltinSkills(root, null), { installed: [], updated: [] })
  assert.deepEqual(syncBuiltinSkills(root, path.join(root, 'missing')), { installed: [], updated: [] })
  assert.deepEqual(removedBuiltinSkills(root, null), [])
})

test('annotate keeps working for built-in records (smoke)', async (t) => {
  const { root, shipped } = await setup(t)
  syncBuiltinSkills(root, shipped)
  annotate(root, 'skill/probe', { description: 'x' })
  assert.ok(index(root).entries['skill/probe'].builtinHash)
})
```

- [ ] **Step 2: 跑測試確認失敗**

Run: `node scripts/run-tests.mjs ./test/library-builtins.test.mjs`
Expected: FAIL — `Cannot find module '…/library-builtins.ts'`。

- [ ] **Step 3: 實作**

建立 `packages/core/src/library-builtins.ts`：

```ts
import fs from 'fs'
import path from 'path'
import {
  annotate,
  ensureLibrary,
  entryKey,
  entryPath,
  hashSkillDir,
  libraryRoot,
  listLibrary,
  markBuiltinDeleted,
  readIndex,
  safeLibraryName,
  skillNamesIn,
  writeIndex,
  type LibraryEntry,
} from './library'
import { getPlatform } from './platform'

/**
 * Skills VibeFlow ships in every user's library. Each lands as an ordinary
 * library entry the user may edit, disable or delete; `builtinHash` in the
 * index remembers what was installed, so an untouched copy can follow new
 * releases and an edited one is never overwritten.
 */

/** The shipped skills of this install, or null when it carries none. */
export function builtinSkillsDir(): string | null {
  return getPlatform().builtinSkillsDir?.() ?? null
}

/** Copy one shipped skill over the library's; returns the hash of what landed. */
function installBuiltin(root: string, builtinDir: string, name: string): string {
  const target = entryPath(root, 'skill', name)
  fs.rmSync(target, { recursive: true, force: true })
  fs.cpSync(path.join(builtinDir, name), target, {
    recursive: true,
    dereference: true,
    filter: (src) => path.basename(src) !== '__pycache__',
  })
  return hashSkillDir(target)
}

/**
 * Bring the library in line with the shipped skills. Installs new ones,
 * updates the ones the user has not touched, and leaves everything else —
 * edited copies, deleted ones, and same-name entries the user made — alone.
 */
export function syncBuiltinSkills(
  root: string,
  builtinDir: string | null
): { installed: string[]; updated: string[] } {
  const result = { installed: [] as string[], updated: [] as string[] }
  if (!builtinDir) return result
  const names = skillNamesIn(builtinDir)
  if (names.length === 0) return result
  ensureLibrary(root)

  for (const name of names) {
    const key = entryKey('skill', name)
    const record = readIndex(root).entries[key] ?? {}
    if (record.builtinDeleted) continue
    const target = entryPath(root, 'skill', name)

    if (!record.builtinHash) {
      // Something already holds the name: the user's own entry, not ours to take.
      if (fs.existsSync(target)) continue
      annotate(root, key, {
        builtinHash: installBuiltin(root, builtinDir, name),
        enabled: true,
        importedAt: Date.now(),
      })
      result.installed.push(name)
      continue
    }

    if (!fs.existsSync(path.join(target, 'SKILL.md'))) {
      // Removed by hand rather than through the panel: same intent.
      markBuiltinDeleted(root, key)
      continue
    }
    if (hashSkillDir(path.join(builtinDir, name)) === record.builtinHash) continue
    if (hashSkillDir(target) !== record.builtinHash) continue
    annotate(root, key, { builtinHash: installBuiltin(root, builtinDir, name) })
    result.updated.push(name)
  }
  return result
}

/** Overwrite (or bring back) a built-in with the shipped version. */
export function restoreBuiltinSkill(
  root: string,
  builtinDir: string | null,
  name: string
): LibraryEntry {
  if (!builtinDir || safeLibraryName(name) !== name || !skillNamesIn(builtinDir).includes(name)) {
    throw new Error(`不是內建 skill：${name}`)
  }
  ensureLibrary(root)
  const key = entryKey('skill', name)
  const builtinHash = installBuiltin(root, builtinDir, name)
  const index = readIndex(root)
  const record = { ...index.entries[key], builtinHash, enabled: true, importedAt: Date.now() }
  delete record.builtinDeleted
  index.entries[key] = record
  writeIndex(root, index)
  const entry = listLibrary(root, builtinDir).find((e) => e.key === key)
  if (!entry) throw new Error(`還原失敗：${name}`)
  return entry
}

/** Shipped skills the user deleted, unless they have since made their own. */
export function removedBuiltinSkills(root: string, builtinDir: string | null): string[] {
  if (!builtinDir) return []
  const index = readIndex(root)
  return skillNamesIn(builtinDir).filter(
    (name) =>
      index.entries[entryKey('skill', name)]?.builtinDeleted === true &&
      !fs.existsSync(entryPath(root, 'skill', name))
  )
}

/** Host startup hook: never lets a library problem stop the host. */
export async function syncBuiltinsAtStartup(): Promise<void> {
  try {
    const { installed, updated } = syncBuiltinSkills(await libraryRoot(), builtinSkillsDir())
    if (installed.length || updated.length) {
      console.log(`Built-in skills — installed: ${installed.join(', ') || '-'}; updated: ${updated.join(', ') || '-'}`)
    }
  } catch (err) {
    console.error('Failed to sync built-in skills:', err)
  }
}
```

`packages/core/src/platform.ts` 的 `PlatformServices` 介面，`cliEntry?` 之後加（實作留給 Task 3）：

```ts
  /**
   * Skills VibeFlow ships into every library (`library-builtins.ts`).
   * Absent or null = this install carries none.
   */
  builtinSkillsDir?(): string | null
```

- [ ] **Step 4: 跑測試確認通過**

Run: `node scripts/run-tests.mjs ./test/library-builtins.test.mjs ./test/library.test.mjs`
Expected: 全部 PASS。

- [ ] **Step 5: 型別檢查並 commit**

```bash
npx tsc --noEmit -p tsconfig.json
git add packages/core/src/library-builtins.ts packages/core/src/platform.ts test/library-builtins.test.mjs
git commit -m "feat(library): sync, restore and list removed built-in skills"
```

---

### Task 3: platform 位置、host 啟動同步、handler 與前端 API

**Files:**
- Modify: `packages/core/src/platform.ts`（`PlatformServices`、`NodePlatformOptions`、`createNodePlatform`）
- Modify: `packages/cli/src/host.ts`（`startHost`）
- Modify: `packages/core/src/service.ts`（library handlers）
- Modify: `packages/core/src/client.ts`（library methods）
- Modify: `renderer/lib/api.ts`
- Modify: `packages/core/IPC_API_MAP.md`
- Test: `test/platform.test.mjs`、`test/service.test.mjs`

**Interfaces:**
- Consumes（Task 2）：`builtinSkillsDir()`、`restoreBuiltinSkill`、`removedBuiltinSkills`、`syncBuiltinsAtStartup`。
- Produces：
  - `PlatformServices.builtinSkillsDir?(): string | null`
  - `NodePlatformOptions.builtinSkillsDir?: string | null`
  - handlers `'library:restoreBuiltin'`（payload `{ name: string }` → `LibraryEntry`）、`'library:removedBuiltins'`（→ `string[]`）
  - client：`restoreBuiltinSkill(payload: { name: string }): Promise<LibraryEntry>`、`listRemovedBuiltinSkills(): Promise<string[]>`
  - api.ts：`restoreBuiltinSkill(name: string): Promise<LibraryEntry | null>`、`listRemovedBuiltinSkills(): Promise<string[]>`

- [ ] **Step 1: 寫失敗測試**

`test/platform.test.mjs` 檔尾加：

```js
test('built-in skills live beside the bundle, or under core in a checkout', () => {
  const bundle = path.join('/opt', 'vibeflow', 'dist', 'vibeflow.mjs')
  assert.equal(
    createNodePlatform({ cliEntry: bundle }).builtinSkillsDir(),
    path.join('/opt', 'vibeflow', 'dist', 'builtin-skills')
  )
  assert.equal(
    createNodePlatform({ sourceRoot: '/src/vf' }).builtinSkillsDir(),
    path.join('/src/vf', 'packages', 'core', 'builtin-skills')
  )
  assert.equal(createNodePlatform({}).builtinSkillsDir(), null)
  assert.equal(createNodePlatform({ sourceRoot: '/src/vf', builtinSkillsDir: '/x' }).builtinSkillsDir(), '/x')
})
```

`test/service.test.mjs` 檔尾加：

```js
test('library built-in handlers validate input and use the registered shipped dir', async (t) => {
  const shipped = await fs.mkdtemp(path.join(os.tmpdir(), 'vf-service-builtin-'))
  t.after(() => {
    setPlatform(createNodePlatform({ userDataDir: storeDir }))
    return fs.rm(shipped, { recursive: true, force: true })
  })
  await fs.mkdir(path.join(shipped, 'probe'))
  await fs.writeFile(path.join(shipped, 'probe', 'SKILL.md'), '---\nname: probe\ndescription: p\n---\n')
  setPlatform(createNodePlatform({ userDataDir: storeDir, builtinSkillsDir: shipped }))
  const core = createCore({ sessions: fakeSessions(), bus: new EventBus(), version: '9.9.9' })
  t.after(() => core.shutdown())

  assert.deepEqual(await core.handlers['library:removedBuiltins'](), [])
  await assert.rejects(core.handlers['library:restoreBuiltin']({ name: 42 }), { code: 'INVALID_REQUEST' })
  await assert.rejects(core.handlers['library:restoreBuiltin']({ name: '../etc' }), /內建/)

  const entry = await core.handlers['library:restoreBuiltin']({ name: 'probe' })
  assert.equal(entry.name, 'probe')
  assert.deepEqual(entry.builtin, { modified: false, updateAvailable: false })
  const listed = (await core.handlers['library:list']()).find((e) => e.name === 'probe')
  assert.deepEqual(listed.builtin, { modified: false, updateAvailable: false })

  await core.handlers['library:delete']({ kind: 'skill', name: 'probe' })
  assert.deepEqual(await core.handlers['library:removedBuiltins'](), ['probe'])
})
```

- [ ] **Step 2: 跑測試確認失敗**

Run: `node scripts/run-tests.mjs ./test/platform.test.mjs ./test/service.test.mjs`
Expected: FAIL — `builtinSkillsDir is not a function`、`core.handlers['library:removedBuiltins'] is not a function`。

- [ ] **Step 3: 實作**

1. `packages/core/src/platform.ts`（`PlatformServices.builtinSkillsDir?` 介面已在 Task 2 加入）：`NodePlatformOptions` 加 `builtinSkillsDir?: string | null`；`createNodePlatform` 的 return 物件 `cliEntry` 之後加：

```ts
    builtinSkillsDir: () => {
      if (options.builtinSkillsDir !== undefined) return options.builtinSkillsDir
      // npm build: dist/vibeflow.mjs with dist/builtin-skills beside it.
      if (options.cliEntry) return path.join(path.dirname(options.cliEntry), 'builtin-skills')
      if (root) return path.join(root, 'packages', 'core', 'builtin-skills')
      return null
    },
```

2. `packages/cli/src/host.ts`：import 加 `import { syncBuiltinsAtStartup } from '../../core/src/library-builtins'`；在 `try {` 之後、`const bus = new EventBus()` 之前加：

```ts
    // Only the lock holder writes the library, so this runs after acquiring it.
    await syncBuiltinsAtStartup()
```

3. `packages/core/src/service.ts`：
   - import 區加 `import { builtinSkillsDir, removedBuiltinSkills, restoreBuiltinSkill } from './library-builtins'`。
   - `'library:list'` 改為 `async () => listLibrary(await libraryRoot(), builtinSkillsDir()),`
   - `'library:delete'` 之後加：

```ts
    'library:restoreBuiltin': async (payload) => {
      const p = obj<{ name: unknown }>(payload, 'payload')
      return restoreBuiltinSkill(await libraryRoot(), builtinSkillsDir(), str(p.name, 'name'))
    },
    'library:removedBuiltins': async () =>
      removedBuiltinSkills(await libraryRoot(), builtinSkillsDir()),
```

4. `packages/core/src/client.ts`，`deleteLibraryEntry` 之後加：

```ts
  /** Overwrite or bring back a shipped skill with the version this install carries. */
  restoreBuiltinSkill: (payload: { name: string }): Promise<LibraryEntry> =>
    t.invoke('library:restoreBuiltin', payload),
  /** Shipped skills the user deleted, offered for restore. */
  listRemovedBuiltinSkills: (): Promise<string[]> => t.invoke('library:removedBuiltins'),
```

5. `renderer/lib/api.ts`，`deleteLibraryEntry` 之後加：

```ts
export async function restoreBuiltinSkill(name: string): Promise<LibraryEntry | null> {
  const b = bridge()
  return b ? b.restoreBuiltinSkill({ name }) : null
}

export async function listRemovedBuiltinSkills(): Promise<string[]> {
  const b = bridge()
  return b ? b.listRemovedBuiltinSkills() : []
}
```

6. `packages/core/IPC_API_MAP.md`，`library:create / read / …` 那列之後加：

```md
| `library:restoreBuiltin` | core | `library.restoreBuiltin(name)` | | Name only; must be a skill this install ships |
| `library:removedBuiltins` | core | `library.removedBuiltins()` | | Shipped skills the user deleted |
```

- [ ] **Step 4: 跑測試確認通過**

Run: `node scripts/run-tests.mjs ./test/platform.test.mjs ./test/service.test.mjs ./test/library-builtins.test.mjs`
Expected: 全部 PASS。

- [ ] **Step 5: 型別檢查並 commit**

```bash
npx tsc --noEmit -p tsconfig.json
npx tsc --noEmit -p renderer/tsconfig.json
git add packages/core/src/platform.ts packages/cli/src/host.ts packages/core/src/service.ts packages/core/src/client.ts renderer/lib/api.ts packages/core/IPC_API_MAP.md test/platform.test.mjs test/service.test.mjs
git commit -m "feat(library): sync built-in skills at host start and expose restore"
```

---

### Task 4: 兩個內建 skill 的內容

**Files:**
- Move: `.claude/skills/visual-parity/` → `packages/core/builtin-skills/visual-parity/`
- Delete: `.agents/skills/visual-parity/SKILL.md`
- Create: `packages/core/builtin-skills/pr/SKILL.md`
- Test: `test/library-builtins.test.mjs`（加一個「出貨內容」案例）

**Interfaces:**
- Consumes：`skillNamesIn`、`readSkillDescription`（既有，`library.ts`）。
- Produces：`packages/core/builtin-skills/{visual-parity,pr}/SKILL.md`。

- [ ] **Step 1: 寫失敗測試**

`test/library-builtins.test.mjs` 的 import 區加 `import { readSkillDescription, skillNamesIn } from '../packages/core/src/library.ts'`（併入既有 library import 亦可），檔尾加：

```js
test('the shipped skills are well-formed and do not depend on a checkout path', () => {
  const dir = path.resolve('packages/core/builtin-skills')
  assert.deepEqual(skillNamesIn(dir), ['pr', 'visual-parity'])
  for (const name of skillNamesIn(dir)) {
    const md = fsSync.readFileSync(path.join(dir, name, 'SKILL.md'), 'utf8')
    assert.match(md, new RegExp(`^---\\r?\\nname: ${name}\\r?\\n`), `${name}: frontmatter name`)
    assert.ok(readSkillDescription(path.join(dir, name, 'SKILL.md')), `${name}: description`)
    assert.doesNotMatch(md, /~\/\.claude|\.claude\/skills|~\/\.Codex|eBug|Jira/, `${name}: no machine paths`)
  }
  assert.ok(fsSync.existsSync(path.join(dir, 'visual-parity', 'scripts', 'parity.py')))
})
```

- [ ] **Step 2: 跑測試確認失敗**

Run: `node scripts/run-tests.mjs ./test/library-builtins.test.mjs`
Expected: FAIL — `skillNamesIn` 回 `[]`（目錄不存在）。

- [ ] **Step 3: 搬 visual-parity 並改寫路徑**

```bash
git mv .claude/skills/visual-parity packages/core/builtin-skills/visual-parity
git rm .agents/skills/visual-parity/SKILL.md
```

編輯 `packages/core/builtin-skills/visual-parity/SKILL.md`：

1. frontmatter `description` 最後一句改為：`比對與驗收的結果寫進檔案，只回傳壓縮過的落差表。`（拿掉「本專案內建：…npm start…」）。
2. 「鐵則」第 1 條後面加一句：`下文的 \`parity.py\` 一律指本 SKILL.md 所在目錄下的 \`scripts/parity.py\`，用絕對路徑呼叫。`
3. 全文 `python .claude/skills/visual-parity/scripts/parity.py` 改為 `python <skill-dir>/scripts/parity.py`（`<skill-dir>` = 本 SKILL.md 所在目錄）。
4. 整段 `## 前置`（到 `## diff` 之前）換成：

```markdown
## 前置

- `<skill-dir>` 是本 SKILL.md 所在的目錄；script 在 `<skill-dir>/scripts/parity.py`。
- 需要 `pip install playwright && playwright install chromium`；錄 `.mp4` 才需要 ffmpeg（選配）。
- 受測頁面要先跑起來。server 已經在跑就直接呼叫 `parity.py`；自簽憑證已預設接受（`ignore_https_errors`）。
- 頁面需要登入或一次性 token 時，`--ref` / `--local` 直接給帶 token 的完整 URL，或先用 `flow` 的步驟登入。
  打到登入頁或拒絕頁時比對結果毫無意義——`matched` 異常地少就先檢查這個。
- 新舊對照要同時起兩份 server（不同 port），各自當 `--ref` 與 `--local`。
```

5. `## 維護` 段落改為：`改過 \`parity.py\` 後跑 \`python <skill-dir>/scripts/parity.py selftest\`，會用內建 fixture 驗證配對與 diff 邏輯仍正確。`

- [ ] **Step 4: 建立通用版 pr**

建立 `packages/core/builtin-skills/pr/SKILL.md`：

````markdown
---
name: pr
description: Create or update a GitHub draft pull request for the current branch with gh — conventional-commit title, What / Why / How body in English, written only from this branch's diff. Use when the user says "open a PR", "create PR", "建立 PR", "開 PR", or "/pr #123" to update an existing one.
---

# Pull request

Talk to the user in their language. Write the PR title and body in English.

## 1. Mode

- Argument is a number or `#number` → **update** that PR (`gh pr edit`).
- Anything else (an issue reference, or nothing) → **create** a new draft PR.

## 2. Check the branch

Run and read:

```bash
git branch --show-current
git status --short
gh repo view --json defaultBranchRef -q .defaultBranchRef.name
```

- On the default branch → stop and tell the user to create a feature branch first.
- Uncommitted changes → tell the user and ask whether to commit them first; do not commit on your own.
- Base: in update mode, `gh pr view <n> --json baseRefName -q .baseRefName`; otherwise the default branch.
- Not pushed yet (`git rev-parse --abbrev-ref @{upstream}` fails) → `git push -u origin HEAD`.

## 3. Read the change

```bash
git fetch origin <base>
git log --oneline origin/<base>..HEAD
git diff --stat origin/<base>...HEAD
git diff origin/<base>...HEAD
```

Describe **only** this diff — nothing the base branch already had. If the diff is too large to read
whole, use `--stat` to pick the files that matter and read those.

## 4. Write it

**Title:** conventional commit — `<type>(<scope>): <summary>`, under 72 characters.
`type` is one of `feat`, `fix`, `refactor`, `perf`, `docs`, `test`, `build`, `ci`, `chore`.
Add `scope` only when one area clearly owns the change.

**Body:**

```markdown
## What
<one or two sentences: what changes for a user or a caller>

## Why
<the problem or goal; link the issue if there is one>

## How
- <the key decisions, not a file-by-file list>

## Testing
- <what was run or checked, and the result>
```

Issue link: if the argument or the branch name carries an issue reference (`#123`, `ABC-123`),
put it in **Why** (`Closes #123` for a GitHub issue in this repo).

## 5. Create or update

Write the body to a temp file, then:

```bash
gh pr create --draft --base <base> --title "<title>" --body-file <file>
gh pr edit <n> --title "<title>" --body-file <file>
```

Report the PR URL and the title to the user.
````

- [ ] **Step 5: 跑測試與 selftest 確認通過**

Run:
```bash
node scripts/run-tests.mjs ./test/library-builtins.test.mjs
python packages/core/builtin-skills/visual-parity/scripts/parity.py selftest
```
Expected: 測試 PASS；selftest 印出 `selftest OK`。然後刪掉 selftest 產生的 `__pycache__`（若有）：`rm -rf packages/core/builtin-skills/visual-parity/scripts/__pycache__`。

- [ ] **Step 6: commit**

```bash
git add -A packages/core/builtin-skills .claude/skills .agents/skills test/library-builtins.test.mjs
git commit -m "feat(library): ship visual-parity and a generic pr skill as built-ins"
```

---

### Task 5: npm 打包

**Files:**
- Modify: `scripts/build-npm.mjs`

**Interfaces:**
- Consumes：`packages/core/builtin-skills/`（Task 4）、`builtinSkillsDir()` 的 npm 推導（Task 3：`dirname(cliEntry)/builtin-skills`）。
- Produces：`dist-npm/dist/builtin-skills/`。

- [ ] **Step 1: 實作**

`scripts/build-npm.mjs`，在 `console.log('==> Copying the Web UI')` 那段 `fs.cpSync(...)` 之後加：

```js
console.log('==> Copying the built-in skills')
fs.cpSync(path.join(root, 'packages', 'core', 'builtin-skills'), path.join(out, 'dist', 'builtin-skills'), {
  recursive: true,
  filter: (src) => path.basename(src) !== '__pycache__',
})
```

- [ ] **Step 2: 驗證打包內容與 npm 版解析**

Run:
```bash
npm run build:npm
ls dist-npm/dist/builtin-skills/visual-parity/scripts/parity.py dist-npm/dist/builtin-skills/pr/SKILL.md
node dist-npm/dist/vibeflow.mjs --store-path "$(mktemp -d)" --no-open --port 47832 &
sleep 3
```
然後確認該 store 目錄下 `library/skills/` 有 `pr` 與 `visual-parity`，`library/index.json` 兩筆都有 `builtinHash`；最後 `node dist-npm/dist/vibeflow.mjs shutdown --store-path <同一目錄>`。
Expected: 兩個檔案都存在；啟動 log 印出 `Built-in skills — installed: pr, visual-parity; updated: -`。

- [ ] **Step 3: 清理並 commit**

```bash
rm -rf dist-npm
git add scripts/build-npm.mjs
git commit -m "build: ship the built-in skills in the npm package"
```

---

### Task 6: Library 面板

**Files:**
- Modify: `renderer/components/library-panel.tsx`

**Interfaces:**
- Consumes（Task 3）：`restoreBuiltinSkill(name)`、`listRemovedBuiltinSkills()`（`@/lib/api`）；`LibraryEntry.builtin`（Task 1）。

- [ ] **Step 1: 實作**

1. import 加 `restoreBuiltinSkill`、`listRemovedBuiltinSkills`；lucide 加 `RotateCcw`。
2. state 加：

```tsx
  const [removedBuiltins, setRemovedBuiltins] = useState<string[]>([])
  /** Restore overwrites the user's edits, so it takes a second click. */
  const [confirmRestore, setConfirmRestore] = useState<string | null>(null)
```

3. `refresh` 改為：

```tsx
  const refresh = useCallback(async () => {
    const [list, removed] = await Promise.all([listLibrary(), listRemovedBuiltinSkills()])
    setEntries(list)
    setRemovedBuiltins(removed)
    setLoading(false)
  }, [])
```

4. 新增 handler：

```tsx
  const handleRestore = (name: string) => {
    if (confirmRestore !== name) {
      setConfirmRestore(name)
      return
    }
    setConfirmRestore(null)
    return run(`restore:${name}`, () => restoreBuiltinSkill(name))
  }
```

5. 項目名稱那行 `<p className="truncate font-mono text-sm">{entry.name}</p>` 換成：

```tsx
                      <p className="flex items-center gap-2 font-mono text-sm">
                        <span className="truncate">{entry.name}</span>
                        {entry.builtin && (
                          <span className="shrink-0 rounded-sm bg-muted px-1.5 font-sans text-xs text-muted-foreground">
                            內建
                          </span>
                        )}
                        {entry.builtin?.updateAvailable ? (
                          <span className="shrink-0 rounded-sm bg-primary/15 px-1.5 font-sans text-xs text-primary">
                            有新版
                          </span>
                        ) : entry.builtin?.modified ? (
                          <span className="shrink-0 rounded-sm bg-muted px-1.5 font-sans text-xs text-muted-foreground">
                            已修改
                          </span>
                        ) : null}
                      </p>
```

6. 按鈕列（`編輯` 之後、`reimport` 之前）加：

```tsx
                      {entry.builtin?.modified && (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => void handleRestore(entry.name)}
                          onBlur={() => setConfirmRestore(null)}
                          disabled={busy !== null}
                          title="以 VibeFlow 出貨的版本覆蓋（會丟掉你的修改）"
                        >
                          {busy === `restore:${entry.name}` ? (
                            <Loader2 className="size-3.5 animate-spin" />
                          ) : (
                            <RotateCcw className="size-3.5" />
                          )}
                          {confirmRestore === entry.name ? '確定覆蓋？' : '還原預設'}
                        </Button>
                      )}
```

7. `KINDS.map(...)` 結束後、外層 `</div>` 之前加：

```tsx
      {removedBuiltins.length > 0 && (
        <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted-foreground">
          已移除的內建 skill：
          {removedBuiltins.map((name) => (
            <Button
              key={name}
              variant="ghost"
              size="sm"
              onClick={() => void run(`restore:${name}`, () => restoreBuiltinSkill(name))}
              disabled={busy !== null}
              title="放回 VibeFlow 出貨的版本"
            >
              <RotateCcw className="size-3.5" />
              {name}
            </Button>
          ))}
        </p>
      )}
```

（已移除的項目沒有用戶修改可丟，所以不需二次確認。）

- [ ] **Step 2: 型別檢查、ui-consistency、build**

Run:
```bash
npx tsc --noEmit -p renderer/tsconfig.json
node scripts/run-tests.mjs ./test/ui-consistency.test.mjs
npm run build:web
```
Expected: 全部通過。

- [ ] **Step 3: 實機檢查**

```bash
npm start -- --store-path <tmp dir> --no-open --port 47831
```
開印出的 URL → Settings → Library，確認：
- `pr`、`visual-parity` 出現在 Skills，帶「內建」標籤。
- 編輯 `pr` 存檔 → 出現「已修改」與「還原預設」；按一次變「確定覆蓋？」，再按 → 內容還原、標籤消失。
- 刪除 `visual-parity` → 底部出現「已移除的內建 skill：visual-parity」；按下 → 回到列表。
完成後 `npm run vibeflow -- shutdown --store-path <tmp dir>`。

- [ ] **Step 4: commit**

```bash
git add renderer/components/library-panel.tsx
git commit -m "feat(web): show built-in skills in the Library with restore"
```

---

### Task 7: 文件與完整驗收

**Files:**
- Modify: `README.md`、`AGENTS.md`、`docs/features/builtin-skills/spec.md`（狀態）

- [ ] **Step 1: 文件**

- `README.md`：在介紹 Library 的段落（`grep -n -i library README.md` 找位置；沒有則放在功能列表）加一句：
  `VibeFlow ships built-in skills (\`visual-parity\`, \`pr\`) into every Library; edit or disable them there, and restore the shipped version any time. \`visual-parity\` needs Python with \`pip install playwright && playwright install chromium\`.`
- `AGENTS.md` project structure 的 `packages/core/src/` 區塊，`artifacts.ts, decisions.ts, …` 那行之前加：
  `│   ├── library-builtins.ts  shipped skills → every user's library (sync at host start, restore)`
  並在 `packages/` 區塊加一行：`├── core/builtin-skills/   skills VibeFlow ships (copied to dist/builtin-skills by build:npm)`。
- `spec.md` 狀態改為 `已實作`。

- [ ] **Step 2: Definition of Done**

```bash
npx tsc --noEmit -p tsconfig.json
npx tsc --noEmit -p renderer/tsconfig.json
npm test
npm run build:web
npm run test:e2e
```
Expected: 全綠。（`test/artifacts.test.mjs` 兩個 symlink 案例在未開 Developer Mode 的 Windows 上本來就失敗，與本功能無關；在報告中註明。）

- [ ] **Step 3: 清理並 commit**

```bash
rm -rf app renderer/.next
git add README.md AGENTS.md docs/features/builtin-skills/spec.md
git commit -m "docs: document built-in Library skills"
```
