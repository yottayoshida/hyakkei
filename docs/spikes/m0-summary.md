# M0 gate: go/no-go decision (issue #30)

**Decision: GO**, with one acceptance item left for manual follow-up rather than fully
closed. #2, #3, and #28 pass their full acceptance criteria. #5 passes for every part
tested — including its own acceptance-critical `file://`-open check — but the SMB/
shared-folder acceptance case named in the issue was not testable in this environment and
remains open (see "#5" section below). No ADR-0004 escape hatch (SQLite-WASM / SheetJS /
Vega-Lite) is triggered. M1 can proceed on the technology stack and architecture as
designed in ADR-0001, 0002, 0004, 0005; the SMB gap does not block that start.

| Must-complete | Result | Detail |
|---|---|---|
| #2 DuckDB-WASM feasibility | ✅ GO | `docs/spikes/m0-duckdb.md` |
| #3 ExcelJS fidelity | ✅ GO | `docs/spikes/m0-excel.md` |
| #28 SQL/network containment | ✅ GO | `docs/spikes/m0-containment.md` |
| #5 Component integration demo | ⚠️ GO for `file://`; SMB untested | this document |

## #5: component integration demo

**Pipeline tested**: local `.xlsx` selection (via `File` API — functionally identical
acquisition path to drag & drop) → ExcelJS parse → DuckDB-WASM aggregation, served under
the exact CSP header verified in #28 (`spikes/integration-demo/run.mjs`) → ECharts bar
chart, live in Chromium/Firefox/WebKit. Then: bake the query result into a static JSON
structure, build a single self-contained HTML file with that data + an inlined ECharts
bundle (no DuckDB, no SQL, no ExcelJS), and verify it opens via `file://` with zero
additional network requests in all 3 engines.

Network containment itself (the CSP/DuckDB-flag mechanism) is #28's finding, not
re-derived here — what this demo adds is confirming the *whole pipeline wired together*
(ExcelJS + DuckDB + ECharts in one page) still works correctly with that same CSP
actually applied, which an earlier pass of this same spike had omitted.

### Editor pipeline: pass in all 3 engines

| Engine | ExcelJS parse | DuckDB aggregate | Chart rendered |
|---|---|---|---|
| Chromium | ✅ | ✅ (福祉 5.3M / 税務 4.3M / 住民登録 2.0M — correct) | ✅ |
| Firefox | ✅ | ✅ | ✅ |
| WebKit | ✅ | ✅ | ✅ |

"Chart rendered" here means an ECharts instance initialized against the baked data and
produced a `<canvas>` element — a wiring/crash check, not a pixel-level visual
correctness check. No fixture-vs-render visual diffing was done at M0.

Bonus finding beyond this issue's scope but directly relevant to M1/M2 architecture:
**ExcelJS bundles and runs correctly in a real browser context** (via esbuild,
`platform: browser`) — the editor's "parse the user's local file" path is not Node-only,
it works the same way client-side. Bundle size is large (4.6 MB unminified glue bundle
including ExcelJS + DuckDB + ECharts together) — minification and code-splitting are an
M1/M2 concern, not a blocker found here.

### Export artifact: pass in all 3 engines, zero external requests

The exported `dashboard-export.html` (1.1 MB, ~1.1 MB of which is the embedded ECharts
UMD bundle) opened via a direct `file://` URL and initialized its chart (same
canvas-exists check as above) in all 3 engines, with **zero additional network requests**
beyond the initial file navigation — confirming the single-file artifact is genuinely
self-contained. `grep`-ing the exported file for `duckdb`/`wasm`/`SELECT * FROM`/`exceljs`
returns zero matches: the query engine and parser are structurally absent from what
ships, exactly as ADR-0005 requires. This `file://` open is the acceptance-critical part
of issue #5's export check and it passes cleanly; only the additional SMB-path variant of
the same acceptance criterion is untested (next section).

### Untested: SMB/shared-folder path (acknowledged limitation)

