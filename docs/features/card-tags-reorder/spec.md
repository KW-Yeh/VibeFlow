# Spec：卡片排序與狀態標籤

- 狀態：已確認（2026-11-23）
- Ticket：尚無
- 需求來源：使用者對話（2026-11-23）
- 更新日期：2026-11-23
- 確認紀錄：2026-11-23 使用者確認整份 Spec（「確認，寫 plan」）。先前決策：看板各欄也要能排序；看板與工作頁清單共用同一順序；tag 綁定顏色；從清單刪除 tag 時一併從卡片移除。待確認事項採預設值。

## 問題與目標

1. 卡片的排列順序目前無法調整：看板只能跨欄拖拉，同一欄內不能換位置；工作頁左側的進行中清單完全不能拖拉。使用者想依自己的優先順序排列卡片。
2. 卡片沒有地方標示「卡在哪裡」，例如「等待 JFrog form 簽核」「等待 PL review PR」。使用者想用可重複使用、帶顏色的 tag 一眼看出每張卡的外部狀態，並讓卡片裡的 AI 透過 CLI 自動貼上或拿掉 tag。

## 範圍

### 本次包含

- 看板三欄（Backlog / In Progress / Done）欄內拖拉排序。
- 工作頁左側進行中清單拖拉排序，與看板 In Progress 欄共用同一順序。
- 全域 tag 清單：新增、改名、改顏色、刪除。
- 卡片上的 tag：一張卡可有多個 tag；從用過的 tag 中挑選套用，或當場新增。
- 卡片進入 Done 時自動清除其 tag。
- CLI 支援上述所有 tag 操作與卡片排序。

### 本次不包含

- 依 tag 篩選或分組看板（之後可另開功能）。
- 依 tag 自動觸發任何動作（通知、啟動卡片等）。
- TUI 的排序與 tag 編輯介面（TUI 只需能顯示 tag 則列為可選，見待確認事項）。
- 跨欄拖拉規則的任何變動（`board-moves.ts` 維持原樣）。

## 行為

### 排序

| 情境或觸發條件 | 預期行為 |
| --- | --- |
| 在看板某欄內，把一張卡拖到同欄另一張卡的上方或下方 | 放開後卡片停在該位置；重新整理頁面、重開 host 後順序保留 |
| 拖拉過程中 | 顯示插入位置指示線；不合法的位置不顯示 |
| 在工作頁清單拖拉一張進行中的卡 | 順序改變，看板 In Progress 欄同步變成相同順序（反之亦然） |
| 拖動 master 卡 | 它的子卡在工作頁清單中跟著 master 一起移動，維持巢狀 |
| 拖動工作頁清單中的子卡 | 只能在同一個 master 底下的子卡之間換位置 |
| 跨欄拖拉 | 行為與現在相同（開始、完成、退回等），卡片進入目標欄的開頭 |
| 另一個前端或 CLI 同時改了看板 | 排序只移動被拖的那一張卡，不覆蓋其他卡片的變更 |
| 收合的工作頁清單（只剩圖示） | 不提供拖拉 |

### Tag 清單（全域）

| 情境或觸發條件 | 預期行為 |
| --- | --- |
| 新增 tag | 需填名稱與顏色；名稱去掉頭尾空白後不得為空，不分大小寫不得與既有 tag 重複 |
| 改名或改顏色 | 所有貼著該 tag 的卡片立刻顯示新名稱或顏色 |
| 刪除 tag | 從清單移除，並從所有卡片（含 Done）移除；不可復原，UI 刪除前要確認 |
| 顏色 | 從固定的調色盤選一個（約 8 色，取自設計 token，深色主題下可讀），不開放任意色碼 |

### 卡片上的 tag

| 情境或觸發條件 | 預期行為 |
| --- | --- |
| 看板卡片、工作頁清單、卡片工作區 | 顯示該卡所有 tag 的彩色標籤；放不下時截斷並顯示「+N」 |
| 套用 tag | 從清單挑選已有的 tag，或輸入新名稱直接新增（同時進入全域清單）；同一 tag 在同一張卡上只出現一次 |
| 移除 tag | 只從這張卡拿掉，全域清單不變 |
| 哪些卡能改 tag | Backlog 與 In Progress 的卡都能改，不受「只有 Backlog 能編輯」的限制 |
| Done 的卡 | 不顯示也不能套用 tag |
| 卡片進入 Done（拖到 Done、完成並清理、CLI `--status done`） | 其 tag 全部清除；全域清單不變 |
| Done 的卡被拉回 Backlog 或 In Progress | 沒有 tag（不會恢復進 Done 前的 tag） |

