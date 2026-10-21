---
name: visual-parity
description: 比對兩個已渲染網頁的樣式落差（新舊版對照 / 改版驗收），跑互動 E2E 流程並蒐集 console 與 network 錯誤，以及在 375/768/1440 三種寬度檢查 RWD 與水平溢出。當使用者提到「新舊頁面長得不一樣」「跟測試環境比對」「像素比對」「樣式對不上」「visual diff」「RWD 檢查」「開 dev server 驗收」「E2E 驗收」時使用。比對與驗收的結果寫進檔案，只回傳壓縮過的落差表。
---

# Visual Parity

一次跑完、產出完整落差清單。**禁止**「改一項 → 截圖 → 再改一項」的來回迴圈。

## 為什麼存在

改一項就截圖一次，會把每張截圖與每份 computed style 永久留在 context 裡。同一份工作在 600k context 下做，成本是 100k 時的六倍。本 skill 把比對結果寫進檔案，只回傳一張壓縮過的落差表。

## 鐵則

1. **不要 Read `scripts/parity.py`。** 它是黑箱，用 `--help` 就夠。下文的 `parity.py` 一律指本 SKILL.md 所在目錄下的 `scripts/parity.py`，用絕對路徑呼叫。
2. **不要把報告全文讀進 context。** stdout 的摘要已含「最常出現的落差屬性」；需要細節時用 `grep` 撈特定屬性或 selector，不要 `Read` 整份。
3. **不要逐項修。** 先看 stdout 的 top differing properties——落差通常是少數幾條系統性規則（一條 `margin-bottom`、一組 token）造成的，不是幾十個獨立問題。
4. **改完重跑一次全量比對**，而不是只驗剛改的那一項。
5. **先選輸出目錄。** 在 VibeFlow 中，驗收證據預設寫入 `VIBEFLOW_ARTIFACTS_DIR` 的子目錄，暫存工作檔寫入 `VIBEFLOW_SCRATCH_DIR`；不要留在 agent scratchpad，也不要 commit 截圖或影片。

## 前置

- `<skill-dir>` 是本 SKILL.md 所在的目錄；script 在 `<skill-dir>/scripts/parity.py`。
- 下文指令寫 `python`；macOS / Linux 沒有 `python` 時改用 `python3`。
- 需要 `pip install playwright && playwright install chromium`（macOS / Linux 用 `pip3` 或 `python3 -m pip`）；錄 `.mp4` 才需要 ffmpeg（選配）。
- 受測頁面要先跑起來。server 已經在跑就直接呼叫 `parity.py`；自簽憑證已預設接受（`ignore_https_errors`）。
- 頁面需要登入或一次性 token 時，`--ref` / `--local` 直接給帶 token 的完整 URL，或先用 `flow` 的步驟登入。
  打到登入頁或拒絕頁時比對結果毫無意義——`matched` 異常地少就先檢查這個。
- 新舊對照要同時起兩份 server（不同 port），各自當 `--ref` 與 `--local`。

## 輸出目錄 — 每次驗收先執行

以下為 Bash 範例，在同一個 shell 依序執行。路徑即使含空白也必須保留引號。
PowerShell 請依同一優先順序建立目錄、設定 `$env:PARITY_OUT`／`$env:PARITY_SCRATCH`，並在呼叫 Python 的 process 設定 `TMPDIR`；不要直接貼 Bash 語法。