This sandbox has no real SMB share available. The `file://` double-click-equivalent test
above is the closest available proxy; SMB-specific concerns (UNC path resolution,
same-origin/`file://` security model quirks over a network share, Windows vs. macOS SMB
client differences) are **not** covered by this spike. **Recommended as a manual
verification task before M1 acceptance (#10) or M3 acceptance (#20)** — mount a real SMB
share and repeat the double-click test in at least one engine per OS.

### "Safari" caveat (originally stated in m0-duckdb.md, applies equally here)

All "3 browsers" results in this spike (and in #2 and #28) use Playwright's `webkit` —
the real WebKit engine, not literally Apple's Safari application. This is the closest
automatable proxy available, but Safari-specific packaging, security prompts, or version differences
are not ruled out.

## Cross-cutting discovery: `enable_external_access=false` has a side effect

While building the integration demo, applying `enable_external_access=false` (one of the
defense-in-depth flags from #28 and ARCHITECTURE §6) **broke the editor's own core
workflow** — it also blocks `registerFileBuffer`'s local, in-memory virtual-filesystem
reads, not just network access. DuckDB's flag doesn't distinguish "a buffer the user just
uploaded" from "an external resource." The demo works correctly with this flag omitted,
relying on CSP `connect-src` alone for network containment — which #28 already
established is sufficient by itself.

**This must be carried into M1/M2 design** (SR-1 "封じ込め" implementation — the
`enable_external_access` sequencing question is a containment detail, unrelated to SR-2
DataSource centralization): either (a) don't
set `enable_external_access=false` at all and rely on CSP as the sole network-containment
layer (supported by #28's unrestricted-mode result), or (b) sequence it — load and
register all local data first, then apply the flag before running further ad-hoc user
SQL, if DuckDB-level defense-in-depth is still wanted for that later stage. Option (a) is
simpler and already proven sufficient; recommend it unless a concrete threat scenario at
M1/M2 needs the extra DuckDB-level gate.

## Recommendation for M1

1. Proceed with the stack as designed: DuckDB-WASM 1.32.0 (EH/MVP, COI excluded),
   ExcelJS, ECharts, CSP `connect-src` as the network containment primitive.
2. Bring forward from this spike into real (non-throwaway) code:
   - CSV/Excel encoding detection + `iconv-lite` pre-decode step (m0-excel.md finding)
   - The bake-function shape validated here (`{chart: {type, categories, series}, meta}`)
     as a starting point for the M1 `BakedDashboard` schema (plan §"判断1")
   - The exact CSP header tested in m0-containment.md
   - Document the ~200-300MB per-file soft ceiling (m0-duckdb.md) in user-facing copy
   - Do **not** set `enable_external_access=false` without the sequencing fix above
3. Manual follow-up (not blocking M1 start): real SMB share test, real government
   workbook corpus re-check (m0-excel.md limitation).
4. From QA shift-left review of this PR (V-ID tracking against `.claude/plans/2026-07-04-hyakkei-v0.1.md`
   "QA Shift-left" section), 4 items filed as GitHub issues for M1/M2 rather than left
   implicit in this doc:
   - **#42 — Legacy `.xls` (BIFF) format is not covered**: ExcelJS's fidelity in this
     spike was tested against `.xlsx` only; ExcelJS has little to no `.xls` support, and
     older government-distributed spreadsheets frequently are `.xls`. Needs an explicit
     product decision (reject with a clear error / convert / vendor a BIFF reader)
     before M2's upload UX ships, not discovered after.
   - **#43 — Main-thread responsiveness during multi-second parses is unmeasured**:
     this spike confirmed no crash/hang/OOM-white-screen, but not whether the UI stays
     responsive (e.g. a progress indicator, or whether a worker-based parse path is
     needed) during Firefox's ~4.8s ingestion or similar multi-second cases.
   - **#44 — Real OOM error surfaced in the actual editor's error UI**: this spike
     confirmed only that the underlying JS exception is catchable, not that the editor
     renders a real error state from it.
   - **#45 — Re-verify the messiness corpus against real government-distributed
     spreadsheets** once obtained (overlaps the manual follow-up noted above; filed
     separately since QA flagged it independently as load-bearing for the "10 messy
     workbooks" claim).
5. No plan re-baseline needed beyond the above — the M0 Amendment's must-complete
   ranking holds: **must** = issues #2, #3, #28, #5 (all resolved by this PR); **time
   -permitting** = GitHub issues #4 (ECharts/palette reproduction) and #29 (CORS
   reality check) — the only two issues carrying the `m0-time-permitting` label — plus
   two plan-internal measurement items (memory-ceiling UX copy, test infra decision)
   that were never filed as separate GitHub issues. All of these can proceed at the
   start of M1 rather than blocking it further. (Note: an earlier draft of this section
   miscited "#6, #7, #8" as if they were these time-permitting items — they are
   unrelated M1 issues (dashboard.json schema / DataSource abstraction / Renderer core)
   and the citation was wrong; corrected here after `/code-review` caught it.)
