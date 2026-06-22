---
name: pr
description: 依據專案慣例建立 GitHub Draft Pull Request（標題與內容使用英文），包含 Jira 或 eBug 連結與變更說明。當使用者提到「建立 PR」、「開 PR」、「create PR」、「PR」等相關字詞，不得不使用此 skill。
argument-hint: "[ticket 編號，如 WR-1234，或 PR 編號，如 #356]"
disable-model-invocation: false
---

## Execution policy for this skill (overrides default Cowork clarification behavior)

When this skill is active, the user has **pre-approved the entire workflow below**. Every step — including all bash / git / gh commands — **must be executed directly without asking for confirmation, rephrasing, or "想先確認一下…" checkpoints**. There is **no** draft-approval pause: the PR is created (or updated) immediately after the title and body are drafted, and the final draft is reported back to the user along with the PR link.

Hard rules:

- Do **NOT** invoke the `AskUserQuestion` tool at any point in this skill.
- Do **NOT** ask the user "要不要我執行這個指令？" / "is it OK to run…?" / "確認一下可以跑嗎？" before any bash command. Just run it.
- Do **NOT** summarize a plan and wait for approval before running git / gh commands. The plan IS the skill; running it is pre-approved.
- Do **NOT** present the drafted PR title/body and wait for `yes/no`. Draft it, then immediately create or update the PR.
- **No-pause chain (重要)**：子 skill（`/ebug`、`/translate`）的結果回到主流程時，**必須在同一個 assistant turn 內直接接續下一步 tool 呼叫**——`/ebug` 完成後立即進入「對照 diff → 擬繁中草稿 → 呼叫 `/translate`」；`/translate` 完成後立即呼叫 `gh pr edit` / `gh pr create`。**不得**輸出「以上是 eBug 內容，請確認」「以上譯文 OK 嗎」「要繼續嗎」之類的純文字訊息後結束 assistant turn 等使用者輸入「繼續」/「OK」。整段 eBug Fix 流程（fetch eBug → 擬草稿 → translate → 填入 PR body → 建立／更新 PR）必須在最少的 assistant turn 內走完，子 skill 的輸出不需要使用者再確認一次。
- The only exception: if a **truly blocking** piece of information is missing（例如完全無法從 $ARGUMENTS、分支名稱、或 git diff 推斷 ticket 編號或工作類型）, ask inline in plain text — never via `AskUserQuestion`. After making the PR, the user can refine it via `/pr #PR編號`.

---

請幫我建立一個 GitHub Pull Request，以繁體中文與使用者溝通，PR 標題與內容使用英文撰寫。

## 步驟

### 0. 判斷模式
- 若 $ARGUMENTS 為純數字或 `#數字` 格式，如 `356`、`#356`），視為 **更新既有 PR** 模式 → 跳到步驟 2 分析變更內容，最後在步驟 6 使用 `gh pr edit` 更新該 PR 的標題與內容（而非建立新 PR）
- 否則視為 **建立新 PR** 模式，依正常流程執行

### 1-3.5. 蒐集變更脈絡（自動執行，不需確認）

整段「確認狀態 + base 判斷 + diff + 工作類型/連結 + 子專案 scope」由本地 script 一次算好，
避免 6-8 次 round-trip 與重複查表推理：

```bash
~/.claude/scripts/pr-context.sh [ticket | PR# | #PR]
```

- 傳 ticket（`WR-1234` / `WCL260324-0001`）或不傳 → **建立新 PR 模式**。
- 傳純數字或 `#數字` → **更新既有 PR 模式**（會抓該 PR 真實的 base branch）。

script 的輸出 bundle 直接消費，對應後續步驟所需欄位：

| bundle 欄位 | 用途 |
|---|---|
| `mode` / `pr` | 決定步驟 6 走 create 或 update |
| `base` | 步驟 6 `--base`；diff 已用 `origin/<base>...HEAD` 算好（不寫死 main） |
| `ticket` / `type` / `link` | 步驟 3 工作類型與步驟 5 對應連結（已套規則，不需自己再判斷；`type` 為 `jira`／`ebug`／`none`） |
| `subproject_scope` | 步驟 4 conventional-commit 的 `scope`（已套小寫 kebab）。`clcom-frontend-cl-website` monorepo 依改動的 app 對照（如 `memberzone`、`support-center`，跨多 app 合併為逗號分隔如 `memberzone,purchase`，僅動共用 lib 時為 `(none)`）；**其他單一 app repo 則自動取 repo 名去掉 `clcom-frontend-` 前綴**（如 `clcom-frontend-blog` → `blog`）；皆無法判斷時為 `(none)` |
| `subproject_prefix` | （舊欄位，新標題格式已改用 `subproject_scope`，保留供參考） |
| `WARNINGS` | 在 main、未 commit、未 push 等提醒 |
| `COMMITS` / `CHANGED FILES` / `DIFF` | 撰寫 PR 描述的唯一依據 |

