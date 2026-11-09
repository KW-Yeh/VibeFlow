#!/usr/bin/env python3
"""visual-parity: rendered-page comparison and E2E flow runner.

Black-box script. Run with --help. Do not read this source into an agent
context window; every mode writes its full result to a report file and prints
only a compressed summary to stdout.
"""
import argparse
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
from collections import Counter, defaultdict

try:
    from playwright.sync_api import sync_playwright
except ImportError:
    sys.exit("playwright not installed. Run: pip install playwright && playwright install chromium")

PROPS = [
    "font-family", "font-size", "font-weight", "font-style", "line-height",
    "letter-spacing", "text-align", "text-transform", "text-decoration-line",
    "color", "background-color", "opacity", "visibility",
    "margin-top", "margin-right", "margin-bottom", "margin-left",
    "padding-top", "padding-right", "padding-bottom", "padding-left",
    "border-top-width", "border-right-width", "border-bottom-width", "border-left-width",
    "border-top-color", "border-radius",
    "display", "flex-direction", "justify-content", "align-items", "gap",
    "list-style-type", "white-space", "overflow-x", "box-shadow",
]

# Box dimensions are compared with a tolerance; exact equality is noise.
BOX_TOLERANCE_PX = 2

COLLECT_JS = """
(props) => {
  const SKIP = new Set(['SCRIPT','STYLE','META','LINK','HEAD','NOSCRIPT','TITLE','BR']);
  const cssPath = (el) => {
    const parts = [];
    while (el && el.nodeType === 1 && parts.length < 8) {
      if (el === document.body) { parts.unshift('body'); break; }
      let p = el.tagName.toLowerCase();
      if (el.id && /^[A-Za-z][\\w-]*$/.test(el.id)) { parts.unshift('#' + el.id); break; }
      const par = el.parentElement;
      if (par) {
        const sibs = Array.from(par.children).filter(c => c.tagName === el.tagName);
        if (sibs.length > 1) p += ':nth-of-type(' + (sibs.indexOf(el) + 1) + ')';
      }
      parts.unshift(p);
      el = el.parentElement;
    }
    return parts.join(' > ');
  };
  const ownText = (el) => (el.children.length === 0
    ? el.textContent
    : Array.from(el.childNodes).filter(n => n.nodeType === 3).map(n => n.textContent).join(' '));

  const out = [];
  for (const el of document.querySelectorAll('*')) {
    if (SKIP.has(el.tagName)) continue;
    const r = el.getBoundingClientRect();
    if (r.width === 0 && r.height === 0) continue;
    const cs = getComputedStyle(el);
    const styles = {};
    for (const p of props) styles[p] = cs.getPropertyValue(p).trim();
    out.push({
      path: cssPath(el),
      tag: el.tagName.toLowerCase(),
      text: ownText(el).replace(/\\s+/g, ' ').trim().slice(0, 120),
      x: Math.round(r.left + scrollX), y: Math.round(r.top + scrollY),
      w: Math.round(r.width), h: Math.round(r.height),
      styles,
    });
    if (out.length >= 2500) break;
  }
  return {
    elements: out,
    docScrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  };
}
"""


def norm(t):
    return re.sub(r"\s+", " ", t or "").strip().lower()


def collect(page, url, wait_selector, extra_wait):
    load(page, url, wait_selector, extra_wait)
    return page.evaluate(COLLECT_JS, PROPS)


def load(page, url, wait_selector, extra_wait):
    page.goto(url, wait_until="domcontentloaded", timeout=60000)
    try:
        page.wait_for_load_state("networkidle", timeout=30000)
    except Exception:
        pass  # some pages poll forever; the DOM is usable regardless
    if wait_selector:
        page.wait_for_selector(wait_selector, timeout=30000)
    if extra_wait:
        page.wait_for_timeout(int(extra_wait * 1000))


def build_pairs(ref_els, loc_els, manual_map):
    """Match ref elements to local elements. Returns (pairs, unmatched_ref)."""
    pairs, used_loc = [], set()

    ref_by_path = {e["path"]: e for e in ref_els}
    loc_by_path = {e["path"]: e for e in loc_els}
    for ref_sel, loc_sel in (manual_map or {}).items():
        r = ref_by_path.get(ref_sel) or next((e for e in ref_els if e["path"].endswith(ref_sel)), None)
        l = loc_by_path.get(loc_sel) or next((e for e in loc_els if e["path"].endswith(loc_sel)), None)
        if r and l:
            pairs.append((r, l, "manual"))
            used_loc.add(l["path"])

    def index(els, keyfn):
        idx = defaultdict(list)
        for e in els:
            k = keyfn(e)
            if k:
                idx[k].append(e)
        return {k: v[0] for k, v in idx.items() if len(v) == 1}

    matched_ref = {id(r) for r, _, _ in pairs}
    for keyfn, label in (
        (lambda e: f"{e['tag']}|{norm(e['text'])}" if norm(e["text"]) else None, "tag+text"),
        (lambda e: norm(e["text"]) if norm(e["text"]) else None, "text"),
    ):
        ridx, lidx = index(ref_els, keyfn), index(loc_els, keyfn)
        for k, r in ridx.items():
            if id(r) in matched_ref:
                continue
            l = lidx.get(k)
            if l and l["path"] not in used_loc:
                pairs.append((r, l, label))
                matched_ref.add(id(r))
                used_loc.add(l["path"])

    # An unmatched ref element is only "missing" if its text appears nowhere
    # locally. Text that exists but is ambiguous (repeated nav labels, table
    # cells) simply cannot be paired 1:1 — reporting it as missing sends the
    # reader chasing content that is actually on the page.
    loc_texts = {norm(e["text"]) for e in loc_els if norm(e["text"])}
    missing, ambiguous = [], []
    for e in ref_els:
        t = norm(e["text"])
        if id(e) in matched_ref or not t:
            continue
        (missing if t not in loc_texts else ambiguous).append(e)
    return pairs, missing, ambiguous


