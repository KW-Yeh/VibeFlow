# Library — 實作計劃

在 VibeFlow 內建立一份自有的 skill / prompt / script 儲藏庫，手動建立或從本機 import，啟動任務時自動投遞給 agent。目的是讓規範不再依賴本機的 `~/.claude` `~/.codex` `~/.agents` 佈局，也不再有「某個 agent 吃不到」的破洞。

## 已確認的決策

| 項目 | 決定 |
|---|---|
| Import 語意 | **快照複製** — VibeFlow 擁有副本，本機原檔改動不影響。本機更新後需手動重新 import |
| 投遞方式 | **自動載入** — agent 不需被告知，不靠 model 自律去讀 |
| 投遞語意 | **全部納入以達成對等**：兩個 agent 都看到 library ∪ 專案 `.claude/skills/` ∪ 使用者層。不排除任何來源 —— 排除使用者層會連帶關掉 `~/.claude/CLAUDE.md`（Phase 0 實測），代價不可接受 |
| Script 角色 | **給 agent 的工具** — 在 prompt 說明用途與路徑，agent 自己決定跑 |
| 支援的 agent | **claude + codex**。gemini 的 code 移除（見 Phase 5） |
| 選擇的層級 | **全域**（Settings 一次選好，所有任務都帶）。per-task 覆寫留待後續 |
| 範圍 | Phase 0–5 全做 |

## 為什麼需要這個

現況本機有三個平行的 skill store，還有交叉 symlink：

| 位置 | 誰吃得到 |
|---|---|
| `~/.claude/skills/` | 只有 claude |
| `~/.codex/skills/`（部分 symlink 回 `~/.claude/skills/`） | 只有 codex |
| `~/.agents/skills/`（靠 `~/.codex/config.toml` 的 `[[skills.config]] path=` 逐條註冊） | 只有 codex |
| `~/.claude/commands/pm-task.md` | 只有 claude |

具體症狀：Settings 的 system prompt 是 `/pm-task`，但 codex 走 `assembleCommand` 的 else 分支、system prompt 直接折進 prompt body，所以 codex 任務看到的是字面一行 `/pm-task`，沒有任何機制會展開它。**codex 任務目前等於沒有跑兩階段流程。**

## 投遞機制

**最終設計與實測證據見「Phase 0 實測結果」節。** 摘要：

| Agent | library | 專案的 `.claude/skills/` | 使用者層全域 skill |
|---|---|---|---|
| claude | `--plugin-dir <library>/plugin` | 自動發現，不需要做事 | 自動發現，不需要做事 |
| codex | `CODEX_HOME=<library>/codex-home`，其 `skills/` 放 library 複本 | 同目錄放指向 `<worktree>/.claude/skills/*` 的 symlink | 同目錄放指向 `~/.codex/skills/*` 的 symlink |

**claude 端不加任何抑制 flag**（`--setting-sources` 已作廢，見風險 1），只加 `--plugin-dir` 供給 library，其餘靠它原本的發現機制。codex 端由 VibeFlow 把三種來源湊進 `CODEX_HOME/skills/`，達成與 claude 相同的載入範圍。

claude 另外需要 `--add-dir <library>` 才能讀寫／執行 library 裡的 script。

不可用的 flag，記錄理由避免日後重試：

- `--disable-slash-commands`（help：「Disable all skills」）— 會連 VibeFlow 投遞的一起關掉
- `--safe-mode` — 把 CLAUDE.md、skills、plugins、hooks、MCP servers 全關，會殺掉 VibeFlow 賴以運作的 `--settings` hooks 與 `--mcp-config` agent-memory
- `--bare` — 讓 Anthropic 認證「strictly ANTHROPIC_API_KEY or apiKeyHelper，OAuth and keychain are never read」，會弄壞 OAuth 登入
- codex 的 `-c skills.config=[…]` — 是開關清單，不是發現來源（Phase 0 實測）

## Phase 0 — Spike（先驗證，勿跳過）

建一個只回一句話的 probe skill（`vf-probe`，內容只寫「若你讀到這行，回覆 `PROBE-OK`」），在 scratchpad 的 throwaway repo 內驗：

