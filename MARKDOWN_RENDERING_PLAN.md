# Markdown 渲染統一計劃

> **狀態：已實作完成。** 本文件保留為決策記錄。實作過程中相對本計劃的兩處偏差記在 §10。

**範圍**：C —— unified 取代手寫 parser + rehype 生態 + 統一所有渲染路徑

已定案的決策：

| 項目 | 決定 |
|---|---|
| 舊留存檔 | 已寫出的 `<title>-<createdAt>.html` 不動，只有之後新產生的走新 pipeline |
| `rehype-raw`（內嵌 HTML） | **不做**。改為補 iframe `sandbox`（§6） |
| sub-agent `prompt` | **保持 `<pre>` 逐字**，只有 `result` 轉 markdown（§5） |

---

## 0. 現況落差（已實測驗證）

把 `plan-html.ts` 的 `mdToHtml` 抽出來實跑（`node --experimental-strip-types`）確認的行為：

| 輸入 | 現在的輸出 | 問題 |
|---|---|---|
| `> quoted line` | `<p>&gt; quoted line</p>` | blockquote 完全沒解析，`wrapDocument` 的 `blockquote` CSS 是死的 |
| `![alt](url)` | `!<a href="url">alt</a>` | link regex 先吃掉 `[alt](url)`，圖片全壞 |
| `- a\n  - b\n    - c` | 三個同層 `<li>` | `^(\s*)-` 有抓縮排但沒用，巢狀攤平 |
| `line one\nline two` | 兩個 `<p>` | 段落內換行被切開 |
| `see https://example.com now` | 純文字 | GFM autolink 未實作 |
| `- item\n\n  ```js\n  a\n  ```` | ` ``` ` 以字面輸出 | 清單內 fenced code 直接爆開 |
| `Title\n=====` | 兩個 `<p>` | setext heading 未實作 |
| `3. three` | `<ol>` 從 1 開始 | 不保留 `start` |
| `note[^1]` | 純文字 | footnote 未實作 |
| `text <kbd>x</kbd>` | `&lt;kbd&gt;` | 內嵌 HTML 全轉義（**目前這是安全機制，見 §5**） |

做對的部分（換 pipeline 時不能退步）：GFM table（含 `:---:` 對齊、code span 內 `|` 的 escape）、task list、strikethrough、fenced code + language class、hr。

另外兩個獨立問題：

1. **`prose` class 是空的。** `MarkdownContent`（[renderer/components/task-workspace-panel.tsx:289](renderer/components/task-workspace-panel.tsx:289)）掛 `prose prose-invert prose-sm`，但 `@tailwindcss/typography` 沒安裝，`globals.css` 只有 `@import 'tailwindcss'` 沒有 `@plugin`。Tailwind v4 不認識 `prose`，產不出 CSS。remark-gfm 解析正確的 `<table>` / `<ul>` 全是裸標籤。
2. **完全沒有 rehype plugin。** 沒有 code highlight、沒有 heading anchor。

---

## 1. 依賴

全部進 **`devDependencies`**，理由如下（偵察 nextron 打包行為後確認）：

- nextron 的 main-process webpack config 是 `externals: [...Object.keys(pkg.dependencies)]` — **只有 `dependencies` 會被 externalize，其餘一律 bundle 進 `app/main.js`**。
- `electron-builder.yml` 的 `files` 只收 `package.json` + `app`；production `dependencies` 由 electron-builder 自動帶入 node_modules。
- 所以純 JS 的 unified/remark 系列放 `devDependencies` → 打包進 main bundle，**不增加 shipped node_modules 體積**。這與 `react-markdown` / `remark-gfm` 已在 `devDependencies` 的既有慣例一致。
- 前例：`electron-store@11` 是 ESM-only 且已正常運作，證明這條路徑吃得下 pure-ESM 套件（`pkg.type === 'module'` → webpack `outputModule: true`）。

新增清單：

```
@tailwindcss/typography    renderer prose 樣式
unified                    pipeline 骨架（main）
remark-parse               md → mdast
remark-rehype              mdast → hast
rehype-stringify           hast → html string
rehype-highlight           code highlight（main + renderer 共用）
lowlight                   rehype-highlight 的 highlight 引擎，用來限制語言集合
remark-breaks              單換行 → <br>（見 §2 決策）
```

已有、不需新增：`remark-gfm`、`react-markdown`。

**不裝**：`rehype-raw`、`rehype-sanitize` — 已定案不支援內嵌 HTML（§6）。

**風險**：這台 npm 走 approved-registry gate，上述套件可能需要先過審才裝得下來。Phase 1 第一步就是 `npm install`，裝不下來要先解這件事，後面全部卡住。lock 檔會變動。

**不採用 shiki**：對「自帶 CSS 的獨立 HTML 檔」來說 shiki 的 inline style 比較省事，但它把所有 grammar + theme 一起帶進 bundle，體積代價太大，且 API 是非同步的。改用 rehype-highlight + lowlight，只註冊 `ts js tsx jsx json bash css html md diff python` 這幾種，highlight 顏色手寫一小段 CSS 綁現有 token。

---

## 2. Phase 1 — 讓已經裝好的 GFM 看得見（renderer 樣式）

**檔案**：`package.json`、`renderer/styles/globals.css`

1. 裝 `@tailwindcss/typography`。
2. `globals.css` 在 `@import 'tailwindcss';` 之後加 `@plugin "@tailwindcss/typography";`。
3. **不能只裝 plugin 了事。** 這個 app 是單一固定 dark theme（`:root` 直接定義 dark token，沒有 light/dark 切換），所以：
   - `prose-invert` 語義上不對，應該把 typography 的 CSS 變數綁到專案 token：`--tw-prose-body: var(--foreground)`、`--tw-prose-headings`、`--tw-prose-links: var(--primary)`、`--tw-prose-code`、`--tw-prose-th-borders: var(--border)`、`--tw-prose-td-borders: var(--border)`、`--tw-prose-quote-borders`、`--tw-prose-bullets` 等。
   - 否則表格框線、引言邊條會吃 typography 預設灰，跟 Notion-dark token 不搭。
4. `MarkdownContent` 的 class 從 `prose prose-invert prose-sm` 改成 `prose prose-sm`（token 覆寫已處理暗色）。

**驗證**：
```bash
cd renderer && NODE_ENV=production npx next build
```
外加實跑 app，開一張 description 含 table + 巢狀清單的卡片肉眼確認。

---

## 3. Phase 2 — main 的 plan pipeline 換成 unified

**新檔** `main/helpers/markdown.ts`：

```ts
export async function renderMarkdownToHtml(md: string): Promise<string>
```

pipeline：`remark-parse` → `remark-gfm` → `remark-breaks` → `remark-rehype`（`allowDangerousHtml: false`）→ `rehype-highlight`（lowlight 限定語言）→ `rehype-stringify`。

**`remark-breaks` 的決策**：GFM 規格本身**不含**單換行轉 `<br>`（那是 GitHub comment 的行為，不是 `.md` 檔的）。不加 `remark-breaks` 的話，`line one\nline two` 會正確合併成同一個 `<p>` 中間一個空白 —— 這比現在的「兩個 `<p>`」正確，但跟 agent 寫 PLAN.md 時的視覺預期不一致（agent 常靠換行斷句）。**建議加**，讓渲染貼近作者意圖。

**改檔** `main/helpers/plan-html.ts`：

- 刪除 `inline`、`escHtml`、`splitTableRow`、`tableAlignments`、`tableCell`、`mdToHtml`（約 230 行）。
- `generatePlanHtml` 改為 `wrapDocument(await renderMarkdownToHtml(md))`（本來已是 async）。
- `wrapDocument` 的 CSS 必須跟著改，以下是**會靜默壞掉**的點：
  - **task list 選擇器換名。** 現在的 CSS 綁 `ul.task-list` / `li.done`；remark-gfm 產出的是 `<ul class="contains-task-list">` + `<li class="task-list-item">`，且 **`li.done` 不存在**（打勾刪除線不是 GFM 標準）。要改成 `ul.contains-task-list` / `li.task-list-item`，刪除線用 `li.task-list-item:has(input:checked)`（Electron 41 = 新版 Chromium，`:has()` 可用）。漏改的話 task list 會變成有 bullet 的普通清單。
  - 補 `img { max-width: 100%; height: auto }`（圖片以前是壞的，現在會真的渲染出來）。
  - 補巢狀清單的 `ul ul` / `ol ol` 間距。
  - 補 footnote 區塊：`.footnotes`、`sup a`、`.data-footnote-backref`。
  - 補 hljs class 配色（一小段，用現有 hex token）。
  - `blockquote` CSS 已存在，這次終於會被用到 —— 不用改。

**新測試** `test/markdown.test.mjs`（`node:test` + `node:assert/strict`，harness 直接 import `.ts`）：把 §0 表格那 10 個 case 全部寫成斷言，外加「不能退步」的 5 個（table 對齊、code span 內 `|`、task list、strikethrough、fenced code language class）。

**驗證**：
```bash
npx tsc --noEmit -p tsconfig.json
npm test
```

---

## 4. Phase 3 — renderer 對齊同一組 plugin

同一份 plugin 清單套到 `MarkdownContent`：`remarkPlugins={[remarkGfm, remarkBreaks]}`、`rehypePlugins={[[rehypeHighlight, { languages }]]}`。

- hljs 配色寫進 `globals.css`，色值與 `wrapDocument` 那份保持同源（同一組 token hex）。
- 現有的 `components` override 已相容：`code` override 用 `cn(className, ...)` 合併，rehype-highlight 加的 `hljs language-x` 不會被吃掉；`pre` override 也不衝突。

兩端無法共用同一份 code（renderer 產 React tree、main 產字串），**共用的是 GFM 語義（同一組 remark plugin 與設定）**，樣式各自維持（renderer 靠 typography，main 靠 `wrapDocument` 的 inline CSS）。這點要寫進 `AGENTS.md` 的 conventions，避免之後兩邊漂移。

---

## 5. Phase 4 — 統一其餘路徑

**先抽元件**：`MarkdownContent` 目前是 `task-workspace-panel.tsx` 的私有函式，要抽到 `renderer/components/markdown-content.tsx` 才能被別的元件用。**這動到共用元件契約** → 依規則加一個「檢查所有使用端」步驟（目前只有 1 個呼叫點，抽完會變 4 個）。

| 路徑 | 現在 | 改成 |
|---|---|---|
| Task description [:239](renderer/components/task-workspace-panel.tsx:239) | `MarkdownContent` | 不變（Phase 1 已修樣式） |
| Artifact 文字預覽 [:648](renderer/components/task-workspace-panel.tsx:648) | `<pre>` | 檔名是 `.md` / `.markdown` → `MarkdownContent`；其他副檔名保持 `<pre>` |
| Memory checkpoint `outcome` [:447](renderer/components/task-workspace-panel.tsx:447) | `whitespace-pre-wrap` | `MarkdownContent compact` |
| Sub-agent `result` [sub-agent-drawer.tsx:96](renderer/components/sub-agent-drawer.tsx:96) | `<pre>` | `MarkdownContent compact` |
| Sub-agent `prompt` 同上 | `<pre>` | **保持 `<pre>`**（見下） |

**sub-agent `prompt` 不轉 markdown（已定案）。** 它是原封不動送給 sub-agent 的指令原文，空白與縮排有語義，而且旁邊那顆 `CopyButton` 要能逐字複製出來。渲染成 markdown 會讓看到的與實際送出的不一致。`result` 是 agent 寫給人看的散文，轉 markdown 合理。

**Artifact 判斷用 `artifact.name` 的副檔名**，不去改 main 的 `ArtifactKind`（`'image' | 'text' | 'binary'`）契約 —— 那是跨 IPC 的公開型別，為了這件事升級契約不值得。`truncated` 的提示文字保留。

---

## 6. Phase 5 — 安全性

偵察發現：plan HTML 是用 **`<iframe srcDoc={html}>` 且沒有 `sandbox` 屬性**（[task-workspace-panel.tsx:376](renderer/components/task-workspace-panel.tsx:376)）。srcDoc iframe 預設與父頁同源，也就是說 iframe 內的 script 能碰到 `parent.window`，而這個 renderer 的 preload 掛著 `window.vibeflow`。

現在之所以安全，是因為 `escHtml` 把 PLAN.md 裡所有 HTML 都轉義掉了 —— **靠轉義單獨撐住**。

因此：

1. **iframe 補 `sandbox=""`**（不給 `allow-scripts`、不給 `allow-same-origin`）。plan HTML 是純內容，不需要 script。這是無論如何都該做的加固，也順手把「未來有人誤加 raw HTML 支援」的風險關掉。
2. **`rehype-raw` 不加**（已定案，對 C 字面範圍的收窄）：
   - PLAN.md / description / artifacts 都是 Claude Code agent 寫的，而 agent 可能把它讀進來的第三方內容（issue、網頁、repo 檔案）夾帶進去 → 屬半信任來源。
   - `remark-rehype` 預設 `allowDangerousHtml: false`，維持與現在 `escHtml` 同等的保護。
   - 真的要支援內嵌 HTML，必須 **`rehype-raw` + `rehype-sanitize` 成對加**，並且 iframe 一定要先 sandbox。
   - 實務上 agent 產出的 markdown 幾乎不用內嵌 HTML，收益低、代價明確。

---

## 7. 不做

- 舊 `<title>-<createdAt>.html` 留存檔不重新產生（已定案）。它們是自帶 CSS 的完整文件，可獨立開啟。
- 不引入 linter（專案刻意沒有）。
- 不用 shiki（見 §1）。
- 不改 `ArtifactKind` / `ArtifactContent` 的 IPC 契約。
- 不加 heading anchor（`rehype-slug` / `rehype-autolink-headings`）—— plan 是短文件、在 iframe 裡，錨點沒有使用場景。要的話另開。

---

## 8. Definition of Done

依 `AGENTS.md`：

1. `npx tsc --noEmit -p tsconfig.json` clean（`main/` 有動）
2. `npx tsc --noEmit -p renderer/tsconfig.json` clean（`renderer/` 有動；先 `rm -rf renderer/.next` 避免幽靈 duplicate-type 錯誤）
3. `npm test` green — 含新的 `test/markdown.test.mjs`；`test/ui-consistency.test.mjs` 會掃新增的 `markdown-content.tsx`，要符合 radius ladder 等既有規則
4. `cd renderer && NODE_ENV=production npx next build` 成功
5. 執行期驗證：`npm run dev`，實際開一張任務卡確認
   - Plan 分頁：blockquote、圖片、巢狀清單、清單內 code block、裸 URL、task list 打勾刪除線、table 對齊全部正確
   - description / artifact `.md` / sub-agent result / memory outcome 四個路徑的樣式一致
   - 手機 remote 收到的 plan HTML 仍能正常顯示（走同一份字串）
   - 收工 `pkill -f "electron ."; pkill -f nextron; pkill -f "next dev -p 8888"`

---

## 9. 階段順序與可中斷點

Phase 1 →（獨立可交付：現有 GFM 立刻看得見）

Phase 2 + 測試 →（獨立可交付：plan 渲染修好）
Phase 3 →（兩端語義對齊）
Phase 4 →（其餘路徑統一）
Phase 5 →（加固）

每個 Phase 結束都是乾淨的可中斷點。Phase 1 和 Phase 2 之間沒有依賴，但 Phase 3 依賴 1+2，Phase 4 依賴 3。

---

## 10. 實作結果與相對本計劃的偏差

全部 5 個 Phase 已實作。相對計劃的兩處偏差：

### 10.1 表格中 code span 內的未轉義 `|` 行為改變（無法避免）

舊的手寫 parser 在切表格欄位時會追蹤 `` ` `` 狀態，所以 `` | `x|y` | z | `` 被當成兩欄。**這是非標準的寬鬆行為** —— GFM 規格要求表格內的 `|` 一律要用 `\|` 轉義，即使在 code span 裡也一樣。remark-gfm 照規格走，所以同樣的輸入現在會切成三欄。

