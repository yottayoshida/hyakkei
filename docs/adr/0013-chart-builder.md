# ADR-0013: Chart builder — query-id-keyed row cache, bootstrap-on-add chaining, per-card authoring preview

- **Status**: Accepted (2026-07-23)
- **Deciders**: yotta

## Context

PRD F3, M2 editor's next PR after issue #11c (light shaping GUI: filter/group-by/aggregate, ADR-0012): "Charts: bar, line, area, pie/donut, scatter, table, stat tile." ARCHITECTURE §4's flow (`user builds chart in GUI -> GUI emits SQL into queries[] -> Renderer runs the query`) is now complete on the query side (#11c); this PR is the chart/encoding half — turning a `WorkspaceQuery`'s resolved result into a `Chart` + live preview.

Schema (`ChartVariant`, `ChartOptions`) and the renderer pipeline (`normalizeAuthoring` -> `buildOptions`/DOM builders -> `mount()`) already existed, fully tested for all 7 types (`authoring-baked-convergence.test.ts`), before this PR started — confirmed by architect investigation. This PR's actual work was entirely new: the app-side wiring that fetches live rows for a chart's query and feeds them through that existing pipeline, plus the GUI to create/edit a chart.

`/plan` investigation (architect + QA + security + UX, 2 Codex MCP review rounds — one on investigation results, one on the finished plan, both real `gpt-5.5`) plus an architect-run shape enumeration (`shape_complexity: high`, mirror pattern borrowed from `QueryBuilder.tsx`) surfaced the decisions below. The shape enumeration found 5 further defects (F1-F5) in the ALREADY-Codex-reviewed plan by mechanically enumerating the `query.sql` state × `chart.query` presence × lifecycle-event × `rows` state cross product — including one Critical-severity gap (F3) in a design Codex's own plan-level review had already passed. A PoC (5 scenarios, plain-TS harness, no React/DuckDB) verified the corrected design before real implementation began.

## Decision

### Reused the existing `normalizeAuthoring`+`mount()` pipeline directly — no new core module

`normalizeAuthoring(doc, rowsByQuery)` (`packages/core/src/renderer/render-model.ts`) already reads only `doc.charts`/`doc.layout`/`doc.theme`, never `doc.sources`/`doc.queries` — it was already usable for a live, non-persisted authoring `Dashboard` without any change. This PR's only new core-adjacent surface is `ChartPreview.tsx` (app layer): it builds a minimal single-chart `Dashboard` document (empty `sources`/`queries`, one chart, one layout item) and calls `normalizeAuthoring`+`mount()` directly — the same rendering contract the existing (baked-only) `DashboardPreview` already uses.

### Chart-row cache and generation-guard are keyed by **query id**, not chart id

Multiple charts can reference the same query (`Chart.query`). A chart-id-keyed cache/guard would need a separate "is any OTHER chart still using these rows" check on every delete path; keying by query id instead makes deletion a single uniform rule (`handleChartDelete` prunes a query's cache entry only once zero charts reference it). Discovered as a correction to the plan's own original chart-id-keyed design (shape enumeration F5) — the plan (post-Codex-review) had specified chart-id keying without having enumerated the shared-query case concretely.

### An independent `chartGenerationRef`, separate from `queryGenerationRef`

Chart rows use a different LIMIT (`CHART_ROW_LIMIT = 5000`, vs. the query preview's fixed 50) and a different result shape than the query preview — sharing one counter would let either refresh spuriously cancel the other. Mirrors this codebase's own established precedent of splitting validation/preview counters (issue #11b) for the identical reason.

### Chart-row re-fetch triggers from exactly two places: `refreshQueryPreview`'s own success/catch paths, and `handleAddChart`'s explicit bootstrap call

The plan (as Codex-reviewed) specified centralizing the re-fetch trigger entirely inside `refreshQueryPreview`'s success path, on the reasoning that every caller (`handleQueryBuilderChange`, the override sweep, `handleAddQuery`) would then "get it for free," with no caller-side change needed. **This was wrong** (shape enumeration F3, Critical): `refreshQueryPreview`'s chaining only fires when a query is *re-resolved*. Adding a chart to a query that has *already* resolved (the ordinary case — the "グラフ化" button is disabled until resolution, so this is the common path, not an edge case) never triggers a fresh `refreshQueryPreview` call, so the centralized trigger never fires and the new chart's rows never arrive. `handleAddChart` now explicitly calls `refreshChartRows` once, immediately after creating the chart, as a one-time bootstrap — `refreshQueryPreview`'s chaining remains the sole mechanism for every SUBSEQUENT re-fetch (query edits, override changes). A PoC (5 scenarios) verified both paths and their interaction (including that a stale, superseded fetch never overwrites a newer one) before this was wired into real React hooks.

### Query-error fail-closed clearing extends symmetrically to chart rows

`refreshQueryPreview`'s catch block already clears the query preview to its "nothing resolved" defaults on any unexpected (non-`RangeError`) failure (ADR-0012's own "silent fail = zero" fix). This PR extends the same catch block to also set any referencing chart's row-cache entry to an explicit `{status: "error"}` (not left at its last-successful value) — otherwise a query error would clear the preview table while a chart built from that same query kept showing stale rows, violating the same invariant ADR-0012 already established one layer down.

### `reconcileEncoding` rebuilds a chart's encoding completely on a type switch — never spreads the prior type's shape forward

`ChartVariant` is a discriminated union (`type` + `encoding` pair). Reusing PREVIOUS column VALUES (not field names) as a best-effort pool, filtered against the CURRENT query's `previewColumns`, then assigning the new type's required fields from that pool (falling back to a position-based smart default: first column = "the dimension", last = "the measure") avoids ever emitting an encoding shape mismatched to its own `type`.

**The plan's original rationale for this ("leftover fields would make Ajv reject the document at F7 save time") was itself wrong** (shape enumeration F2, Major, empirically verified via a 7×7 real-Ajv-round-trip test): `ChartVariant`'s `encoding` schema has no `additionalProperties: false` (confirmed by reading `common.ts` directly — `SafeObject(encoding)` only constrains property NAMES, not exhaustiveness), so leftover keys from a prior type pass Ajv validation without complaint. The actual reject risk is a REQUIRED field being absent (only reachable via a 0-column query or a `reconcileEncoding` bug, both guarded elsewhere) — complete-rebuild was kept for three narrower, still-real reasons: avoiding spurious `checkEncodingColumns` advisories at bake time, prototype-pollution-discipline consistency (no untraced key ever crosses a type boundary), and golden-fixture stability. The test suite (`chart-encoding.test.ts`) verifies the corrected claim directly: every one of the 49 (type × type) transitions produces a document that round-trips through the REAL generated Ajv validator (`parseDashboard`), not merely "has no excess keys."

### `stat`'s type-mismatch warning is excluded; `scatter`'s covers x, y, AND size

The plan's v1 type-mismatch detection (no category gating; a non-blocking warning when a chart type's numeric-consuming channel(s) are entirely null after rendering) originally listed `stat`'s `value` as a numeric channel to warn on. Reading `dom/stat.ts` directly showed this is wrong: `buildStatElement` renders `value` via `cellText` (plain string display), never `numericCell` — a text column assigned to `stat`'s value renders correctly (as text), so a "looks null, must be a type mismatch" warning would be actively incorrect for this one type. `scatter`, conversely, needed WIDENING: `build-options.ts` confirmed both `x` and `y` (and `size`, when set) are independently passed through `numericCell` — the plan's original scope (`y` only) would miss a type mismatch on the x-axis.

### Auto-placement (`nextFreeCell`) correctness is verified against the schema's own PUBLIC validator, not the internal one the plan originally named

The plan (as Codex-reviewed) named `validateLayoutReferences` as the oracle for auto-placement correctness. That function is not exported (`packages/schema/src/validate.ts`) — the actual public API is `validateDashboardReferences`, which calls the internal one. `layout-placement.test.ts` builds a minimal `Dashboard` document and calls the public function, exactly as the plan's own `V-005` test snippet had already (correctly) done — only the surrounding prose named the wrong function as directly callable.

### `DashboardErrorBoundary` extracted to its own module

`ChartBuilder.tsx` needs the same error boundary `DashboardPreview` (App.tsx) already uses. Leaving the class defined in `App.tsx` would require `chart/ChartBuilder.tsx` to import from `../App.js`, which itself imports `ChartBuilder` — a circular module dependency. Moved to `dashboard-error-boundary.tsx` (no behavior change) and re-exported from `App.tsx` so existing imports of `DashboardErrorBoundary` from `./App.js` (including `App.test.tsx`) keep working unchanged.

### Scope: per-card inline preview (A) implemented; unified dashboard-grid preview (B) deferred

The plan named (A) per-`ChartBuilder`-card inline preview as required (directly satisfies the confirmed completion criterion, "実データでのライブプレビューまで") and (B) a unified grid preview (replacing the static `SAMPLE_DASHBOARD` once ≥1 real chart exists) as an optional same-PR stretch goal. (A) is fully implemented and e2e-verified (3 browsers); (B) is deferred to a follow-up — the Map→Record boundary conversion helper it would need (`chartRowsByQuery` is a `Map` in app state; `normalizeAuthoring` requires a `Record`) was designed but not built, since no consumer needs it without (B).

## Alternatives considered

| Option | Rejected because |
|---|---|
| `bake()`-based preview adapter | Live editing would fabricate an F7-export artifact on every keystroke, risking `bake()`'s own skip/dangling contract firing unintentionally |
| New `core`-side chart-bake-adapter module | Row resolution needs a live DuckDB handle + `rowToPlainObject` — putting this in `packages/core/src/renderer` would pull DuckDB-WASM into the viewer bundle (issue #54 bundle isolation) |
| Chart-id-keyed row cache/generation-guard | Shape enumeration F5: breaks cleanly only when every chart has a distinct query; a shared query (2+ charts, same query) needs a "still referenced?" check the query-id-keyed design gets for free |
| Centralizing re-fetch entirely in `refreshQueryPreview`'s success path, no caller-side change | Shape enumeration F3 (Critical): never fires for a chart added to an ALREADY-resolved query — the ordinary, most common case, not an edge case |
| Category gating (restricting encoding `<select>` options to type-compatible columns) | Deferred per plan: a real UX nicety, not a correctness fix (renderer degrades non-crashingly either way); v1 ships the cheaper result-based warning instead |
| `stat` included in the numeric-channel type-mismatch warning | `dom/stat.ts` renders `value` as text (`cellText`), never numeric — a warning here would be actively wrong, not merely unnecessary |
| Unified dashboard-grid preview (B) in this same PR | Not required by the confirmed completion criterion; (A) alone satisfies it. Building (B) without a concrete second consumer to validate the Map→Record boundary against would be speculative scope expansion |

## Residual risks (accepted for this PR)

- **RR-1 — The smart-default encoding heuristic (first `previewColumns` entry = "the dimension", last = "the measure") is purely positional, not type-aware.** Category gating (which would need real column-type info threaded into `previewColumns`, not just names) is explicitly deferred per plan. A query whose column order doesn't match this heuristic's assumption (e.g., a measure column listed before a dimension column) gets a less-useful initial guess; the user can freely re-pick via the encoding `<select>`s, so this is a UX-quality gap, not a correctness one.
- **RR-2 — `CHART_ROW_LIMIT = 5000` is not tuned against a real large-dataset benchmark.** Chosen as a balance between scatter/table SVG/DOM rendering cost and practical usefulness; a truncation advisory (V-008) surfaces when the limit is hit, but the specific number is a judgment call, not an empirically-derived one.
- **RR-3 — `friendlyColumnLabel`'s measure-alias-to-friendly-label mapping is exact-string-match only.** A measure whose default alias collided with a real column name (and was therefore suffixed by `uniqueRawAlias`, ADR-0012) falls back to showing the raw (suffixed) alias verbatim in the encoding `<select>`s, rather than a "合計(column)"-style label. Accepted as a narrow, non-crashing display-quality gap in an already-rare collision scenario.
- **RR-4 — The unified dashboard-grid preview (B) is not implemented this PR** (see Scope decision above). The `Map`→`Record` conversion boundary it needs was designed (see plan) but not built or tested — a future PR implementing (B) should verify that boundary directly, not assume the design note alone is sufficient.
- **RR-5 — `toRow`'s Date→ISO-string and non-finite-number→null conversions are not exercised against a real DATE/TIMESTAMP-bearing DuckDB column in this PR's own test suite** (unit-tested with hand-constructed `Date`/`NaN`/`Infinity`/`BigInt` inputs, not a live DuckDB round-trip carrying one). Accepted: the conversion logic itself is simple and directly tested; a future PR touching date-typed chart data should add a live-DuckDB regression test if a real gap surfaces, following this project's own "verify before propose" discipline.
- **RR-6 — An existing chart's `encoding` is never automatically reconciled when its query's `previewColumns` later shrinks** (a column disappearing due to an elsewhere-made type override, ADR-0012's own "measure silently excluded" behavior) — `reconcileEncoding` only runs on an explicit user-initiated type switch, never as a reaction to the query itself changing shape. Confirmed live (Codex Round 1/2 e2e verification, `e2e/chart-builder.spec.ts`): the chart's rows DO genuinely re-fetch (this PR's core invariant holds — not silently stale), but the renderer's own pre-existing missing-column tile ("データに列が見つかりません: sum_件数") is what the user sees, not an auto-adapted chart. Accepted as correct, graceful-degradation behavior (the same safety net `mount.test.ts`'s V-105 already established for a baked chart's dangling encoding reference) rather than a bug — auto-healing a chart's encoding in reaction to an upstream query shape change is a distinct, non-trivial feature (which field(s) to drop, whether to re-run smart-defaults for the whole encoding) out of this PR's scope, not attempted.

## Consequences

- (+) A non-technical user creates any of the 7 PRD-required chart types entirely through the "グラフ化" button + visual type tiles + plain-Japanese encoding pickers — zero chart-spec authoring, matching the "not a spec editor" framing this PR's UX design establishes.
- (+) The existing, already-tested `normalizeAuthoring`/`mount()` pipeline is the ONLY rendering path for live preview — no new DOM-construction surface, preserving the closed-allowlist/escaping invariant `ChartOptions`'s own schema design depends on.
- (+) Shape enumeration (mandatory for this PR per `shape_complexity: high`) caught a Critical design defect (F3) in a plan that had ALREADY passed a full Codex review round — direct evidence the gate's own mechanical cross-product enumeration finds gaps a prose-level review can miss.
- (+) Cascade delete (source -> query -> chart -> layout item) and the query-id-keyed row cache together mean deleting anything upstream of a chart never leaves a dangling reference or a stale/orphaned row cache entry.
- (−) The unified dashboard-grid preview (B) remains unimplemented — a real chart, once created, is not yet visible in the context of the full dashboard's auto-placed layout, only per-card. Deferred, not forgotten (RR-4).
- (−) `reconcileEncoding`'s positional smart-default is a v1 heuristic, not a type-aware one (RR-1) — acceptable given category gating's own explicit deferral, but a known quality gap for follow-up.