1. **claude 供給**：`--plugin-dir` 帶 library 的 plugin 目錄，probe skill 是否可用。
2. **codex 供給**：`codex -c 'skills.config=[{path="<abs>/SKILL.md"}]'`，probe skill 是否被載入。
3. **codex 讀專案的 claude skill**：repo 內放 `<repo>/.claude/skills/vf-project/SKILL.md`，用同一個 `-c` 把它的絕對路徑一起註冊，確認 codex 真的載入了一個原本專屬 claude 的 skill。**這是聯集設計的核心驗證。**
4. **codex 覆蓋確認**：確認 `-c` 是覆蓋而非合併 —— 使用者 `config.toml` 裡既有的 skill 在該次執行中應該看不到。
5. **claude 排除 user 層**（優化，非阻塞）：加 `--setting-sources project,local` 後，`~/.claude/skills` 的 skill 是否消失、專案級的是否保留。

第 3 步失敗就停下討論 —— 那代表 codex 無法吃專案的 claude skill，聯集設計不成立。第 5 步失敗不阻塞，記錄下來照現狀走。

## Phase 0 實測結果（2026-09-02）

### claude — 全部通過 ✅

指令形狀：`claude -p --permission-mode plan --model haiku [flags] '<probe>'`，在一個 throwaway repo 內執行，repo 帶專案級 `.claude/skills/vf-project/`，library 包成 plugin（`.claude-plugin/plugin.json` + `skills/vf-probe/`）。

| 設定 | library `vf-probe` | 專案 `vf-project` | 使用者層 `visual-parity` |
|---|---|---|---|
| 預設 | — | ✅ | ✅（user 層的 Stop hook 也會觸發） |
| `--setting-sources project` | — | ✅ | ❌ |
| `--setting-sources project --plugin-dir <library>/plugin` | ✅ | ✅ | ❌ |

**結論：`--plugin-dir` 供給 library 有效** —— 這一條採用。

`--setting-sources project` 技術上確實能排除使用者層（skill 消失 + user 層 hook 不再觸發，兩個訊號互相佐證），**但後續實測發現它連帶關掉 `~/.claude/CLAUDE.md`，因此不採用**（見風險 1）。

### codex — 先失敗，改用 `CODEX_HOME` 後通過 ✅

**先確認 `skills.config` 不是發現來源。** 它的 schema 是 `[{path, enabled}]`（漏 `enabled` 直接報 `missing field`）。實測 `codex exec -c 'skills.config=[{path="<library>/SKILL.md",enabled=true},{path="<repo>/.claude/skills/vf-project/SKILL.md",enabled=true}]'`：

- 回答只有 `visual-parity` — **`vf-probe` 與 `vf-project` 都沒被載入**
- `visual-parity`（使用者層）**仍然在** → `-c` 也不是覆蓋

即 **`skills.config` 是「以路徑為 key 的開關清單」，不是發現來源**；路徑沒被 codex 發現過，寫進去不會生效（使用者現有那些 `enabled = false` 的條目就是在關掉已發現的 skill）。

`codex exec --strict-config -c` 逐一探測（config 解析錯誤發生在呼叫 model 之前，零 token 成本）確認 `skills` 底下沒有搜尋路徑的 key：

```
skills.dirs / skills.paths / skills.extra_dirs / skills.roots / skills.enabled
→ Error loading config.toml: unknown configuration field `skills.<key>` in -c/--config override
```

**發現來源是 `$CODEX_HOME/skills/`。** 兩條可行路徑都實測通過：

| 方案 | 做法 | 結果 |
|---|---|---|
| A：repo 級目錄 | 在 `<repo>/.codex/skills/vf-repo/` 放 skill，不做任何註冊 | **被發現** ✅（`vf-repo` 出現在回答中） |
| B：接管 `CODEX_HOME` | `CODEX_HOME=<vibeflow dir>`，其 `skills/` 放 library 複本 + 指向專案 skill 的 **symlink**，`auth.json` 與 `config.toml` symlink 回 `~/.codex` | **`vf-probe, vf-project` 可用、`visual-parity` 排除** ✅ |

B 的三個附帶確認：

