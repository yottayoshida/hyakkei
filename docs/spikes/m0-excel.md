# M0 spike: ExcelJS fidelity on messy Japanese workbooks (issue #3)

**Status: GO.** ExcelJS read all 10 messiness-corpus fixtures without crashing or
silently corrupting data, and separately parsed a realistic-size 50,000-row workbook in
under 0.6s with no crash or hang in any of 3 engines. No SheetJS fallback triggered, no
further ADR-0004 amendment needed.

## Method

This issue confirms fidelity for the already-decided default parser (ExcelJS) — it is
not a bake-off against alternatives (per ADR-0004 Amendment, 2026-07-05: SheetJS CE is
disqualified as a default, npm-withdrawn with unpatched CVEs in its frozen version).

10 fixtures were generated programmatically (`spikes/excel-fidelity/generate-fixtures.mjs`)
to cover the messiness patterns named in the issue plus additional realistic dirty-data
classes, since real government-distributed workbooks were not obtainable for this spike
(see Limitation below). Each fixture targets one specific ExcelJS fidelity question, not
a downstream normalization question — "did ExcelJS return the file's actual content
correctly" is a different question from "does the app's business logic handle 和暦 dates,"
and only the former is this issue's scope.

## Results — all 10 pass

| # | Fixture | ExcelJS fidelity finding |
|---|---|---|
| 1 | 2-row merged header (`B1:C1`) | **ExcelJS mirrors the anchor cell's value into every merged cell on read** — `C1` reads `"売上"`, not `null`. This corrected an initial wrong assumption in this spike's own test (see below) and means the app does **not** need to manually forward-fill merge ranges from `worksheet.model.merges`. |
| 2 | 和暦 dates as plain text (`令和6年4月1日`) | Returned verbatim, correct encoding. ExcelJS does no date parsing on these (they're text cells, not native Excel dates) — 和暦→西暦 conversion is entirely the app's responsibility. |
| 3 | Full-width digits (`１２３４`) as text | Preserved verbatim as a string; not silently coerced to a number or half-width. App must normalize. |
| 4 | 3 preamble rows before the real header (row 4) | `rowCount` correctly reports all 6 rows; nothing dropped. Header-row detection is the app's job — ExcelJS gives it a complete, ordered row set to search. |
| 5 | 3 sheets, same shape (本庁/支所A/支所B) | All 3 enumerated by name in `workbook.worksheets`, each independently readable. |
| 6 | Shift_JIS CSV, no BOM | **ExcelJS has no built-in encoding detection or Shift_JIS support.** Handing it raw Shift_JIS bytes produces mojibake (`部署` → garbage). Pre-decoding the buffer with `iconv-lite` to a UTF-8 string before piping it into `workbook.csv.read()` fixes it completely. **This is a required app-level step**, not optional hardening. |
| 7 | UTF-8 CSV with BOM | ExcelJS's CSV reader strips the BOM automatically — first header cell reads `"id"`, not `"﻿id"`. No app-level handling needed. |
| 8 | Vertically merged first column (hierarchical report style) | Same mirroring behavior as #1 — no manual forward-fill needed. |
| 9 | Mixed types in one column (`1234` number vs. `"1,234"` text) | ExcelJS correctly reports distinct cell types (`Number` vs. `String`) for the two rows — the app can reliably detect which cells need comma-stripping and parsing, rather than guessing from a single mixed-type column scan. |
| 10 | Formula cell (`=SUM(B2:B3)`) | ExcelJS returns the **cached computed result** (`{formula, result: 250}`) without needing to evaluate the formula itself — **when a cached result is present**, which this fixture deliberately writes in. This does not test what ExcelJS returns for a formula cell with no cached result (e.g. `fullCalcOnLoad`-marked workbooks, or files from tools that don't cache results). Treat "no formula-evaluation-engine needed" as conditional on the cache being present; M1/M2 should decide how to surface or recompute a missing `.result` rather than assume it's always there. |

## Scale: 50,000-row workbook, browser-side parse (separate from the messiness corpus)

The 10 fixtures above are small (a handful of rows each) and test *pattern* fidelity, not
*scale*. The plan's original M0 measurement item for ExcelJS also specified a 50k-row
file as a parse-time/crash risk check — this is a distinct concern from messiness
fidelity and is tested separately here (`spikes/excel-fidelity/large-perf/`), in the
browser (not Node), since that's the runtime that actually matters for "does this crash
the user's tab."

A synthetic 50,000-row, 5-column `.xlsx` (1.4 MB, realistic column mix: id/date/
prefecture/category/amount) was loaded via `File.arrayBuffer()` → `workbook.xlsx.load()`
in Chromium, Firefox, and WebKit:

| Engine | `xlsx.load()` time | Peak process RSS | Crashed / hung |
|---|---|---|---|
| Chromium | 350 ms | 392 MB | no |
| Firefox | 597 ms | 986 MB | no |
| WebKit | 431 ms | 775 MB | no |

All three engines parsed all 50,000 rows correctly with no crash and no hang. Peak
memory (same process-tree RSS methodology as `m0-duckdb.md`) is well within a single
tab's normal budget for a 1.4 MB source file — no OOM risk observed at this scale.

## Spike methodology note (fixed a wrong assumption mid-spike)

Tests 1 and 8 initially "failed" because this spike's own test code assumed ExcelJS
returns `null` for non-anchor cells inside a merge range (a common behavior in other
libraries). Actual behavior is the opposite — ExcelJS mirrors the anchor's value across
the whole merge. This is recorded as a fidelity **finding** (it simplifies the app's
merge-handling code) rather than a defect, once the test assertions were corrected to
match observed, verified behavior.

## Limitation: synthetic corpus, not real government workbooks

The 10 fixtures are synthetic approximations built to exercise known messy-data classes
(merged headers, 和暦 dates, full-width digits, preamble rows, multi-sheet, Shift_JIS/BOM
CSV, mixed types, formulas) — actual government-distributed Excel files were not
available in this environment. Real-world workbooks may combine these patterns in ways this corpus
doesn't (e.g., merges nested inside a non-row-1 header, or encoding inconsistent *within*
a single multi-sheet file). **Recommend re-running this same check script against a small
sample of real public-sector spreadsheets once obtained** (e.g., during the P1 hearing
work already planned in parallel with M0) as a confirmation pass, not a gating requirement
for M1 to proceed.

## Recommendation

- **Go** on ExcelJS as the default (only) Excel parser for v0.1. No SheetJS vendoring path
  needed.
- Carry forward to M1/M2 implementation:
  1. **Encoding detection is required before ExcelJS's CSV path** — ExcelJS will silently
     mojibake Shift_JIS input with no error. Needs either explicit user encoding choice or
     a detection heuristic (e.g. `jschardet`/`chardet`) + `iconv-lite` decode step.
  2. Merged-cell forward-fill is *not* needed in app code — ExcelJS already mirrors values.
  3. 和暦 date conversion, full-width digit normalization, and comma-formatted number
     parsing are confirmed app-level responsibilities (F1/F2 territory), not ExcelJS gaps.
  4. Formula cells can be read via cached `.result` with no formula evaluation engine —
     only confirmed for the cache-present case; decide M1/M2 handling for missing cache.
  5. 50,000-row parse is fast and crash-free in all 3 engines (see Scale section); no
     size-based ExcelJS escape hatch is needed at this order of magnitude.