**大 diff 護欄**：當 diff 超過 800 行（可用 `PR_MAX_DIFF_LINES` 調整），`DIFF` 區塊會改成 `--stat` 摘要並標註 `TRUNCATED`。此時不要憑 `--stat` 硬寫描述——依 `CHANGED FILES` 用 `Read` 工具讀取你實際需要理解的檔案片段後再撰寫 PR body。

規則重點（script 已內建，列此僅供理解）：
- **只根據這份 diff 撰寫 PR 描述**，不要描述 base 分支本來就有、不屬於本 PR 的內容。
- 若 `WARNINGS` 顯示在 main branch → 停止並提醒使用者切換分支。
- 子專案 scope 對照（Member Zone=`apps/memberzone`、`libs/member`、`libs/mz`；Support Center、Purchase、
  Purchase Cloud/Login、Download Thanks、Unsubscription、Upgrade、Header；`libs/shared|util|cms|storage|store`
  屬跨子專案共用，scope 留空）script 已套用，標題直接用 `subproject_scope` 即可。
- 若 `ticket` 為 `none` 且無法從 $ARGUMENTS／分支名推斷工作類型，才以 inline plain text 詢問（不使用 `AskUserQuestion`）。
- push 由步驟 6 的 `pr-create.sh` 負責，這裡不需手動 push。

### 4. 撰寫 PR 標題

採 **Conventional Commits** 格式：

```
<type>(<scope>): <簡述做了什麼> (<TICKET>)
```

- **`<type>`** — 由「改動性質」決定，**不是**由 ticket 種類決定：
  - eBug Fix（`type=ebug`）一律用 **`fix`**。
  - Jira（`type=jira`）依實際工作判斷：新功能 `feat`、修 bug `fix`、重構 `refactor`、效能 `perf`、純測試 `test`、build/CI/設定/雜項 `chore`、文件 `docs`。Jira issue type 名稱不決定 `<type>`，看 diff 實際做了什麼。
  - 無 ticket 同樣依改動性質選 type。
- **`(<scope>)`** — 子 app 區分：直接用 bundle 的 `subproject_scope`（monorepo 如 `memberzone`，跨多 app 用逗號 `memberzone,purchase`；單一 app repo 自動取 repo 名去前綴，如 `blog`）。**`subproject_scope` 為 `(none)`（僅動共用 lib、或無法判斷）時，整個 `(scope)` 連同括號一併省略**。
- **`(<TICKET>)`** — ticket 編號放在描述**結尾的括號**內（body 已有完整連結，標題只放可掃描的編號）。**無 ticket 時整個結尾括號省略**。
- 描述部分簡潔易懂，**全標題（含 type/scope/ticket）70 字元以內**，描述用祈使句、開頭小寫、結尾不加句點。

範例：

- Member Zone + Jira 新功能：`feat(memberzone): add referral reward history (WR-1234)`
- Member Zone + Jira 重構、無 ticket：`refactor(memberzone): unify referral API interface`
- 跨多個子 app：`refactor(memberzone,purchase): unify auth interface (WR-1234)`
- 無子專案（共用 lib）+ eBug：`fix: correct cart calculation error (WCL260324-0001)`
- Blog（單一 app repo）+ eBug：`fix(blog): correct cart total drift on discounts (WCL260522-0003)`

規則：

- **標題中嚴禁使用雙引號 `"` 或單引號 `'`**；若需引用識別符、檔名、變數名、字串字面值等，一律改用反引號 `` ` ``（例如：`` refactor(memberzone): replace `useState` with `useReducer` in cart form ``）。建立 PR 前若發現草稿標題含有 `"` 或 `'`，必須改寫成反引號版本後才能執行 `gh pr create` / `gh pr edit`

### 5. 撰寫 PR 內容

依據專案慣例，PR body 採用 **GitHub markdown `##` 區塊標題**（不再使用 `[Bracket]` 標籤）。完整骨架如下，**選用區塊**在沒有對應內容時整段省略：

