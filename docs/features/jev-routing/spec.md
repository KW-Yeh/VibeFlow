# Spec：Jev 模型與 effort 路由

- 狀態：已確認
- Ticket：尚無
- 需求來源：使用者需求（2026-11-03）：卡片未指定模型時由 Jev 判斷複雜度並選模型與 effort；無法判定時先由高思考模型補 context；master 派發的 slave 卡同邏輯；slave 卡不套用 system prompt，只遵從 master 指派的任務與進度。相關既有設計：[master-cards spec](../master-cards/spec.md)。
- 更新日期：2026-11-03
- 確認紀錄：2026-11-03 使用者確認範圍決策——無法判定時以唯讀 scout run 補 context；scout 分析同時存到卡片並餵給主 agent；Jev 只在該卡的 agent CLI 型錄內選模型。slave 判定沿用 main 上既有的 `masterId`（使用者指示改依 master-cards 設計）。2026-11-03 使用者確認整份 Spec，待確認事項依提議定案：scout 逾時 5 分鐘；master 卡未指定模型時也由 Jev 選，但不跑 scout。

## 問題與目標

目前 Jev 只替 `effort: auto` 的卡片選 effort，模型一律交給卡片或 CLI 預設（`ef3ee80` 從先前的「Jev 選模型」縮減而來）。使用者希望未指定模型的卡片也由 Jev 依任務複雜度挑模型，讓簡單任務用便宜模型、困難任務用強模型；Jev 無法判定時，先讓高思考模型讀過 repo 補充 context，再交給 Jev 決定。

master 卡用 `task create --master` 派出的 slave 卡（`Task.masterId`）也要走同一套邏輯。目前 slave 啟動時，system prompt 是「使用者在設定裡的 custom system prompt + `slaveSystemPrompt()`」；slave 應該只聽 master 的，不該套用使用者寫給一般卡片的 custom system prompt。

## 範圍

### 本次包含

- 未指定模型的卡片（一般卡與 slave）在啟動時由 Jev 選擇模型；`effort: auto` 時同時選 effort。
- Jev 判定為「無法判定」時，先以該 agent 型錄中最強的模型做唯讀 scout run，再請 Jev 決定。
- scout 分析存到卡片並附在主 agent 的第一次啟動 prompt 中。
- slave 卡（有 `masterId`）啟動時不套用使用者的 custom system prompt，只保留 `slaveSystemPrompt()`。
- `masterSystemPrompt()` 的派工說明改為：預設不加 `--model`／`--effort`，交給 Jev；只有任務明確需要特定模型時才指定。
- 看板卡片與工作區面板顯示 Jev 的路由階段、選定的模型與 effort，以及 scout 分析。

### 本次不包含

- 跨 agent CLI 選擇（Claude ↔ Codex）；Jev 只在卡片原本的 agent 型錄內選。
- 在既有 agent session 中途重新路由；路由只發生在一次新的 run 開始時。
- 改變 master／slave 的歸屬、通知、`task send` 與 mailbox 行為。
- master 卡自身的 system prompt 組成（仍為 custom system prompt + `masterSystemPrompt()`）。
- 新增 Settings 選項（例如指定 scout 模型）；修改 Jev API key 的儲存方式。

## 行為

### 何時呼叫 Jev

| 卡片設定 | Jev 有 key | 行為 |
| --- | --- | --- |
| 未指定模型，effort `auto` | 是 | Jev 選模型 + effort（可能先跑 scout） |
| 未指定模型，手動 effort | 是 | Jev 只選模型（可能先跑 scout）；手動 effort 依選定模型 clamp |
| 指定模型，effort `auto` | 是 | 維持現況：Jev 只依該模型選 effort，不跑 scout |
| 指定模型，手動 effort | — | 不呼叫 Jev |
| 未指定模型 | 否 | 維持現況：CLI 預設模型，不帶 effort flag；卡片顯示原因 |

slave 卡套用完全相同的規則。master 卡見「Master 卡」一節。

### 路由流程

| 情境 | 預期行為 |
| --- | --- |
| 卡片開始新 run（非 resume）且需要 Jev | 卡片顯示 `routing`，階段依序為「判斷中 →（補充 context 中）→ 選擇中」；agent 等路由結束才啟動。由 UI 拖曳或 `task start` 啟動都一樣 |
| 第一次 Jev 請求 | 傳送卡片 prompt（最多 12,000 字）、agent、候選模型；Jev 回答複雜度（`simple` / `moderate` / `complex` / `unclear`）、模型與 effort |
| 複雜度不是 `unclear` | 直接採用 Jev 選的模型與 effort |
| 複雜度為 `unclear` | 以候選中最高能力層級的模型、effort `high`（依模型 clamp）在 worktree 執行唯讀 scout，然後帶著 scout 分析做第二次 Jev 請求；這次不提供 `unclear` 選項 |
| scout 的工作 | 讀 repo，不修改檔案；產出受影響範圍、不明確的需求、主要風險與驗證方式；輸出上限 8,000 字 |
| 候選模型 | 該 agent 的模型型錄，依能力分成低／中／高三層，每層取型錄中第一個合法 id（沿用 `3df0141` 的 tier 規則） |
| effort 候選 | 所有候選模型所支援 effort 的聯集；Jev 的答案依選定模型 `clampEffort`；選定模型不支援 effort 時不帶 flag |
| Jev 答案不在候選內 | 視為失敗，走 fallback |
| 結果紀錄 | 卡片記錄 `jevRoute.model`、`jevRoute.effort`、`jevRoute.complexity`；有 scout 時另記 `scoutModel` 與 `context`。`Task.model` 保持未指定、`Task.effort` 保持原值 |
| 主 agent 啟動 | 使用 `jevRoute.model` 與 effort；有 scout 分析時，以「前置分析（<scout 模型>，僅供參考）」段落附加在卡片 title 與描述之後 |
| resume | 沿用上次的路由結果與模型，不重新呼叫 Jev 或 scout，也不重送 prompt |
| 重新開始（新 run） | 清除舊路由，重新判斷 |
| `task show`／`task list` | 回傳的卡片資訊包含路由出的模型與 effort，讓 master 知道 slave 實際用了什麼 |