- **symlink 有效** — `vf-project` 是指向 `<repo>/.claude/skills/vf-project` 的 symlink，codex 照樣載入，所以「codex 沿用專案的 claude skill」成立
- **登入不受影響** — 只 symlink `auth.json` 就夠
- **MCP 不受影響** — `~/.codex/config.toml` 定義了 4 個 MCP server（`node_repl`、`agent-memory`、`computer-use`、`figma`），symlink 回來後保留。**不可省略 config.toml**，否則 codex 任務會失去 agent-memory

### 最終投遞設計（已全部實測）

| Agent | library | 專案的 `.claude/skills/` | 使用者層全域 skill |
|---|---|---|---|
| claude | `--plugin-dir <library>/plugin` | 自動發現 | 自動發現 |
| codex | `CODEX_HOME` 的 `skills/` 放 library 複本 | 同目錄放指向 `<worktree>/.claude/skills/*` 的 symlink | 同目錄放指向 `~/.codex/skills/*` 的 symlink |

選 B（`CODEX_HOME`）而不選 A（repo 級 `.codex/skills/`）的理由：B **不需要寫任何東西進 worktree**，所以不用動 `.git/info/exclude`、不會出現在 diff；而且能自由組合三種來源以對齊 claude 的載入範圍。A 雖然更輕，但只能加、不能決定範圍。

## Phase 1 — 儲存層（main）

新檔 `main/helpers/library.ts`。

- 根目錄 `<userData>/library/`
  - `skills/<name>/SKILL.md`（+ skill 自帶的其他檔案）
  - `prompts/<name>.md`
  - `scripts/<name>`（保留執行權限）
  - `plugin/`（claude 用的 plugin 包裝層，內容由 `skills/` 生成，見 Phase 2）
- 條目形狀：

  ```ts
  interface LibraryEntry {
    id: string            // randomUUID().slice(0, 8)，與 attachments 一致
    kind: 'skill' | 'prompt' | 'script'
    name: string          // 目錄／檔名，safeName 過濾
    description?: string  // skill 從 SKILL.md frontmatter 抽，其餘手填
    sourcePath?: string   // import 來源，供顯示與重新 import
    importedAt: number
  }
  ```

- API：`listLibrary()` / `importEntry(sourcePath, kind)` / `createEntry(kind, name, content)` / `updateEntry(id, content)` / `deleteEntry(id)`
- import 支援檔案與目錄：`skill` 是目錄（須含 `SKILL.md`），`prompt`／`script` 是單檔
- `safeName` 直接沿用 `attachments.ts` 既有實作，不另寫

**持久化契約變動 — 需要 migration。** `AppSettings` 加：

```ts
library?: {
  entries: LibraryEntry[]
  enabled: string[]   // 啟用的 entry id
}
```

舊 store 沒有這個欄位，讀取時預設 `{ entries: [], enabled: [] }`，不可假設存在。已存的 61 筆任務不受影響（此欄位在 settings 不在 task）。

## Phase 2 — 投遞層（main + renderer）

- `buildPluginDir()`：把啟用的 skill 生成 claude plugin 結構到 `<library>/plugin/`（`.claude-plugin/plugin.json` + `skills/<name>/`），每次啟動前重建
- `buildCodexHome(worktreePath)`：重建 `<library>/codex-home/` —
  - `auth.json` → symlink 到 `~/.codex/auth.json`（登入）
  - `config.toml` → symlink 到 `~/.codex/config.toml`（**不可省略**，否則失去 4 個 MCP server 含 agent-memory）
  - `skills/<name>/` → 啟用的 library skill 複本
  - `skills/<name>/` → 指向 `<worktree>/.claude/skills/<name>` 的 symlink（專案 skill）
  - `skills/<name>/` → 指向 `~/.codex/skills/<name>` 的 symlink（使用者層，達成與 claude 對等）
  - 同名優先序：**專案 > 使用者層 > library**（越貼近當下 repo 越優先），被跳過的回傳供 UI 標示
- `libraryLaunchInfo(worktreePath)`：回傳啟動指令需要的東西 —
  ```ts
  { pluginDir: string; codexHome: string; libraryDir: string; scripts: {name,path,description}[]; promptText: string }
  ```
  仿 `memoryLaunchInfo()` 的形狀，經 IPC 給 renderer（`renderer/lib/claude.ts` 不能 runtime import main）