```
## What
<1-3 句說明這個 PR 做了什麼；多層次變更可用粗體小標 + 巢狀條列分層>

## Why
<說明為什麼要做這個變更；若有「必須維持的關鍵不變量」一併點出>

## How
- <具體實作方式 1>
- <具體實作方式 2>
- ...

## Affected Pages          ← 選用：能對應到頁面路由時才放
- <受影響的頁面路由 1>
- <受影響的頁面路由 2>

## Tests                   ← 選用：有新增／調整測試，或有實際跑驗證時才放
- <測試檔或測試範圍說明>
- All N tests pass; lint clean.

## Request flow            ← 選用：僅在控制流／分支邏輯複雜、值得用圖說明時才放
```mermaid
flowchart TD
    ...
```

<對應連結>

---

## 中文摘要
- <主題式說明 1>
- <主題式說明 2>
- ...
```

**區塊順序（固定）**：`## What` → `## Why` → `## How` → `## Affected Pages`(選用) →（eBug 才有）`## Root Cause` / `## Solution` → `## Tests`(選用) → `## Request flow`(選用) → 對應連結 → `---` → `## 中文摘要`。

**各區塊撰寫原則：**

- `## What` — 先用 1-3 句講「這個 PR 整體做了什麼」，讓 reviewer 不必讀 diff 就掌握全貌。變更有多個層面時，可用粗體小標分層（例如 `- **Middleware**: …` / `- **Page**: …`）。
- `## Why` — 業務動機或技術原因。若這次改動帶有「絕對不能被破壞的不變量」（例如「暫時性錯誤不可被當成永久失敗」），在此明確寫出。
- `## How` — 以 `- ` 條列實作細節，描述「怎麼做到的」。
- `## Affected Pages` — 根據變更檔案路徑推測受影響頁面路由；僅涉及設定檔／工具函式而無法對應頁面時整段省略。
- `## Tests` — 有新增或修改測試、或有實際跑過驗證時才放；列出測試檔／覆蓋的情境，並可附上「All N tests pass; lint clean」之類的結果。沒有測試變更就省略。
- `## Request flow` — **選用**，只有當這次改動的控制流／分支判斷複雜到值得圖解時才放，使用 `mermaid` flowchart。一般小改動不需要。

**`## 中文摘要` 區塊（必填，所有類型 PR 皆需）：**

PR 標題與 `## What`／`## Why`／`## How` 等其餘區塊維持英文，但在整個 PR body 的**最後**（對應連結之後、結尾的 `🤖 Generated with Claude Code` 之前），額外加入一個 `## 中文摘要` 區塊，用**繁體中文**重新描述這次更動。其上方需加一條 `---` divider 與英文內容區隔。規則：

- **不是把 `## How` 逐條翻譯成中文**，而是用 **high-level、主題式**的方式重新分組，說明「這次改了哪些項目、目的是什麼」，讓**沒碰過這份程式碼的人**（PM、QA、其他模組工程師、未來的自己）也能看懂。
- **不需與 `## How` 的條列一對一對應**——可把多條低階實作合併成一個主題，或拆成更貼近使用者／功能視角的分組。
- 以 `- ` 條列，**每點以 1 句為原則**，維持摘要的精簡程度，不要展開成段落。
- 用功能行為與使用者視角的語言，**避免出現只有看過 diff 才懂的程式內部名詞**（元件名、函式名、變數名、hook／reducer／context 欄位名、檔名、行數）。通用技術詞彙（API、cache、token、加密、多語系、環境設定…）可保留。
- 開頭可用一句話點出整體目的，再接主題式條列。

#### Jira Feature 範例：

```
## What
Add GA tracking markers to menu interactions so clicks can be measured in analytics.

## Why
Enhance tracking for menu interactions — previously there was no way to attribute menu clicks in GA.

## How
- Append GA tag value to the id attribute
- Ensure proper tracking for analytics

## Affected Pages
- /blog
- /article

https://cyberlinkcorp.atlassian.net/browse/WR-4234

---

## 中文摘要
- 為選單互動補上分析追蹤標記，讓後續能在 GA 統計使用者點擊行為。
```

#### eBug Fix 範例：

```
## What
Fix a checkout total that drifted from the sum of its line items whenever a discount was applied.

## Why
Users saw an order total that didn't match what their rows added up to, undermining trust at the most sensitive step of the flow.

## How
- Update price calculation to use fixed-point arithmetic
- Add boundary check for discount values

## Affected Pages
- /article

## Root Cause
On checkout, the displayed order total occasionally drifted from the sum of the line items when any discount was applied, so the number users saw didn't match what their rows added up to.

## Solution
The total now always equals the exact sum of every line item, regardless of which discounts are applied.

## Tests
- `__tests__/checkout/total.test.ts` — locks in that the total equals the line-item sum across every discount combination.
- All tests pass; lint clean.

https://ecl.cyberlink.com/Ebug/eBugHandle/HandleMainEbug2.asp?BugCode=WCL260324-0001

---

## 中文摘要
- 修正結帳頁套用折扣時總金額會與各品項加總對不上的問題，確保顯示的總額正確。
```