```bash
if [ -n "${VIBEFLOW_ARTIFACTS_DIR:-}" ]; then
  mkdir -p "$VIBEFLOW_ARTIFACTS_DIR/visual-parity"
  PARITY_OUT="$(mktemp -d "$VIBEFLOW_ARTIFACTS_DIR/visual-parity/run-XXXXXX")"
else
  PARITY_OUT="$PWD"
fi

if [ -n "${VIBEFLOW_SCRATCH_DIR:-}" ]; then
  mkdir -p "$VIBEFLOW_SCRATCH_DIR"
  PARITY_SCRATCH="$(mktemp -d "$VIBEFLOW_SCRATCH_DIR/parity-XXXXXX")"
elif [ -n "${VIBEFLOW_ARTIFACTS_DIR:-}" ]; then
  mkdir -p "$VIBEFLOW_ARTIFACTS_DIR/scratch"
  PARITY_SCRATCH="$(mktemp -d "$VIBEFLOW_ARTIFACTS_DIR/scratch/parity-XXXXXX")"
else
  PARITY_SCRATCH="$(mktemp -d)"
fi
export PARITY_OUT PARITY_SCRATCH
```

- `PARITY_OUT`：截圖、像素 diff 圖（若另行產生）、最終影片、Markdown 報告及新建立的 `steps.json`。有 Artifact root 時每次初始化建立獨立子目錄，避免覆蓋之前的證據。
- `PARITY_SCRATCH`：額外 log、一次性的 Playwright 腳本、錄影與轉檔中間檔。下文的 `TMPDIR` 前綴只影響該次 Python process，讓錄影暫存目錄也使用此位置；若將 stdout／stderr 另存 log，寫在這裡。報告內仍保留 console／network 摘要。
- 兩個 VibeFlow 變數皆 unset 或空值時，報告、影片及 steps 沿用 cwd，暫存檔使用系統暫存目錄；只有 scratch 變數時也能獨立使用，不要求兩者同時存在。
- 使用者明確指定的輸出位置優先；既有 `--steps` 或 repo 內回歸測試不自動搬移。`parity.py` 本身不讀這兩個 VibeFlow 變數，直接使用舊命令的路徑語意不變。

## diff — 新舊頁面樣式落差

```bash
TMPDIR="$PARITY_SCRATCH" python "<skill-dir>/scripts/parity.py" diff \
  --ref   "https://staging.example.com/faq/content?id=28473" \
  --local "https://localhost:3000/faq/content?id=28473" \
  --out   "$PARITY_OUT/parity-diff.md"
```

元素配對：先套 `--map` 的手動對照，再以「標籤+文字」自動配對，最後以「純文字」補配（吸收 SPA→SSR 的標籤變化，例如 `<p>` 變 `<div>`）。

stdout 會回報四個數字：

- `matched` — 成功配對並比對的元素數
- `diffs` — 屬性落差總數
- `missing-locally` — 舊頁有、新頁完全沒有的內容（**抓漏掉的區塊用這個**）
- `skipped-ambiguous` — 文字在頁面上重複、無法 1:1 配對，**未被比對**。數字大不代表有問題，但代表覆蓋率沒滿；關鍵區塊落在這裡就用 `--map` 補。

其他參數：`--width` / `--widths`、`--wait-selector`（等內容渲染完）、`--extra-wait`（動畫或延遲載入）。
Exit code 1 表示有落差，0 表示完全一致。
此模式比對 DOM／computed styles，不產生像素 diff 圖；需要像素級比對時另行執行，將兩張截圖及 diff 圖同樣存入 `PARITY_OUT`。

### --map：手動指定對照

DOM 結構差太多時（舊 iframe vs 新 SSR），用 JSON 補：

```json
{
  "#faqAnswer": ".faq-body",
  ".uform_search": "[data-testid=search-hero]",
  "#footer .crumb": "nav[aria-label=breadcrumb]"
}
```

左邊是 ref 的 selector、右邊是 local 的。支援尾綴比對，不必寫完整路徑。

## responsive — 三種寬度 + 水平溢出

```bash
TMPDIR="$PARITY_SCRATCH" python "<skill-dir>/scripts/parity.py" responsive \
  --ref "<ref-URL>" --local "<local-URL>" \
  --out "$PARITY_OUT/parity-responsive.md"
```