def diff_pair(r, l):
    out = []
    for p in PROPS:
        a, b = r["styles"].get(p, ""), l["styles"].get(p, "")
        if a != b:
            out.append((p, a, b))
    for dim in ("w", "h"):
        if abs(r[dim] - l[dim]) > BOX_TOLERANCE_PX:
            out.append((f"box-{dim}", f"{r[dim]}px", f"{l[dim]}px"))
    return out


def run_diff(args):
    manual_map = {}
    if args.map:
        manual_map = json.load(open(args.map, encoding="utf-8"))

    widths = [int(w) for w in args.widths.split(",")] if args.widths else [args.width]
    sections, stdout_rows = [], []
    prop_counter = Counter()
    total_pairs = total_diffs = 0
    overflow_notes = []

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        ctx = browser.new_context(ignore_https_errors=True)
        page = ctx.new_page()
        for w in widths:
            page.set_viewport_size({"width": w, "height": args.height})
            ref = collect(page, args.ref, args.wait_selector, args.extra_wait)
            loc = collect(page, args.local, args.wait_selector, args.extra_wait)

            if loc["docScrollWidth"] > loc["clientWidth"] + 1:
                overflow_notes.append(
                    f"{w}px: local has horizontal overflow "
                    f"(scrollWidth {loc['docScrollWidth']} > clientWidth {loc['clientWidth']})"
                )

            pairs, missing, ambiguous = build_pairs(ref["elements"], loc["elements"], manual_map)
            total_pairs += len(pairs)

            rows = []
            for r, l, how in pairs:
                for prop, a, b in diff_pair(r, l):
                    rows.append((prop, r["path"], l["path"], a, b, r["text"][:40], how))
                    prop_counter[prop] += 1
            total_diffs += len(rows)

            sec = [f"\n## viewport {w}px\n",
                   f"matched {len(pairs)} elements, {len(rows)} property diffs, "
                   f"{len(missing)} missing locally, "
                   f"{len(ambiguous)} not compared (text present but ambiguous)\n"]
            if rows:
                sec.append("\n| property | ref value | local value | ref selector | text |")
                sec.append("|---|---|---|---|---|")
                for prop, rp, lp, a, b, txt, how in sorted(rows):
                    sec.append(f"| {prop} | `{a}` | `{b}` | `{rp}` | {txt} |")
            if missing:
                sec.append("\n### present in ref, missing locally\n")
                for e in missing[:60]:
                    sec.append(f"- `{e['tag']}` {e['text'][:90]}")
                if len(missing) > 60:
                    sec.append(f"- ...and {len(missing) - 60} more")
            if ambiguous:
                sec.append(
                    f"\n### not compared: {len(ambiguous)} elements whose text is repeated on the page\n"
                    "Add entries to `--map` to compare these explicitly.\n")
            sections.append("\n".join(sec))
            stdout_rows.append((w, len(pairs), len(rows), len(missing), len(ambiguous)))

        browser.close()

    report = [f"# visual-parity diff\n", f"- ref:   {args.ref}", f"- local: {args.local}",
              f"- widths: {widths}"]
    if overflow_notes:
        report.append("\n**layout warnings**")
        report += [f"- {n}" for n in overflow_notes]
    report += sections
    with open(args.out, "w", encoding="utf-8") as f:
        f.write("\n".join(report))

    print(f"report: {args.out}")
    for w, np_, nd, nm, na in stdout_rows:
        print(f"  {w}px: {np_} matched, {nd} diffs, {nm} missing-locally, {na} skipped-ambiguous")
    for n in overflow_notes:
        print(f"  WARN {n}")
    if prop_counter:
        print("\ntop differing properties (fix these systemically, not element by element):")
        for prop, c in prop_counter.most_common(15):
            print(f"  {c:4d}  {prop}")
    return 1 if total_diffs else 0


# Pixel mode compares screenshots with OpenCV. It answers what the computed-style
# diff cannot: whether a style difference is visible at all, and which visible
# differences no compared style explains (images, SVG, pseudo-elements, fonts).

STABILIZE_CSS = ("*,*::before,*::after{transition:none!important;animation:none!important;"
                 "caret-color:transparent!important;scroll-behavior:auto!important}")
MASK_COLOR = "#FF00FF"
# Taller anchors span several layout rows and would smear the row mapping.
MAX_ANCHOR_HEIGHT = 600
ALIGN_STRIP = 32


def import_cv():
    try:
        import cv2
        import numpy as np
    except ImportError:
        sys.exit("pixel mode needs OpenCV. Run: pip install opencv-python-headless numpy")
    return cv2, np


def capture(page, url, args, cv2, np):
    load(page, url, args.wait_selector, args.extra_wait)
    page.add_style_tag(content=STABILIZE_CSS)
    page.evaluate("() => document.fonts ? document.fonts.ready.then(() => true) : true")
    data = page.evaluate(COLLECT_JS, PROPS)
    width, height = page.evaluate(
        "() => [document.documentElement.scrollWidth, document.documentElement.scrollHeight]")
    opts = dict(full_page=True, animations="disabled", caret="hide",
                mask=[page.locator(s) for s in args.mask], mask_color=MASK_COLOR)
    if height > args.max_height:
        opts["clip"] = {"x": 0, "y": 0, "width": width, "height": args.max_height}
    png = page.screenshot(**opts)
    return data, cv2.imdecode(np.frombuffer(png, np.uint8), cv2.IMREAD_COLOR)