支援的 eBug 類型：`WCL`、`MYE`、`MYB` 開頭的 ticket 編號

**eBug Fix 額外區塊（必填，僅限 eBug 類型）：**

eBug 類型 PR 在 `## Affected Pages` 之後、`## Tests`／連結之前，額外加入兩個區塊：

- `## Root Cause` — 造成此 bug 的根本原因
- `## Solution` — 如何解決這個問題

**讀者前提：這兩段的讀者是「沒看過這份程式碼的人」**——PM、QA、其他模組的工程師、未來再次接手的自己。所以兩段必須維持 **high-level、行為導向**，描述使用者層面的因果與功能行為差異，**嚴格禁止出現程式內部名詞**，包括但不限於：

- React context / provider / hook / reducer / state 欄位名稱（如 `ChatHistoryContext`、`userResetVersion`、`useEffect`、`dispatch`、`RESET_ALL`）
- 元件名、函式名、檔名、變數名（如 `ImageUploadProvider`、`handleConfirmReset`、`setFile`）
- 內部資料流名詞（如 reducer、action、subscriber、selector、middleware）
- 任何只有看過 diff 的人才看得懂的細節（行數、技術術語的實作層）

如果一段裡出現 backtick 包住的程式識別符，幾乎可以肯定寫得太低階了——退回去用功能行為的語言重寫。技術名詞可保留**通用詞彙**（cache、token、session、validation、modal、route…），但不要綁定到本 repo 內部命名。

**這兩段內容必須先用 `/translate` skill rephrase 過再寫入 PR**，要求言簡意賅、professional engineering English、**每段以 1 句為原則，最多不得超過 2 句**。流程：

1. **先用 `/ebug` skill 取得 eBug 內容**：呼叫 `Skill(skill="ebug", args="<eBug 編號>")`，取得 ticket 的 title、reproSteps、actual result、expected result，以及 `## Comments` 留言討論串（已依時間先後排序）。**務必依序讀完留言**——留言常包含測試者與工程師往返釐清的關鍵脈絡（實際的 key 狀態、預期顯示哪一段訊息、責任歸屬等），是 reproSteps／result 沒寫到、卻決定 root cause 的資訊。這一步是必要的——不可僅憑分支名稱、commit message 或 diff 就臆測 root cause，因為 diff 只呈現「怎麼修」，eBug 內容才描述「使用者實際遇到什麼問題」。**/ebug 結束、其 markdown 結果輸出後，立即在同一個 assistant turn 內進入第 2-3 步擬繁中草稿，再立即呼叫 `/translate`——不得停下來等使用者打「繼續」。**
2. 將 `/ebug` 取回的 ticket 內容與步驟 1 bundle 裡的 `DIFF`（已是 `origin/<base>...HEAD` 的差異）對照，理解：
   - **使用者實際看到的症狀**（來自 eBug 的 reproSteps + actual result）
   - **使用者期望的行為**（來自 eBug 的 expected result）
   - **症狀對應的功能斷裂點是什麼**（哪一條操作路徑沒被處理好，而不是哪段程式碼漏了什麼）
3. 用繁體中文擬出兩段草稿。撰寫時遵守上面「讀者前提」的規則——以使用者操作流程為主詞，**避免出現任何只有看過這份 diff 的人才聽得懂的名詞**：
   - `## Root Cause`：以使用者實際看到的問題為起點，用 high-level 角度說明這條操作路徑哪裡斷掉、導致使用者看到非預期的狀態。重點在「哪個情境沒被處理」，不是「哪個函式漏寫」。
   - `## Solution`：用 high-level 角度說明修好後系統會做什麼，**用使用者觀察得到的行為描述**（例如「重新開始對話後輸入區會恢復乾淨」），而不是描述程式架構或 API 變動。

   **自我檢查**：寫完繁中草稿後，問自己一句「如果今天我是 QA / PM，只讀這兩段，看得懂發生什麼事嗎？」如果其中任何一段需要讀者打開 IDE 才看得懂，就重寫。