等同在 375 / 768 / 1440 各跑一次 diff，另外檢查 local 是否出現水平溢出（`scrollWidth > clientWidth`），這是 RWD 破版最常見的徵兆。

## flow — 互動驗收 + console/network 錯誤

用 JSON 描述步驟，不要每次現寫 Playwright。以下範例以 Python 寫入實際的 screenshot 絕對路徑；請依受測頁面調整 URL、selector 與 assertion。
**JSON 不會展開 `$PARITY_OUT` 等 shell 變數**，不要將它們直接寫成 JSON path：

```bash
python - <<'PY'
import json
import os
from pathlib import Path

out = Path(os.environ["PARITY_OUT"]).resolve()
steps = [
  {"action": "goto", "url": "https://localhost:3000/products"},
  {"action": "click", "selector": ".ba-free-download", "desc": "點 Free Download"},
  {"action": "wait", "selector": "[role=dialog]"},
  {"action": "expect_focused", "selector": "[role=dialog] input[type=email]", "desc": "focus 應落在 input 而非 close button"},
  {"action": "fill", "selector": "input[type=email]", "value": "a@b.com"},
  {"action": "click", "selector": "button[type=submit]"},
  {"action": "expect_text", "selector": "[role=dialog]", "value": "Check your email"},
  {"action": "screenshot", "path": str(out / "parity-flow.png")}
]
(out / "steps.json").write_text(json.dumps(steps, ensure_ascii=False, indent=2), encoding="utf-8")
PY
```

```bash
TMPDIR="$PARITY_SCRATCH" python "<skill-dir>/scripts/parity.py" flow \
  --steps "$PARITY_OUT/steps.json" --out "$PARITY_OUT/parity-flow.md"
```

可用 action：`goto` `click` `fill` `press` `wait` `expect_text` `expect_visible` `expect_focused` `screenshot`。
`wait` 吃 `selector`，或改吃 `{"action":"wait","ms":800}` 單純停一段時間——動畫沒有對應的 selector 可等時用這個。
預設第一個失敗就停（`--keep-going` 可跑完全部）。console error/warning 與失敗的 request 一律蒐集，這類問題不會反映在樣式比對裡。
`--headed` 可開有頭瀏覽器讓人工旁觀。

### --video：錄整段互動

截圖看不出 transition、loading、hover 這類會動的東西，用錄影：

```bash
TMPDIR="$PARITY_SCRATCH" python "<skill-dir>/scripts/parity.py" flow \
  --steps "$PARITY_OUT/steps.json" --out "$PARITY_OUT/parity-flow.md" \
  --video "$PARITY_OUT/parity-flow.mp4"
```

- 副檔名 `.mp4` 會在錄完後用 ffmpeg 轉成 H.264（QuickTime 直接開），中間的 webm 自動刪除。**ffmpeg 不存在時不會失敗**，保留 `.webm` 並在 stdout 提示。副檔名寫 `.webm` 則完全不轉檔。
- `--video-size WxH`（預設 `1280x720`）同時決定錄影解析度與 viewport。
- `--video-tail <秒>`（預設 `1`）最後一步跑完後繼續錄的時間，避免收尾的動畫被切掉。
- 影格率是 Playwright screencast 的 **25fps**，判斷「動畫有沒有做對」夠用；要判斷「掉不掉幀」不夠，那種要用 macOS `screencapture -v` 錄 60fps。
- 影片路徑會同時寫進報告開頭與 stdout。

新建的驗收 JSON 預設留在 `PARITY_OUT`，下次可用其實際路徑重跑。只有使用者明確要求保留程式碼回歸測試時，才放入專案（例如 `e2e/`）；截圖、影片與其他驗收證據仍留在 Artifact，不 commit。

## 維護

改過 `parity.py` 後跑 `TMPDIR="$PARITY_SCRATCH" python "<skill-dir>/scripts/parity.py" selftest`，會用內建 fixture 驗證配對與 diff 邏輯仍正確。
