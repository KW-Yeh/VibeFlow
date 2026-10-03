# Spec：Library 內建 skill

- 狀態：已實作
- Ticket：尚無
- 需求來源：使用者要求「內建的 pr 與 visual-parity skill 出現在設定的 Library 上，方便用戶自己調整」
- 更新日期：2026-10-03
- 確認紀錄：2026-10-03 對話中確認——隨 npm 出貨給所有用戶；pr 改寫成通用版再出貨；
  用戶沒改過的內建項目隨版本自動更新，改過的保留並提示；設計整體確認。

## 問題與目標

Library（`<userData>/library/`，見 [LIBRARY_PLAN.md](../../plans/LIBRARY_PLAN.md)）目前只有用戶自己
import 或手動建立的項目，新用戶打開是空的。VibeFlow 自己 repo 裡的 `.claude/skills/` 屬於「專案 skill」，
只對開發 VibeFlow 的人有效，也不會出現在 Library 面板。

目標：VibeFlow 隨 npm 出貨一組內建 skill（第一批：`visual-parity`、通用版 `pr`），
每個用戶的 Library 自動帶有它們；用戶可以在面板裡編輯、停用、刪除；
VibeFlow 升級時，用戶沒動過的內建項目跟著更新，動過的不被覆蓋。

## 範圍

### 本次包含

- 內建 skill 的唯一來源 `packages/core/builtin-skills/<name>/`，`scripts/build-npm.mjs` 把它打包進 `dist/builtin-skills/`。
- `PlatformServices.builtinSkillsDir()`：host 註冊；從原始碼執行指向 `packages/core/builtin-skills`，npm 版指向 `dist/builtin-skills`。
- core 的同步邏輯 `syncBuiltinSkills`，host 啟動時執行一次。
- handler `library:restoreBuiltin`、`library:removedBuiltins`，以及 `client.ts` / `renderer/lib/api.ts` 對應方法，`IPC_API_MAP.md` 更新。
- `LibraryEntry.builtin` 狀態欄位，與 `library-panel.tsx` 的標籤、還原按鈕、已移除清單。
- 兩個內建 skill 的內容：
  - `visual-parity`：由目前 repo 的版本搬過來，script 路徑改成相對於 skill 目錄。
  - `pr`：通用版（見「pr 通用版內容」）。
- 刪除 repo 的 `.claude/skills/visual-parity/`、`.agents/skills/visual-parity/`（改由 Library 提供，VibeFlow 開發也用 Library 版）。
- `README.md` 提一句 Library 內建 skill 與 visual-parity 的 Python／Playwright 需求；`AGENTS.md` 的 project structure 補 `builtin-skills/`。

### 本次不包含

- 內建 prompt / script（只做 skill；資料結構允許日後擴充，但不先做）。
- repo 的 `.claude/skills/pr`、`.agents/skills/pr`（公司專用版，保留為 VibeFlow 開發用專案 skill）。
- TUI 的 Library 介面（TUI 目前沒有 Library 畫面）。
- 自動安裝 Python / Playwright。

## 資料與狀態

`index.json` 的每筆記錄新增兩個欄位（皆可省略，舊 index 免遷移）：

| 欄位 | 意義 |
| --- | --- |
| `builtinHash` | 上次由 VibeFlow 安裝進 Library 的內建版本內容 hash。有此欄位 = 這筆是內建項目 |
| `builtinDeleted` | 用戶刪掉了這個內建項目；同步時不再放回 |

hash 計算：skill 目錄內所有檔案依相對路徑排序，對「路徑 + 內容」做 sha256。行尾不正規化（同步與比對在同一台機器上進行）。

`LibraryEntry` 新增：

```ts
builtin?: {
  /** 磁碟內容已不等於 builtinHash。 */
  modified: boolean
  /** 出貨版本不等於 builtinHash（只在 modified 時會成立，未修改的已被自動更新）。 */
  updateAvailable: boolean
}
```

「已移除的內建 skill」名單由新 handler `library:removedBuiltins` 提供（回傳 `string[]`），
不改 `library:list` 的回傳形狀，既有呼叫端不受影響。

## 行為

### 同步（`syncBuiltinSkills(root, builtinDir)`，host 啟動時）

對 `builtinDir` 下每個含 `SKILL.md` 的目錄 `<name>`，令 `shipped` 為其 hash、`record` 為 `skill/<name>` 的 index 記錄：

| 情境 | 預期行為 |
| --- | --- |
| `record.builtinDeleted` | 不動 |
| Library 沒有 `<name>`、也沒有記錄 | 複製進 Library，`builtinHash = shipped`，`enabled = true` |
| Library 有 `<name>`，記錄沒有 `builtinHash`（用戶自己的同名項目） | 不動，不接管 |
| 有 `builtinHash`，磁碟 hash 等於 `builtinHash`，`shipped` 不同 | 以出貨版取代，`builtinHash = shipped`，保留 `enabled` |
| 有 `builtinHash`，磁碟 hash 不等於 `builtinHash` | 不動（`listLibrary` 據此回報 `modified` / `updateAvailable`） |
| 有 `builtinHash`，但 Library 目錄被手動刪掉（記錄沒標 deleted） | 視同用戶刪除：標 `builtinDeleted`，不放回 |
| `builtinDir` 不存在或為 null | 整個同步略過，不報錯 |