- `assembleCommand` 改動：
  - claude 分支：加 `--plugin-dir <pluginDir>`、`--add-dir <libraryDir>`（**不加 `--setting-sources`**）
  - codex 分支：指令前綴 `CODEX_HOME=<codexHome> `（PTY 寫入的是 shell 指令，可直接帶環境變數）
  - prompt／script 的說明併入 system prompt（claude 走 `--append-system-prompt`，codex 折進 body）
- **契約檢查的使用端**：`buildAgentCommand` → `buildWorkspaceLaunchCommand` → `kanban-board.tsx` `armLaunch`；`LaunchOptions` 加 `library?: LibraryLaunchInfo`，與既有的 `memory?: MemoryLaunchInfo` 同一個模式

## Phase 3 — UI（renderer）

Settings 加 Library 分頁：

- 三個分區（Skills / Prompts / Scripts），每條顯示 name、description、來源、啟用勾選
- Import 按鈕開系統檔案／目錄選擇器（skill 選目錄、其餘選檔案）
- 新建：輸入 name + 內容
- 編輯／刪除／重新 import（來源路徑還在才啟用）
- 載入範圍要在 UI 明講：**library + 專案自己的 `.claude/skills/` 會載入；使用者層的全域 skill 不會**

## Phase 4 — 協議瘦身（原始動機）

Library 能可靠投遞之後，把進度追蹤協議的 7b / 7c / 7d（752 chars，佔 28%）移出：

- 7c 目前**與 `visual-parity` skill 矛盾** — 協議說「錄影一律用 `screencapture`」，visual-parity SKILL.md:128 說「不要用 `screencapture` 錄互動，Playwright 派發的是合成事件、真實指標不會動，錄到的游標停在原地」。這是正確性問題，不只是雜訊
- 做法：把 `visual-parity` import 進 library 並設為啟用，協議只留 app 契約（進度檔／計劃檔／artifacts 的動態路徑與 JSON schema，約 1430 chars）
- 這樣 claude 與 codex 都吃到同一份錄影規範，不再依賴 project-scoped 記憶

## Phase 5 — 移除 gemini

**資料風險已排除**：61 筆已存任務中 `agentCli` / `executionAgentCli` 出現 `gemini` **0 次**（57 claude / 4 codex），不需要資料 migration。

要改的位置：

| 檔案 | 內容 |
|---|---|
| `main/helpers/agents.ts` | `AgentCliId` union、`AGENT_CLIS` 的 gemini 條目與其 models |
| `main/helpers/chat-session.ts` | gemini 的啟動指令分支 |
| `main/helpers/git.ts` | `gemini: ['-p']` |
| `main/helpers/env.ts`、`main/main.ts`、`main/preload.ts` | 註解中的 gemini 提及 |
| `renderer/lib/claude.ts` | `AGENT_NAMES`、`DEFAULT_MODELS`、`assembleCommand` 的 gemini 分支、相關註解 |
| `renderer/components/new-task-dialog.tsx` | 「未偵測到 Agent CLI（claude / codex / gemini）」文案 |
| `test/agents.test.mjs`、`test/claude.test.mjs` | gemini 相關 case 移除或改寫 |

**防禦性處理**：`AgentCliId` 收窄後，若舊資料或外部輸入出現未知值，`taskAgent()` 要 normalize 成 `claude`，不可讓它掉進 codex 分支。

## 風險

1. ~~`--setting-sources project` 的副作用~~ → **已確認成立，此 flag 不可用。**

   實測（同一問題問兩次，throwaway repo 內無 CLAUDE.md 干擾）：

   | 設定 | 結果 |
   |---|---|
   | 預設 | 回答引用 `純問答或一行小事不用存`，逐字出自 `~/.claude/CLAUDE.md` 記憶節 → 有載入 |
   | `--setting-sources project` | 「NO — I don't have any rule called 三振」→ 沒載入 |

   為了藏掉 `~/.claude/skills` 而關掉整本全域 CLAUDE.md，代價不可接受。**排除使用者層的路線作廢**，改為「全部納入以達成對等」——見下節待決策。