4. 呼叫 `/translate` skill 將兩段內容翻譯／潤飾為精煉的英文。在 args 中明確要求譯文「維持 high-level、避免引入程式內部名詞、讀者為非本模組工程師」，避免翻譯過程又把實作細節塞回去。
5. **立即在同一個 assistant turn 內**將翻譯結果填入 PR body 並執行步驟 6 建立／更新 PR。`/translate` 結果一回來就直接接 `gh pr edit` / `gh pr create`，**不得停下來等使用者確認、不得輸出「以上內容是否 OK」之類的 checkpoint、不得等待「繼續」/「OK」指令**。整段 eBug Fix 流程（fetch eBug → 擬草稿 → translate → 填入 PR body → 建立 PR）都屬於本 skill 開頭「pre-approved workflow」與「No-pause chain」hard rule。

若 `/ebug` skill 回傳查無此 eBug 或 webhook 失敗，inline plain text 告知使用者，並改為憑 diff 與分支名稱推測 root cause；同時在兩段草稿中明確標註「（未取得 eBug 原文，依 diff 推測）」。

Jira Feature 與其他類型 **不需要** 這兩個區塊。

規範：
- PR body 一律使用 `##` markdown 區塊標題（不用 `[Bracket]`）
- PR 標題與內容以英文撰寫，**唯一例外**是 `## 中文摘要` 區塊使用繁體中文
- `## What` 先用 1-3 句講整體做了什麼；`## Why` 說明業務動機或技術原因（含關鍵不變量）；`## How` 以 `- ` 條列實作細節
- `## 中文摘要` 放在整個 PR body 的最後（對應連結之後、結尾 `🤖 Generated with Claude Code` 之前），上方加一條 `---` divider；以 high-level、主題式的繁體中文重新描述本次更動（所有類型 PR 皆必填），規則見上方「`## 中文摘要` 區塊」說明；不逐條翻譯 `## How`，每點以 1 句為原則
- `## Affected Pages`（選用）根據變更的檔案路徑自動推測可能影響的頁面路由，以 `- ` 條列，例如修改 `app/blog/` 下的檔案 → `/blog`；修改 `components/` 或 `composite/` → 列出所有引用該元件的頁面。若變更僅涉及設定檔、工具函式等無法對應特定頁面的檔案，可省略此區塊
- `## Tests`（選用）僅在有新增／修改測試或有實際跑驗證時放，列出測試範圍與結果；無測試變更則省略
- `## Request flow`（選用）僅在控制流／分支邏輯複雜、值得圖解時放，使用 `mermaid` flowchart；一般小改動不需要
- Jira Feature 附上 Jira 連結；eBug Fix 附上 eBug 連結並補上 `## Root Cause` / `## Solution` 兩段（皆需經 `/translate` 處理，維持 high-level 角度）
- 若無 ticket，省略連結即可

### 6. 草擬與執行（全自動，不需確認）

#### 6a. 準備
- PR body 結尾需加上 `🤖 Generated with [Claude Code](https://claude.com/claude-code)`
- 將完整 PR body 寫入暫存檔，用 `--body-file` 傳入可保留多行格式與反引號，避免 shell 轉義問題。
- **暫存檔路徑必須唯一**，使用 `/tmp/pr-body-<PR# 或 ticket>.md`（無法判斷時退而用分支名，如 `/tmp/pr-body-<branch>.md`）。**禁止寫死共用的 `/tmp/pr-body.md`**——該檔在前一次跑 `/pr` 後會殘留，Write 工具拒絕覆蓋未在本 session 讀過的既有檔案，會回 `Error writing file`。改用唯一檔名即可根治；若仍需覆寫既有檔，先 `Bash(rm -f <該檔>)` 再用 Write 建立。

#### 6b. 執行

草稿完成後立即執行，**不停下來確認**。建立／更新 PR、self-assign 由本地 script 一次完成；建立模式也會自動 push。

（以下 `<body-file>` 為步驟 6a 建立的唯一暫存檔路徑，如 `/tmp/pr-body-<PR#/ticket/branch>.md`。）

**建立新 PR 模式：**
```bash
~/.claude/scripts/pr-create.sh --title "<標題>" --body-file <body-file> --base <base>
```
（`<base>` 用步驟 1 bundle 的 `base` 欄位；省略 `--base` 則自動用 repo 預設分支。）

**更新既有 PR 模式：**
```bash
~/.claude/scripts/pr-create.sh --title "<標題>" --body-file <body-file> --update <PR#>
```

script 會在 stdout 印出 PR 連結。最後回報最終 PR 標題、內容摘要與該連結（讓使用者事後仍能檢視草稿）。
若 script 非零退出，直接回報其 stderr 與建議。