def delta_e(cv2, np, a, b, chunk=1024):
    """Per-pixel CIE76 colour distance; chunked so tall pages fit in memory."""
    out = np.empty(a.shape[:2], np.float32)
    for y in range(0, a.shape[0], chunk):
        d = (cv2.cvtColor(a[y:y + chunk], cv2.COLOR_BGR2LAB).astype(np.float32)
             - cv2.cvtColor(b[y:y + chunk], cv2.COLOR_BGR2LAB).astype(np.float32))
        d[..., 0] *= 100.0 / 255.0
        out[y:y + chunk] = np.sqrt((d * d).sum(axis=2))
    return out


def mode_color(np, img, step=1):
    px = img[::step, ::step].reshape(-1, 3)
    vals, counts = np.unique(px, axis=0, return_counts=True)
    return vals[counts.argmax()]


def row_offsets(np, ref_g, loc_g, anchors):
    """For every ref row, how far down the same content sits on the local page.

    Matched elements anchor the mapping, so a block inserted or removed locally
    shifts the comparison instead of flagging everything below it as different.
    """
    H, Hl = ref_g.shape[0], loc_g.shape[0]
    unset = np.iinfo(np.int32).min
    first = np.full(H, unset, np.int32)
    conflicts = defaultdict(set)
    for r, l in anchors:
        y0, y1, dy = max(r["y"], 0), min(r["y"] + r["h"], H), l["y"] - r["y"]
        seg = first[y0:y1]
        for y in (np.flatnonzero((seg != unset) & (seg != dy)) + y0).tolist():
            conflicts[y] |= {int(first[y]), dy}
        seg[seg == unset] = dy

    def cost(y, d):
        ly = y + d
        return float(np.abs(ref_g[y] - loc_g[ly]).mean()) if 0 <= ly < Hl else float("inf")

    # Overlapping anchors that disagree (nested layouts moving differently):
    # the offset that lines this row up wins rather than an average of them.
    known = [None if v == unset else v for v in first.tolist()]
    for y, ds in conflicts.items():
        known[y] = min(ds, key=lambda d: cost(y, d))

    nxt, carry = [None] * H, None
    for y in range(H - 1, -1, -1):
        carry = known[y] if known[y] is not None else carry
        nxt[y] = carry
    dys, prev = np.zeros(H, np.int32), 0
    for y in range(H):
        if known[y] is not None:
            prev = known[y]
        else:
            # Rows between anchors (margins, unpaired images) follow whichever
            # neighbouring offset actually lines the row up.
            # Switching needs a clear win: a blank row matches anything, and
            # would otherwise pull a real change out from under the comparison.
            if nxt[y] not in (None, prev) and cost(y, nxt[y]) < 0.5 * cost(y, prev):
                prev = nxt[y]
        dys[y] = prev
    return dys


def align(np, ref, loc, ref_g, loc_g, pairs):
    """Local page resampled into ref coordinates, one vertical strip at a time.

    Columns move independently (a card added to one kanban column pushes only
    that column down), so each strip follows only the anchors that overlap it,
    and strips are cut at anchor edges so none straddles two columns.
    """
    H, W = ref_g.shape
    Hl = loc_g.shape[0]
    anchors = [(r, l) for r, l, _ in pairs if 0 < r["h"] <= MAX_ANCHOR_HEIGHT]
    cuts = {0, W} | set(range(0, W, ALIGN_STRIP))
    for r, _ in anchors:
        cuts |= {min(max(r["x"], 0), W), min(max(r["x"] + r["w"], 0), W)}
    edges = sorted(cuts)
    aligned = ref.copy()  # rows with no local counterpart compare equal; `compared` says which
    compared = np.zeros((H, W), bool)
    mapped = np.zeros((Hl, W), bool)
    offsets = np.zeros((H, len(edges) - 1), np.int32)
    for i, (x0, x1) in enumerate(zip(edges, edges[1:])):
        mine = [(r, l) for r, l in anchors if r["x"] < x1 and x0 < r["x"] + r["w"]]
        dys = row_offsets(np, ref_g[:, x0:x1], loc_g[:, x0:x1], mine)
        ly = np.arange(H) + dys
        v = (ly >= 0) & (ly < Hl)
        aligned[v, x0:x1] = loc[ly[v], x0:x1]
        compared[v, x0:x1] = True
        mapped[ly[v], x0:x1] = True
        offsets[:, i] = dys
    return aligned, mapped, compared, lambda x, y: int(offsets[y, np.searchsorted(edges, x, side="right") - 1])


def contains(e, cx, cy):
    return e["x"] <= cx < e["x"] + e["w"] and e["y"] <= cy < e["y"] + e["h"]


def innermost(els, cx, cy):
    hits = [e for e in els if contains(e, cx, cy)]
    return min(hits, key=lambda e: e["w"] * e["h"]) if hits else None


def ink_color(np, crop, mask):
    """The changed foreground colour (BGR): masked pixels farthest from the crop's background."""
    px = crop[mask > 0]
    if not len(px):
        return None
    dist = np.abs(px.astype(np.int32) - mode_color(np, crop).astype(np.int32)).sum(axis=1)
    return np.median(px[dist >= np.percentile(dist, 90)], axis=0).astype(np.uint8)