### Fallback

| 失敗點 | 結果 |
| --- | --- |
| 沒有 key、Jev 請求失敗或回傳非法答案（第一次請求） | CLI 預設模型；effort `auto` 時不帶 effort flag；卡片顯示原因 |
| scout 失敗、逾時或沒有輸出 | 以 scout 模型、effort `high`（clamp 後）啟動；卡片顯示原因（任務已被判定為不明確，採取保守選擇） |
| 第二次 Jev 請求失敗 | 同上，以 scout 模型與 `high` 啟動，並附上已取得的 scout 分析 |
| 型錄為空 | CLI 預設模型，顯示原因 |
| host 在 `routing` 中途當掉 | 殘留的 `routing` 紀錄不被採用，下次啟動重新判斷（維持現況） |

### Slave 卡的 system prompt

| 卡片 | system prompt |
| --- | --- |
| 一般卡（無 `masterId`、非 master） | 使用者的 custom system prompt（維持現況） |
| slave 卡（有 `masterId`） | **只有** `slaveSystemPrompt()`；不含使用者的 custom system prompt |
| master 卡 | custom system prompt + `masterSystemPrompt()`（維持現況） |

- Claude：`--append-system-prompt` 只帶 `slaveSystemPrompt()`；Codex：併入 prompt 的也只有它。
- 判斷依據是啟動當下的 `masterId`：`task update --master none` 拿掉 master 之後再啟動，就回到一般卡行為。
- agent CLI 自己讀取的 `CLAUDE.md`／`AGENTS.md`／skills 不受影響。

### Master 卡

| 情境 | 預期行為 |
| --- | --- |
| master 卡未指定模型 | Jev 照常判斷模型與 effort，但不跑 scout（master 不屬於任何 repo，工作目錄只是筆記區）；Jev 回答 `unclear` 時直接採用最高層級模型與 `high` |
| master 派工 | `masterSystemPrompt()` 改成：預設不加 `--model`／`--effort`，讓 Jev 依任務決定；任務明確需要特定模型或 effort 時才指定 |

## 驗收條件

- [ ] AC-1：未指定模型、effort `auto` 的卡片，在 Jev 回答 `moderate` + 某型錄模型 + `medium` 時，以該模型與 `--effort medium`（Claude）／`model_reasoning_effort="medium"`（Codex）啟動，且不跑 scout。
- [ ] AC-2：Jev 第一次回答 `unclear` 時，以最高層級模型在 worktree 執行唯讀 scout（Claude `-p --permission-mode plan`、Codex `exec --sandbox read-only`），第二次請求的 state 帶有 scout 分析且沒有 `unclear` 選項，主 agent 的 prompt 包含該分析。
- [ ] AC-3：scout 失敗時，卡片以 scout 模型與 `high`（clamp 後）啟動，`jevRoute.reason` 記錄原因。
- [ ] AC-4：未指定模型、手動 effort `low` 的卡片，Jev 選模型後 effort 依該模型 clamp；選定模型不支援 effort 時不帶 flag。
- [ ] AC-5：已指定模型的卡片行為與目前一致（只選 effort 或不呼叫 Jev），不跑 scout。
- [ ] AC-6：resume 沿用路由出的模型，不再呼叫 Jev；重新開始後重新路由。
- [ ] AC-7：由 master 派發、未指定模型的 slave 卡，經 `task start` 啟動時走與 AC-1～AC-3 相同的路由；`task show` 顯示路由出的模型與 effort。
- [ ] AC-8：設定了 custom system prompt 時，slave 卡的 Claude／Codex 啟動命令只含 `slaveSystemPrompt()`、不含 custom system prompt；一般卡與 master 卡仍含 custom system prompt。
- [ ] AC-9：master 卡未指定模型時 Jev 會選模型，回答 `unclear` 時不跑 scout、直接用最高層級模型；`masterSystemPrompt()` 的派工說明不再預設帶 `--model`／`--effort`。
- [ ] AC-10：看板卡片與工作區面板顯示路由階段、選定的模型與 effort，以及 scout 分析。
- [ ] AC-11：兩份 typecheck、`npm test`、`npm run build:web`、`npm run test:e2e` 通過，並在 Web UI 實際驗證一次 Jev 路由（fake router 或真 key）。

## 限制與依賴

- 依賴 TypeSafe `/v1/systemone` 的 choice 問答格式（與現行相同）、agent CLI 的模型型錄（`agent-models.ts`），以及 master-cards 的 `masterId`／`slaveSystemPrompt()`／`task start`。
- 模型層級是依名稱推斷（haiku／mini／flash → 低；opus／pro → 高），不是 provider 價格；型錄或命名改變時可能分錯層。
- scout 會消耗一次強模型 run，且讓 agent 晚幾分鐘啟動（逾時上限 5 分鐘）。master 一次派出多張不明確的 slave 時，會同時跑多個 scout。
- scout 需要 worktree，因此路由在 provisioning 之後執行（與現行 `pty:start`／`startTask` 順序一致）。
- 需同步更新 AGENTS.md「What a launch sends」的例外說明。

## 待確認事項

無