同步失敗（權限、磁碟）只記 log，不阻擋 host 啟動。

### 用戶操作

| 操作 | 預期行為 |
| --- | --- |
| 編輯內建 skill（既有 `library:update`） | 照常寫入；之後列出時 `modified = true` |
| 停用 / 啟用 | 照常；同步更新時保留用戶的 `enabled` |
| 刪除內建 skill | 刪除檔案，index 記錄改為只保留 `builtinDeleted: true`（不整筆刪掉） |
| 還原預設（`library:restoreBuiltin`，參數 `name`） | 以出貨版覆蓋 Library 中的 `<name>`、`builtinHash = shipped`、清除 `builtinDeleted`、`enabled = true`；`name` 不是出貨中的內建 skill 時回錯 |

### 面板（`library-panel.tsx`）

- 內建項目名稱旁顯示「內建」標籤。
- `modified && !updateAvailable` 顯示「已修改」；`updateAvailable` 顯示「有新版」。兩者都提供「還原預設」，按下先確認（會覆蓋用戶修改）。
- 面板底部：「已移除的內建 skill：<name> · 還原」，沒有時不顯示。
- 樣式沿用 shadcn token 與 `ui-consistency` 規則。

### 投遞給 agent

不變。內建 skill 進入 Library 後就是一般 Library 項目，經既有的 `buildPluginDir`（Claude）與 `buildCodexHome`（Codex）投遞；
名稱與專案 skill 衝突時沿用現有規則（Codex：專案優先；Claude：Library skill 以 `vibeflow-library:` 前綴並存）。

## 兩個內建 skill 的內容

### visual-parity

- 以 repo 目前的 `.claude/skills/visual-parity/` 為基礎（含 Windows UTF-8 修正的 `scripts/parity.py`）。
- 所有 `python .claude/skills/visual-parity/scripts/parity.py` 改為「本 SKILL.md 所在目錄的 `scripts/parity.py`」，
  不依賴 repo 相對路徑或 `~/.claude`。
- 「VibeFlow Web UI 當作受測頁面」一節改寫成通用的「受測頁面需要 token / 登入時」說明，不寫死 VibeFlow 指令；
  通用 dev server 說明保留。
- 保留依賴說明：Python + `pip install playwright && playwright install chromium`；ffmpeg 選配。

### pr（通用版）

- 用 `gh` 建立 Draft PR，或以 `/pr #<number>` 更新既有 PR。
- 流程：檢查分支（在預設分支上就停下提醒）、確認已 commit／已 push（未 push 則 push）、
  以 `origin/<base>...HEAD` 的 diff 為唯一依據撰寫。
- 標題：conventional-commit 格式；內文：`## What` / `## Why` / `## How`，以英文撰寫；與用戶溝通用用戶的語言。
- 有 issue 編號（從分支名或參數）時在內文連結；不綁特定追蹤系統。
- 移除：Jira／eBug、公司子專案 scope 對照、`~/.claude/scripts/*` 依賴、「全程不准詢問」條款、`/ebug`、`/translate` 子 skill。

## 驗收

| 項目 | 方式 |
| --- | --- |
| 同步表格每一列 | `test/library.test.mjs` 新案例 |
| 刪除保留 `builtinDeleted`、還原、`modified` / `updateAvailable` 計算 | `test/library.test.mjs` |
| `library:restoreBuiltin` 參數驗證與未知名稱回錯、`library:removedBuiltins` | `test/service.test.mjs` |
| npm 套件含 `dist/builtin-skills/visual-parity/scripts/parity.py` 與 `pr/SKILL.md` | `npm run build:npm` 後檢查；`builtinSkillsDir()` 在 npm 版解析正確 |
| 面板顯示 | `npm run build:web` + 拋棄式 `--store-path` 啟動 host，手動檢查標籤、已修改、還原、已移除清單 |
| 回歸 | `npx tsc` 兩組、`npm test`、`npm run test:e2e` |

## 風險

- **hash 與行尾**：Windows 的 git `autocrlf` 會讓 repo 檔案行尾在不同機器不同，但同步只比較同一台機器上的「出貨檔」與「Library 檔」，出貨檔在 npm 套件內是固定位元組，不受影響。從原始碼執行時若切換 autocrlf，最壞情況是被判為出貨版變更並自動更新未修改的項目，可接受。
- **同名衝突**：用戶早已 import 一個叫 `pr` 的 skill 時，內建 `pr` 不會出現（不接管）。這是刻意的；面板不額外提示。