2. **`CODEX_HOME` 是整包接管** — `auth.json` 與 `config.toml` 已驗證可用 symlink 保住，但 `sessions/`、`history.jsonl`、`archived_sessions/` 會落在 VibeFlow 的目錄，codex 的 `resume`／`fork` 在該 home 之外看不到這些工作階段。若要保留，需一併 symlink。
3. **同名衝突** — library 與專案有同名 skill 時，計劃訂為專案優先；被跳過的要在 UI 可見，不可靜默。
4. **快照複製會過期** — 本機 skill 更新後 VibeFlow 這份不會跟著變。已確認的取捨；用「重新 import」按鈕降低成本。
5. **prompt 併入 system prompt 會與現有 `systemPrompt` 設定疊加** → 要定順序，避免兩份互相矛盾的指令。

## 已決策：全部納入

`--setting-sources project` 作廢後，claude 端無法排除使用者層 skill（會連帶關掉全域 CLAUDE.md）。決定改為「全部納入」：兩個 agent 都是 library ∪ 專案 ∪ 使用者層。

- 全域 `~/.claude/CLAUDE.md` 保住
- 原始問題解決 —— codex 第一次吃得到專案的 `.claude/skills/` 與 library
- 代價：「不擔心本機佈局」只達成一半。library 是 VibeFlow 自有且可攜，但本機既有 skill 仍會參與

**待實測的副作用**：`~/.codex/config.toml` 裡 `enabled = false` 的 `[[skills.config]]` 是以路徑為 key，symlink 進新 home 後路徑改變，原本被關掉的 skill 可能變成啟用。Phase 2 實作時確認比對的是字面路徑還是解析後路徑；若是字面路徑，`buildCodexHome` 要同步改寫這些 toggle 的 path。

## 未納入本次

- **per-task 選擇**：目前是全域啟用清單。要做到「這張卡才帶某個 skill」需要 `Task` 加欄位 + 另一次 migration
- **library 同步回本機**：VibeFlow → `~/.claude/skills` 的反向寫入，不做（會回到污染本機的老問題）
- **script 當 lifecycle hook 自動執行**：已確認 script 只是給 agent 的工具

## 估時

| Phase | 內容 | 估時 |
|---|---|---|
| 0 | Spike 驗證投遞／抑制機制 | ✅ 已完成 |
| 1 | 儲存層 + 測試 | ✅ 已完成（改為 library/index.json，無需 migration） |
| 2 | 投遞層 + 啟動指令組裝 + 測試 | ✅ 已完成 |
| 3 | Settings Library 分頁 | ✅ 已完成 |
| 4 | 協議瘦身 | 30 分鐘 |
| 5 | 移除 gemini | ✅ 已完成 |

Phase 0 已全部通過（見「Phase 0 實測結果」），可以往下做。

## Runtime check 結果（2026-09-02）

`npm run dev` + CDP（`ws://localhost:5858`，`/home` target）實際驅動，驗證項目：

| 驗證 | 結果 |
|---|---|
| `window.vibeflow.listLibrary()` 等 IPC 可達 | ✅ |
| 三種 kind 各建一筆，`description` 來源正確（skill 讀 frontmatter、其餘讀 index） | ✅ |
| `getLibraryLaunchInfo()` 回傳 pluginDir / codexHome / scripts / promptText | ✅ |
| `plugin/` 只含 manifest 與 library skill | ✅ |
| `codex-home/` 有 auth.json + config.toml symlink、26 個使用者層 skill symlink、library skill 複本 | ✅ — 其中包含 `pm-task` 與 `visual-parity`，codex 第一次拿到 |
| Settings 有「管理 Library」入口，分頁標題與三個分區計數正確 | ✅ |
| 在 UI 取消勾選 `house.md` → `promptText` 立即不再包含其內容 | ✅ |

過程中發現並修掉一個自己造成的缺陷：Library 分頁的「返回設定」重複出現兩次（內文 + footer），已移除內文那一個。

驗證用的 probe 項目已從 dev store 刪除。

## DoD（依 AGENTS.md）

1. `npx tsc --noEmit -p tsconfig.json`
2. `npx tsc --noEmit -p renderer/tsconfig.json`
3. `npm test` — `main/helpers/library.ts` 的行為要進 `test/library.test.mjs`（用 `test/support/repo.mjs` 的 `makeRepo()`）
4. `cd renderer && NODE_ENV=production npx next build`
5. Runtime check：實際建一張 codex 任務與一張 claude 任務，確認 library 與專案自己的 skill 都被載入、使用者層全域 skill 沒被載入