### CLI

指令名稱為草案，於 plan 定稿：

```sh
vibeflow tag list
vibeflow tag create --name "等待 PL review PR" --color amber
vibeflow tag update --tag "等待 PL review PR" [--name <新名稱>] [--color <色名>]
vibeflow tag delete --tag "等待 PL review PR"
vibeflow task tag --task <id> --add "等待 JFrog 簽核" [--add …] [--remove …] [--color <色名>]
vibeflow task move --task <id> [--before <id> | --after <id> | --top | --bottom]
```

| 情境或觸發條件 | 預期行為 |
| --- | --- |
| `task tag --add` 名稱尚不存在 | 自動新增到全域清單；沒給 `--color` 時依序從調色盤指派 |
| `--tag` / `--add` / `--remove` 對 tag 的比對 | 名稱不分大小寫；也接受 tag id |
| 在卡片的 shell 內執行 | `--task` 預設為 `VIBEFLOW_TASK_ID`，store 預設為 `VIBEFLOW_STORE_DIR`，與既有 `task` 指令一致 |
| host 沒在跑 | tag 與排序指令仍可執行（直接寫 store）；host 開著時畫面自動更新 |
| 對 Done 的卡 `--add` | 失敗並回報錯誤 |
| 未知的 tag 名稱（`--remove`、`tag update/delete`）、未知顏色、未知卡片 | 失敗並回報明確錯誤 |
| `task show` / `task list` | 輸出包含卡片的 tag 名稱 |

## 驗收條件

- [ ] AC-1：看板 Backlog 欄有 3 張卡，把第 3 張拖到第 1 張上方，順序變為 3-1-2；重新整理與重啟 host 後不變。In Progress 與 Done 欄同樣可以。
- [ ] AC-2：在工作頁清單把卡 B 拖到卡 A 上方，看板 In Progress 欄也變成 B 在 A 之前；在看板排序後工作頁清單同步。
- [ ] AC-3：master 卡與它的子卡在工作頁清單中，拖動 master 時子卡跟著移動；子卡不能被拖到 master 群組之外。
- [ ] AC-4：跨欄拖拉（Backlog → In Progress 啟動卡片等）行為與現在相同。
- [ ] AC-5：在 UI 新增 tag「等待 PL review PR」（琥珀色）並貼到兩張卡，兩張卡都顯示該彩色標籤；在第三張卡挑選套用時能看到它。
- [ ] AC-6：tag 改名或改色後，所有貼著它的卡片立即更新；刪除 tag（確認後）後所有卡片都不再顯示它。
- [ ] AC-7：一張卡可同時有 2 個以上 tag；移除其中一個只影響這張卡。
- [ ] AC-8：有 tag 的卡拖到 Done 後 tag 被清除；拉回 Backlog 後仍沒有 tag；全域清單仍保有該 tag。
- [ ] AC-9：在卡片 shell 內執行 `task tag --add "等待 JFrog 簽核"`（不帶 `--task`），開著的 Web UI 自動顯示該 tag；`tag list` 列出它；`task show` 顯示它。
- [ ] AC-10：`task move --task <id> --top` 讓該卡移到所屬欄的第一個，UI 同步。
- [ ] AC-11：舊版的 store（沒有 tag 相關欄位）升級後正常載入，所有卡片沒有 tag、順序不變。

## 限制與依賴

- 卡片順序就是 store 中各欄陣列的順序；不新增排序欄位。
- tag 與排序都會留存在 `vibeflow-state.json`，需要 store migration（新增欄位、預設為空）。
- 前端只能透過 handler table 操作；排序與 tag 是 core 擁有的資料，`vibeflow:setBoard` 不得用來改寫 tag。
- 拖拉沿用看板既有的原生 HTML5 拖拉，不引入新套件。
- 顏色限定為調色盤內的色名，對應 `renderer/styles/globals.css` 的 token，需符合 `docs/DESIGN.md`。

## 待確認事項

- TUI 是否要顯示卡片 tag（只顯示，不編輯）？預設：要，在卡片標題後以文字顯示。
- 調色盤的確切色數與顏色：預設 8 色（灰、紅、橘、琥珀、綠、青、藍、紫），於 plan 中依設計 token 定案。