影響：既有 PLAN.md 若在表格的 code span 裡寫了未轉義的 `|`，重新產生的 HTML 會多出欄位。修法是在來源用 `\|`。已在 `test/markdown.test.mjs` 用轉義版本固定正確行為。這是往規格收斂，不是退步。

### 10.2 renderer 的表格樣式需要額外補（計劃未預料）

計劃假設裝上 typography 後表格樣式就齊了。實際用 CDP 量出來：typography 只給 `thead` 和每個 `tbody tr` 一條下框線（橫線式表格），th/td 四邊都是 0px —— 因為 Tailwind preflight 把所有元素的 `border-width` 歸零，typography 只補了那兩處。

結果是 renderer 的表格（橫線）與 plan 獨立文件的表格（完整格線 + th 底色）長得不一樣，違反「四個路徑樣式一致」這條 DoD。因此在 `globals.css` 額外補了 `.prose th, .prose td` 的格線、`.prose thead th` 的底色、偶數列斑馬紋，與 `plan-html.ts` 的表格 CSS 對齊。

### 10.3 已驗證與未驗證

**已驗證**：
- `npx tsc --noEmit` 兩個 project 皆乾淨
- `npm test` 125/125（含新增的 `test/markdown.test.mjs` 17 個 case）
- `cd renderer && NODE_ENV=production npx next build` 成功；建置產物的 CSS 確認含 typography 的 86 條 `:where()` 規則、`.prose` token 綁定、`.prose-xs`、hljs 配色、表格格線
- main webpack bundle（`nextron/bin/webpack.config.cjs`）成功，546 KiB，unified/remark/highlight.js 都順利 bundle 進 `app/main.js`
- 用一份涵蓋所有落差的 PLAN.md fixture 實跑 `generatePlanHtml`，22 個標記全中（blockquote、圖片、三層巢狀、task list class 與 checked 狀態、`ol start`、三種對齊、autolink、`del`、footnote section、ts/bash/diff 三種高亮、清單內 code block、`<br>`、`sr-only`、`:has()`），且 `<script>` 確實被移除
- `npm run dev` + CDP 實測 renderer 的 computed style：typography 規則生效、token 綁定（連結 `#4c9bf5`、本文 `#a1a1a1`、th 框線 `--input`）、`prose-sm` 14px／`prose-xs` 12px、task list 無 bullet、打勾項 `line-through`、hljs keyword 藍／string 綠、表格 `display:block` + `overflow-x:auto` + 完整格線 + th 底色

**未驗證**：
- React 端 `MarkdownContent` 在真實任務卡上的渲染。dev store 目前 0 張任務，建一張會實際 provision git worktree 並寫入使用者的 store，超出這次請求的範圍。CSS 層與 pipeline 層都已分別驗過，缺的是兩者在真實元件上合起來那一次。
- 手機 remote 的 plan 顯示。它吃的是 `getPlanHtml` 回傳的同一份字串（`use-remote-host.ts`），該字串已用 fixture 驗過，但沒有實際連手機。