def hex_color(bgr):
    return "?" if bgr is None else "#{:02x}{:02x}{:02x}".format(*(int(c) for c in bgr[::-1]))


def classify(cv2, np, rc, ac, mc, thr):
    g1 = cv2.cvtColor(rc, cv2.COLOR_BGR2GRAY)
    g2 = cv2.cvtColor(ac, cv2.COLOR_BGR2GRAY)
    s1, s2 = float(g1.std()), float(g2.std())
    if s1 < 2 and s2 >= 6:
        return "added", ""
    if s2 < 2 and s1 >= 6:
        return "removed", ""
    h, w = g1.shape
    if min(h, w) >= 8:
        # Correlate the ink, not the paper: a flat background dominates the
        # spectrum and drags the estimate off by a fraction of a pixel.
        bg1 = float(np.median(g1))
        (fx, fy), resp = cv2.phaseCorrelate(np.abs(g1.astype(np.float32) - bg1),
                                            np.abs(g2.astype(np.float32) - bg1))
        if resp > 0.2:
            def residual(sx, sy):
                back = cv2.warpAffine(ac, np.float32([[1, 0, -sx], [0, 1, -sy]]), (w, h),
                                      flags=cv2.INTER_NEAREST, borderMode=cv2.BORDER_REPLICATE)
                bx, by = abs(sx) + 1, abs(sy) + 1
                return int((delta_e(cv2, np, rc, back) > thr)[by:h - by, bx:w - bx].sum()), (bx, by)
            cands = {(int(np.floor(fx)) + i, int(np.floor(fy)) + j) for i in (0, 1) for j in (0, 1)}
            cands = [c for c in cands if 0 < max(map(abs, c)) and abs(c[0]) < w // 2 and abs(c[1]) < h // 2]
            if cands:
                (sx, sy), (after, (bx, by)) = min(((c, residual(*c)) for c in cands), key=lambda t: t[1][0])
                before = int(mc[by:h - by, bx:w - bx].sum())
                if before and after <= 0.25 * before:
                    return "shift", f"local moved {sx:+d},{sy:+d}px"
    i1, i2 = ink_color(np, rc, mc), ink_color(np, ac, mc)
    if i1 is None or i2 is None or float(delta_e(cv2, np, i1.reshape(1, 1, 3), i2.reshape(1, 1, 3))[0, 0]) <= thr:
        return "content", ""
    colors = f"{hex_color(i1)}→{hex_color(i2)}"
    e1, e2 = cv2.Canny(g1, 50, 150) > 0, cv2.Canny(g2, 50, 150) > 0
    if not e1.any() and not e2.any():
        return "color", colors
    k = np.ones((3, 3), np.uint8)
    d1 = cv2.dilate(e1.astype(np.uint8), k) > 0
    d2 = cv2.dilate(e2.astype(np.uint8), k) > 0
    o1 = (e1 & d2).sum() / max(int(e1.sum()), 1)
    o2 = (e2 & d1).sum() / max(int(e2.sum()), 1)
    if min(o1, o2) >= 0.8:
        return "color", colors
    return "content", ""


def write_montage(cv2, np, regions, ref, aligned, dE, thr, path):
    tiles = []
    for i, rg in enumerate(regions, 1):
        x, y, w, h = rg["box"]
        x0, y0 = max(x - 16, 0), max(y - 16, 0)
        x1, y1 = min(x + w + 16, ref.shape[1]), min(y + h + 16, ref.shape[0])
        r, a = ref[y0:y1, x0:x1], aligned[y0:y1, x0:x1]
        heat = cv2.cvtColor(cv2.cvtColor(r, cv2.COLOR_BGR2GRAY), cv2.COLOR_GRAY2BGR) // 2 + 127
        heat[dE[y0:y1, x0:x1] > thr] = (0, 0, 255)
        sep = np.full((r.shape[0], 6, 3), 255, np.uint8)
        row = np.hstack([r, sep, a, sep, heat])
        scale = min(2.0, 1200 / row.shape[1], 320 / row.shape[0])
        if scale != 1:
            row = cv2.resize(row, None, fx=scale, fy=scale,
                             interpolation=cv2.INTER_NEAREST if scale > 1 else cv2.INTER_AREA)
        label = np.full((22, max(row.shape[1], 320), 3), 240, np.uint8)
        cv2.putText(label, f"#{i} {rg['kind']}   ref | local | diff", (4, 16),
                    cv2.FONT_HERSHEY_SIMPLEX, 0.45, (30, 30, 30), 1, cv2.LINE_AA)
        tiles += [label, row]
    width = max(t.shape[1] for t in tiles)
    padded = [np.hstack([t, np.full((t.shape[0], width - t.shape[1], 3), 255, np.uint8)])
              if t.shape[1] < width else t for t in tiles]
    cv2.imwrite(path, np.vstack(padded))


def run_pixel(args):
    cv2, np = import_cv()
    manual_map = json.load(open(args.map, encoding="utf-8")) if args.map else {}
    stem = os.path.splitext(args.out)[0]
    thr = args.threshold

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        ctx = browser.new_context(ignore_https_errors=True, device_scale_factor=1,
                                  reduced_motion="reduce",
                                  viewport={"width": args.width, "height": args.height})
        page = ctx.new_page()
        ref_data, ref = capture(page, args.ref, args, cv2, np)
        loc_data, loc = capture(page, args.local, args, cv2, np)
        browser.close()
    cv2.imwrite(stem + "-ref.png", ref)
    cv2.imwrite(stem + "-local.png", loc)

    notes = []
    W = min(ref.shape[1], loc.shape[1])
    if ref.shape[1] != loc.shape[1]:
        notes.append(f"page widths differ (ref {ref.shape[1]}px, local {loc.shape[1]}px); compared the first {W}px")
    ref, loc = ref[:, :W].copy(), loc[:, :W].copy()
    ref_els, loc_els = ref_data["elements"], loc_data["elements"]
    pairs, missing, _ = build_pairs(ref_els, loc_els, manual_map)

    ref_g = cv2.cvtColor(ref, cv2.COLOR_BGR2GRAY).astype(np.float32)
    loc_g = cv2.cvtColor(loc, cv2.COLOR_BGR2GRAY).astype(np.float32)
    aligned, mapped, compared, offset_at = align(np, ref, loc, ref_g, loc_g, pairs)
    lost = int((~compared).any(axis=1).sum())
    if lost:
        notes.append(f"{lost} ref rows map below the end of the local page (content pushed out of a "
                     "fixed-height layout or clipped by --max-height) and were not compared")

    def blobs(mask):
        """Changed-pixel clusters as tight (x, y, w, h, count) boxes."""
        contours, _ = cv2.findContours(cv2.dilate(mask, np.ones((9, 9), np.uint8)),
                                       cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
        for c in contours:
            x, y, w, h = cv2.boundingRect(c)
            inner = mask[y:y + h, x:x + w]
            n = int(inner.sum())
            if n >= args.min_area:
                ys, xs = np.nonzero(inner)
                yield (x + int(xs.min()), y + int(ys.min()),
                       int(xs.max() - xs.min()) + 1, int(ys.max() - ys.min()) + 1, n)

    dE = delta_e(cv2, np, ref, aligned)
    mask = (dE > thr).astype(np.uint8)
    styled = [(r, d) for r, l, _ in pairs if (d := diff_pair(r, l))]
    regions = []
    for x, y, w, h, n in blobs(mask):
        pad = 6
        y0, y1 = max(y - pad, 0), min(y + h + pad, ref.shape[0])
        x0, x1 = max(x - pad, 0), min(x + w + pad, W)
        kind, detail = classify(cv2, np, ref[y0:y1, x0:x1], aligned[y0:y1, x0:x1], mask[y0:y1, x0:x1], thr)
        cx, cy = x + w // 2, y + h // 2
        el = innermost(ref_els, cx, cy)
        limit = 4 * max(w * h, el["w"] * el["h"] if el else 0)
        why = sorted({prop for r, d in styled if contains(r, cx, cy) and r["w"] * r["h"] <= limit
                      for prop, _, _ in d})
        regions.append({"box": (x, y, w, h), "local_y": y + offset_at(cx, y), "px": n, "kind": kind,
                        "detail": detail, "el": el, "styles": why})
    regions.sort(key=lambda rg: -rg["px"])

    def hits_region(r):
        return any(r["x"] < x + w and x < r["x"] + r["w"] and r["y"] < y + h and y < r["y"] + r["h"]
                   for x, y, w, h in (rg["box"] for rg in regions))
    invisible = Counter(prop for r, d in styled if not hits_region(r) for prop, _, _ in d)

    # Local pixels nothing in ref maps onto, and that are not just page background.
    added = []
    if not mapped.all():
        bg = np.broadcast_to(mode_color(np, loc, step=4), loc.shape).copy()
        unseen = ((~mapped) & (delta_e(cv2, np, loc, bg) > thr)).astype(np.uint8)
        seen_local = [(rg["box"][0], rg["local_y"], rg["box"][2], rg["box"][3]) for rg in regions]
        for x, y, w, h, n in blobs(unseen):
            if any(x < bx + bw and bx < x + w and y < by + bh and by < y + h for bx, by, bw, bh in seen_local):
                continue  # already reported as a visible difference
            added.append({"box": (x, y, w, h), "px": n,
                          "el": innermost(loc_els, x + w // 2, y + h // 2)})
        added.sort(key=lambda a: -a["px"])

    # The first element (in reading order) at each distinct offset is where
    # that part of the layout starts sitting somewhere else.
    drift, seen = [], [(0, 0)]
    for r, l, _ in sorted(pairs, key=lambda t: (t[0]["y"], t[0]["x"])):
        off = (l["x"] - r["x"], l["y"] - r["y"])
        if all(max(abs(off[0] - s[0]), abs(off[1] - s[1])) > BOX_TOLERANCE_PX for s in seen):
            drift.append((r, off))
            seen.append(off)

    montage = None
    if regions:
        montage = stem + "-montage.png"
        write_montage(cv2, np, regions[:args.top], ref, aligned, dE, thr, montage)

    def name(e):
        return f"`{e['path']}`" if e else "?"

    def text(e):
        return (e["text"][:40] if e else "").replace("|", "\\|")

    explained = sum(1 for rg in regions if rg["styles"])
    summary = (f"{args.width}px: {len(regions)} regions ({explained} style-explained, "
               f"{len(regions) - explained} pixel-only), {len(added)} added-locally, "
               f"{sum(invisible.values())} invisible style diffs, {len(pairs)} matched elements")
    rep = ["# visual-parity pixel\n", f"- ref:   {args.ref}", f"- local: {args.local}",
           f"- width: {args.width}px, ΔE threshold {thr}, min area {args.min_area}px",
           f"- masks: {', '.join(args.mask) or 'none'}",
           f"- screenshots: {stem}-ref.png, {stem}-local.png" + (f"; montage: {montage}" if montage else ""),
           f"\n{summary}"]
    rep += [f"\n**note** {n}" for n in notes]
    if drift:
        rep += ["\n## layout drift (first matched element at each new local offset)\n",
                "| ref x,y | element | text | local offset dx,dy |", "|---|---|---|---|"]
        rep += [f"| {r['x']},{r['y']} | {name(r)} | {text(r)} | {o[0]:+d},{o[1]:+d} |" for r, o in drift[:20]]
    if regions:
        rep += ["\n## visible differences (ref coordinates; montage shows the first ones)\n",
                "| # | kind | ref box x,y,w,h | local y | changed px | element | text | detail | style diffs there |",
                "|---|---|---|---|---|---|---|---|---|"]
        for i, rg in enumerate(regions, 1):
            rep.append(f"| {i} | {rg['kind']} | {','.join(map(str, rg['box']))} | {rg['local_y']} | {rg['px']} "
                       f"| {name(rg['el'])} | {text(rg['el'])} | {rg['detail']} "
                       f"| {', '.join(rg['styles']) or '**none — pixel-only**'} |")
    if added:
        rep += ["\n## added locally (local content no ref area maps onto)\n",
                "| local box x,y,w,h | px | element | text |", "|---|---|---|---|"]
        rep += [f"| {','.join(map(str, a['box']))} | {a['px']} | {name(a['el'])} | {text(a['el'])} |"
                for a in added]
    if invisible:
        rep += ["\n## style diffs with no visible pixel change\n",
                "These differ in computed style but render identically; usually safe to ignore.\n",
                "| property | count |", "|---|---|"]
        rep += [f"| {p_} | {c} |" for p_, c in invisible.most_common()]
    if missing:
        rep.append(f"\n{len(missing)} ref elements have no local counterpart by text; `diff` lists them.")
    with open(args.out, "w", encoding="utf-8") as f:
        f.write("\n".join(rep))

    print(f"report: {args.out}")
    if montage:
        print(f"montage: {montage}  (open only for regions the table below cannot explain)")
    print(f"  {summary}")
    for n in notes:
        print(f"  WARN {n}")
    for r, o in drift[:3]:
        print(f"  drift from ref {r['x']},{r['y']} {name(r)} {text(r)!r}: local offset {o[0]:+d},{o[1]:+d}")
    for i, rg in enumerate(regions[:10], 1):
        print(f"  #{i} {rg['kind']:<7} {name(rg['el'])} {text(rg['el'])!r} {rg['detail']} "
              f"[{', '.join(rg['styles']) or 'pixel-only'}]")
    if len(regions) > 10:
        print(f"  ...{len(regions) - 10} more in the report")
    for a in added[:5]:
        print(f"  added locally at {','.join(map(str, a['box']))} {name(a['el'])} {text(a['el'])!r}")
    if invisible:
        print("  invisible style diffs: " + ", ".join(f"{p_}×{c}" for p_, c in invisible.most_common(5)))
    return 1 if regions or added else 0


def save_video(video, out_path):
    """Persist a Playwright video; convert to MP4 when the caller asked for one.

    Returns the path actually written, which falls back to the .webm original
    if ffmpeg is missing or fails.
    """
    root, ext = os.path.splitext(out_path)
    ext = ext.lower()
    webm = out_path if ext == ".webm" else root + ".webm"
    video.save_as(webm)
    if ext != ".mp4":
        return webm
    ffmpeg = shutil.which("ffmpeg")
    if not ffmpeg:
        print(f"  ffmpeg not found - kept {webm} (install with: brew install ffmpeg)")
        return webm
    try:
        subprocess.run(
            [ffmpeg, "-y", "-loglevel", "error", "-i", webm,
             "-vf", "scale=trunc(iw/2)*2:trunc(ih/2)*2",
             "-c:v", "libx264", "-preset", "veryfast", "-crf", "23",
             "-pix_fmt", "yuv420p", "-movflags", "+faststart", out_path],
            check=True, capture_output=True)
    except subprocess.CalledProcessError as e:
        print(f"  ffmpeg failed - kept {webm}: {e.stderr.decode()[:200]}")
        return webm
    os.remove(webm)
    return out_path


def run_flow(args):
    steps = json.load(open(args.steps, encoding="utf-8"))
    console_errors, failed_requests, results = [], [], []

    video_path, tmpdir = None, None

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=args.headless)
        ctx_opts = {"ignore_https_errors": True}
        if args.video:
            w, h = (int(v) for v in args.video_size.lower().split("x"))
            tmpdir = tempfile.mkdtemp(prefix="parity-video-")
            ctx_opts.update(record_video_dir=tmpdir,
                            record_video_size={"width": w, "height": h},
                            viewport={"width": w, "height": h})
        ctx = browser.new_context(**ctx_opts)
        page = ctx.new_page()
        page.on("console", lambda m: console_errors.append(f"[{m.type}] {m.text}"[:300])
                if m.type in ("error", "warning") else None)
        page.on("requestfailed", lambda r: failed_requests.append(f"{r.method} {r.url} — {r.failure}"[:300]))

        for i, step in enumerate(steps):
            act = step.get("action")
            desc = step.get("desc", f"{act} {step.get('selector') or step.get('url') or ''}")
            try:
                if act == "goto":
                    page.goto(step["url"], wait_until="domcontentloaded", timeout=60000)
                    try:
                        page.wait_for_load_state("networkidle", timeout=20000)
                    except Exception:
                        pass
                elif act == "click":
                    page.click(step["selector"], timeout=15000)
                elif act == "fill":
                    page.fill(step["selector"], step["value"], timeout=15000)
                elif act == "press":
                    page.press(step["selector"], step["key"], timeout=15000)
                elif act == "wait":
                    if "ms" in step:
                        page.wait_for_timeout(step["ms"])
                    else:
                        page.wait_for_selector(step["selector"], timeout=step.get("timeout", 15000))
                elif act == "expect_text":
                    got = page.inner_text(step["selector"], timeout=15000)
                    assert step["value"] in got, f"expected {step['value']!r} in {got[:120]!r}"
                elif act == "expect_visible":
                    assert page.is_visible(step["selector"]), "not visible"
                elif act == "expect_focused":
                    got = page.evaluate(
                        "s => document.activeElement === document.querySelector(s)", step["selector"])
                    assert got, "element is not document.activeElement"
                elif act == "screenshot":
                    page.screenshot(path=step["path"], full_page=step.get("full_page", True))
                else:
                    raise ValueError(f"unknown action {act!r}")
                results.append((i, desc, "PASS", ""))
            except Exception as e:
                results.append((i, desc, "FAIL", str(e)[:300]))
                if not args.keep_going:
                    break

        if args.video and args.video_tail:
            page.wait_for_timeout(int(args.video_tail * 1000))
        video = page.video if args.video else None
        ctx.close()  # the video file is only finalized on context close
        if video:
            video_path = save_video(video, args.video)
        browser.close()
        if tmpdir:
            shutil.rmtree(tmpdir, ignore_errors=True)

    lines = ["# visual-parity flow\n", f"steps file: {args.steps}\n"]
    if video_path:
        lines.append(f"video: {video_path}\n")
    lines += ["| # | step | result | detail |", "|---|---|---|---|"]
    lines += [f"| {i} | {d} | {r} | {m} |" for i, d, r, m in results]
    if console_errors:
        lines += ["\n## console errors/warnings\n"] + [f"- {e}" for e in dict.fromkeys(console_errors)]
    if failed_requests:
        lines += ["\n## failed requests\n"] + [f"- {e}" for e in dict.fromkeys(failed_requests)]
    with open(args.out, "w", encoding="utf-8") as f:
        f.write("\n".join(lines))

    failed = [r for r in results if r[2] == "FAIL"]
    print(f"report: {args.out}")
    if video_path:
        print(f"video: {video_path}")
    print(f"  {len(results) - len(failed)}/{len(results)} steps passed")
    for i, d, r, m in failed:
        print(f"  FAIL step {i}: {d} — {m}")
    if console_errors:
        print(f"  {len(set(console_errors))} unique console errors/warnings")
    if failed_requests:
        print(f"  {len(set(failed_requests))} failed requests")
    return 1 if failed else 0


def selftest():
    """Assert the matcher and differ actually catch a known difference."""
    a = """<html><body><h1>Hello</h1><p class=x>Body copy</p>
      <ul><li>Item one</li></ul><div>Only in ref 🎉</div></body></html>"""
    b = """<html><body><h1 style="font-size:40px">Hello</h1>
      <div class=y style="margin-bottom:0">Body copy</div>
      <ul><li style="color:rgb(255,0,0)">Item one</li></ul></body></html>"""
    d = tempfile.mkdtemp()
    for name, html in (("a.html", a), ("b.html", b)):
        open(os.path.join(d, name), "w", encoding="utf-8").write(html)
    out = os.path.join(d, "r.md")
    args = argparse.Namespace(
        ref="file://" + os.path.join(d, "a.html"), local="file://" + os.path.join(d, "b.html"),
        map=None, widths=None, width=1440, height=900, wait_selector=None, extra_wait=0, out=out)
    run_diff(args)
    body = open(out, encoding="utf-8").read()
    assert "font-size" in body, "should detect the h1 font-size change"
    assert "color" in body, "should detect the li color change"
    assert "Only in ref" in body, "should report the ref-only element as missing locally"
    assert "`div`" in body or "margin-bottom" in body, "should match p->div across tag change"
    selftest_pixel(d)
    print("\nselftest OK")


def selftest_pixel(d):
    import importlib.util
    if importlib.util.find_spec("cv2") is None:
        print("\npixel selftest skipped: opencv-python-headless not installed")
        return
    style = ("<style>body{margin:0;font:16px/1.4 sans-serif} h1,p,div{margin:0 0 16px}"
             ".icon{display:block;width:40px;height:40px;background:#2a6}</style>")
    a = f"""<html><body>{style}<h1>Title</h1><p>Colour copy here</p>
      <div class=box>Shifted box text</div><section><i class=icon></i></section>
      <div style="display:flex;gap:12px"><div style="width:200px"><p>Left one</p><p>Left two</p></div>
      <div style="width:200px"><p>Right one</p><i class=icon></i></div></div>
      <p>Footer stays the same</p><p>Clock <span id=clock>12:00:01</span></p></body></html>"""
    b = f"""<html><body>{style}<div style="height:60px;background:#fd0">New banner</div>
      <h1>Title</h1><p style="color:#c00">Colour copy here</p>
      <div class=box style="padding-left:12px">Shifted box text</div>
      <section><i class=icon style="border-radius:50%"></i></section>
      <div style="display:flex;gap:12px"><div style="width:200px"><p>Left one</p><p>Inserted left</p><p>Left two</p></div>
      <div style="width:200px"><p>Right one</p><i class=icon></i></div></div>
      <p style="padding-right:5px">Footer stays the same</p>
      <p>Clock <span id=clock>12:59:59</span></p></body></html>"""
    for name, html in (("pa.html", a), ("pb.html", b)):
        open(os.path.join(d, name), "w", encoding="utf-8").write(html)
    out = os.path.join(d, "pixel.md")
    args = argparse.Namespace(
        ref="file://" + os.path.join(d, "pa.html"), local="file://" + os.path.join(d, "pb.html"),
        map=None, width=800, height=600, wait_selector=None, extra_wait=0, mask=["#clock"],
        threshold=3.0, min_area=6, max_height=10000, top=6, out=out)
    assert run_pixel(args) == 1
    body = open(out, encoding="utf-8").read()
    rows = [line for line in body.splitlines() if line.startswith("| ") and line[2].isdigit()]
    region_rows = [r for r in rows if r.count("|") >= 10]
    assert any("| color |" in r and "Colour copy" in r and "#cc0000" in r and "color" in r.split("|")[9]
               for r in region_rows), "should classify the text colour change and explain it by `color`"
    assert any("| shift |" in r and "+12,+0" in r and "padding-left" in r for r in region_rows), \
        "should see the box content move 12px and tie it to padding-left"
    assert any("pixel-only" in r and "section" in r for r in region_rows), \
        "the square→circle icon has no text to pair; it must surface as pixel-only"
    assert len(region_rows) <= 4, f"the 60px banner must not cascade into every row below it: {region_rows}"
    added = body.split("## added locally")[1].split("##")[0]
    assert "New banner" in added, "should report the inserted banner"
    assert "Inserted left" in added, "should report the item inserted into the left column"
    assert not any("Right one" in r or "Left two" in r for r in region_rows), \
        "an insertion in one column must not flag the column beside it"
    assert "12:59" not in body,"a masked element must not produce a region"
    assert "| padding-right | 1 |" in body, "an invisible style diff should be reported as such"
    assert os.path.exists(os.path.join(d, "pixel-montage.png"))


def main():
    # Windows consoles default to a legacy codepage (e.g. cp950); page text
    # echoed to stdout must not crash the run.
    for stream in (sys.stdout, sys.stderr):
        if hasattr(stream, "reconfigure"):
            stream.reconfigure(errors="replace")
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest="cmd", required=True)

    d = sub.add_parser("diff", help="compare computed styles of two rendered URLs")
    d.add_argument("--ref", required=True, help="reference URL (old page / staging)")
    d.add_argument("--local", required=True, help="URL under development")
    d.add_argument("--map", help="JSON file: {\"<ref selector>\": \"<local selector>\"} manual overrides")
    d.add_argument("--width", type=int, default=1440)
    d.add_argument("--widths", help="comma list, e.g. 375,768,1440 (overrides --width)")
    d.add_argument("--height", type=int, default=900)
    d.add_argument("--wait-selector", help="wait for this selector before collecting")
    d.add_argument("--extra-wait", type=float, default=0, help="extra seconds after networkidle")
    d.add_argument("--out", default="parity-diff.md")

    r = sub.add_parser("responsive", help="diff at 375/768/1440 plus horizontal-overflow check")
    for a in ("--ref", "--local"):
        r.add_argument(a, required=True)
    r.add_argument("--map")
    r.add_argument("--height", type=int, default=900)
    r.add_argument("--wait-selector")
    r.add_argument("--extra-wait", type=float, default=0)
    r.add_argument("--out", default="parity-responsive.md")

    f = sub.add_parser("flow", help="run an interaction flow, collect console + network errors")
    f.add_argument("--steps", required=True, help="JSON array of step objects")
    f.add_argument("--out", default="parity-flow.md")
    f.add_argument("--headed", dest="headless", action="store_false", default=True)
    f.add_argument("--keep-going", action="store_true", help="continue after a failing step")
    f.add_argument("--video", help="record the run to this path; .mp4 converts via ffmpeg, .webm keeps the native output")
    f.add_argument("--video-size", default="1280x720", help="WxH of both the recording and the viewport (default 1280x720)")
    f.add_argument("--video-tail", type=float, default=1.0, help="seconds to keep recording after the last step so trailing animations finish (default 1)")

    x = sub.add_parser("pixel", help="OpenCV screenshot diff, aligned by matched elements and "
                                     "cross-checked against computed styles")
    x.add_argument("--ref", required=True)
    x.add_argument("--local", required=True)
    x.add_argument("--map", help="same as diff --map; better pairing also means better alignment")
    x.add_argument("--width", type=int, default=1440)
    x.add_argument("--height", type=int, default=900)
    x.add_argument("--wait-selector")
    x.add_argument("--extra-wait", type=float, default=0)
    x.add_argument("--mask", action="append", default=[],
                   help="selector painted out on both pages (clocks, ads, avatars); repeatable")
    x.add_argument("--threshold", type=float, default=3.0,
                   help="CIE76 ΔE a pixel must exceed to count as changed (default 3, about just-noticeable)")
    x.add_argument("--min-area", type=int, default=6, help="ignore regions with fewer changed pixels")
    x.add_argument("--max-height", type=int, default=10000, help="clip screenshots to this many px")
    x.add_argument("--top", type=int, default=6, help="regions drawn in the montage")
    x.add_argument("--out", default="parity-pixel.md",
                   help="report path; screenshots and montage are written next to it")

    sub.add_parser("selftest", help="verify the matcher/differ still work")

    args = ap.parse_args()
    if args.cmd == "diff":
        sys.exit(run_diff(args))
    if args.cmd == "pixel":
        sys.exit(run_pixel(args))
    if args.cmd == "responsive":
        args.widths, args.width = "375,768,1440", 1440
        sys.exit(run_diff(args))
    if args.cmd == "flow":
        sys.exit(run_flow(args))
    selftest()


if __name__ == "__main__":
    main()
