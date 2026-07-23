# ADR-0014: Incremental mount() (`patch()`) and the unified dashboard-grid preview

- **Status**: Accepted (2026-07-23)
- **Deciders**: yotta

## Context

Issue #70: `mount()` disposes every ECharts instance and rebuilds the whole DOM tree on every call, which is fine for a static viewer but would make the M2 editor's live-editing loop dispose/re-init N instances on a single-chart edit — once a component actually feeds N charts into one `mount()` call. At the time #70 was filed, no such component existed: `DashboardPreview` (App.tsx) renders one static, never-edited sample, and `ChartPreview.tsx` (issue #12) mounts exactly one chart per container per card. Confirmed by direct investigation before this PR started: **issue #70's stated failure mode did not reproduce anywhere in the codebase**.

It becomes real only once issue #12 ADR-0013's deferred "(B) unified dashboard-grid preview" (`AuthoringDashboardPreview.tsx`) is built — a single component rendering every chart the user has created, arranged by the same auto-placement (A) `ChartBuilder` cards use. User decision: build #70's differential-update path and (B) in the same PR, since #70 in isolation has no real consumer to verify correctness against, and (B) without #70 would reproduce the exact full-teardown/rebuild problem #70 exists to prevent — each is unjustifiable without the other.

`/plan` investigation (architect + QA + security + UX, one Codex MCP review round on the investigation, one on the finished plan, both real `gpt-5.5`) plus an architect-attempted shape enumeration (interrupted mid-run by a weekly API usage limit and completed directly by the orchestrator instead, `shape_complexity: high`) surfaced the decisions below.

## Decision

### A new `patch()` function; `mount()`/`unmount()`'s public contract is unchanged

`mount()`'s signature, behavior, and golden-tested output stay byte-identical (all 465 pre-existing `packages/core` tests, including every golden-samples fixture, pass unmodified). Internally, `mount()`'s own tile-construction loop was extracted into a shared `buildFullyFromScratch()` helper so `patch()`'s initial-call and duplicate-degrade paths can reuse it verbatim instead of drifting into a second, independently-maintained copy — `mount()` itself just calls `unmount()` then this helper, exactly as before. `unmount()`'s own observable behavior (dispose every live instance for a container) is unchanged, but its internal implementation now also clears `patch()`'s own per-container registry (`mountStates`) — necessary so a container `patch()` was driving doesn't leave stale differential-update state behind once something calls `unmount()` on it directly, or `mount()` is called on that same container afterward.

### Differential key: chart id **and** `chart.type` together — never id alone

The issue's own phrasing ("only init/dispose when the id set changes") read literally would reuse a surviving instance via `setOption` even across a type change (e.g. bar→pie, both ECharts-backed) — rejected for two independently-arrived-at reasons. First, Jakob's Law: (A) `ChartBuilder.tsx`'s own `DashboardErrorBoundary` key (`${chart.type}:${JSON.stringify(chart.encoding)}`, issue #12 Phase 8) already treats a type/encoding change as "tear the whole thing down and rebuild" — the same user action producing different teardown behavior in (A) vs (B) would be a real inconsistency. Second, correctness: `xyOption`'s axis/series shape and `pieOption`'s shape are structurally different `EChartsOption` trees; `setOption(..., {notMerge:true})` across that boundary has no verified guarantee of leaving no residual internal state. `patch()`'s actual reuse guard (`prevTile.type === entry.chart.type`, `mount.ts`) requires an exact match — same-family-different-type (bar→line) is also **not** reused, the more conservative reading.

### Registry: `WeakMap<HTMLElement, Map<chartId, Held>>`, container-scoped

Mirrors the existing `resizeObservers`/`resizeDebounceTimers` container-scoped `WeakMap` pattern, widened from a 1:1 (container → one observer) to a 1:N (container → many charts) shape those two precedents didn't need. Never a global `Map<chartId, Held>` — (A) `ChartPreview` and (B) `AuthoringDashboardPreview` can mount the *same* chart id into two different containers simultaneously (verified directly: disposing one container's registry entries never touches the other's live instance for the identical id). The registry key is Map-based throughout (never a plain `{}`), since `Chart.id`/`Query.id` are unrestricted `NonEmptyString`s reachable by a hand-edited `dashboard.json`.

### Duplicate chart-id references in `layout.items` degrade the whole container to a full rebuild

`validateLayoutReferences` (schema) only checks dangling references, out-of-bounds, and pairwise overlap — it does not reject two `layout.items` entries referencing the same chart id at non-overlapping positions. A chart-id-keyed registry cannot represent "one id, two live instances" (confirmed: `LayoutItem` has no item-level id of its own, `packages/schema/src/common.ts`). Detected via a `Set` walk over `layout.items` before the main diff; on detection, the whole container's registry is cleared and rebuilt from scratch — a deliberate, documented degrade (never a partial/per-item reconciliation attempt), so the correctness guarantee ("never mis-render") never depends on reconciling an ambiguous case.

### `ChartState` gains `"pending"`/`"error"`, applied by the app layer, not by `normalizeAuthoring`

(A) `ChartPreview.tsx` sidesteps representing "this chart's query hasn't resolved yet" by simply never calling `mount()` while pending — for a single chart, that's sufficient. (B) renders every chart in one call, so one slow/failed query cannot be allowed to block the others from rendering, and the previously-only-3-valued `ChartState` (`"ok"|"empty"|"unconfigured"`) has no way to distinguish "the query legitimately resolved to zero rows" from "the query hasn't resolved yet" — collapsing pending to `"empty"` would show a false-negative "データがありません" during ordinary loading. `normalizeAuthoring` itself is untouched (its `rowsByQuery: Record<string, Row[]>` contract has no room for a third value) — `AuthoringDashboardPreview.tsx` calls it, then overlays `state: "pending"`/`"error"` onto entries whose `chart.query` maps to a non-ready `ChartRowState`. `normalizeBaked` can never produce either state, for the same reason it can never produce `"unconfigured"` — a baked snapshot is always fully resolved.

### The boundary key wrapping (B) is a stable constant, never a value that changes per edit

The single most consequential design risk this PR identified: (A)'s own `DashboardErrorBoundary` key is deliberately unstable (`type:encoding`) so it remounts on the one class of edit that could leave `mount()` throwing forever. (B) wraps the *entire grid*, not one chart — an unstable key here would force React to unmount/remount the whole subtree on every edit, discarding `patch()`'s own registry (`mountStates`) each time and silently erasing this PR's entire performance point while still *appearing* to work correctly. (B)'s boundary key is a fixed string constant. Recovery from a genuinely stuck/wrong render is instead a dedicated "再構築" (rebuild) button that calls `unmount()` then `patch()` again — cheaper than a page reload (which would lose the DuckDB-WASM session) and does not depend on React's own remount machinery.

## Alternatives considered

| Option | Rejected because |
|---|---|
| Making `mount()` itself stateful/differential (no new `patch()`) | Breaks existing `mount.test.ts` contracts (`observer-per-mount`, `full-dispose-on-remount`) that bake/CLI/static `DashboardPreview` depend on; forces two irreconcilable consumer expectations ("always fully rebuild" vs "diff please") into one function |
| `react-echarts` / a generic DOM-diffing library (morphdom etc.) | ECharts instances live in a module-level registry outside the DOM tree a generic differ inspects — a library that swaps/moves canvas nodes without knowing this reintroduces the exact instance-leak class issue #69/#68 already closed. A React-specific renderer also can't be called from `bake()`/CLI (no DOM, no React), breaking the `authoring==baked` pixel-identity invariant golden/convergence tests rely on |
| Content-equality (deep-equal) diffing instead of reference-equality | `buildOptions`/`buildChartOption` are pure functions of `(chart, rows, theme)`; `normalizeAuthoring` is reference-transparent for `chart`/`rows` (confirmed directly), and App.tsx's own state updaters already preserve untouched entries' references — reference equality is therefore both sufficient and O(1), where a deep-equal would re-walk arbitrarily large option trees on every edit for no additional correctness |
| Reusing a surviving instance across a type change (literal reading of #70) | Rejected -- see Decision, "differential key" |
| Keying the registry by a `layout.items`-level id instead of chart id | `LayoutItem` has no item-level id in the current schema; would be the stronger design if one existed, but adding one is out of this PR's scope. Chart-id keying + duplicate-degrade is the pragmatic fit for the schema as it stands today |
| Migrating (A) `ChartPreview.tsx` to `patch()` too | (A) mounts exactly one chart per container — the N-instance problem `patch()` solves does not exist there. Revisit if/when (A) ever renders more than one chart per container |

## Residual risks (accepted for this PR)

- **RR-1 — Reference-stability is a caller discipline, not a type-enforced invariant.** `patch()`'s cheapest path (skip touching ECharts entirely) is sound *only* as long as `AuthoringDashboardPreview.tsx` keeps passing through App.tsx's own reference-preserving state updates unchanged. If a future refactor started re-mapping `charts`/rows into new array/object instances on every render, the optimization would silently degrade to "always call `setOption`" (still correct, per the worst-case analysis in `patch()`'s own design) — never to a stale/wrong render, but the perf win issue #70 exists for would quietly disappear. Pinned by `mount.test.ts`'s own V-015 reference-stability tests; no additional runtime guard exists.
- **RR-2 — Duplicate chart-id-in-`layout.items` always degrades to a full container rebuild, never partially reconciled.** Accepted as correct-by-construction (this PR's own thesis: never mis-render) rather than optimal; the app itself only ever produces one `layout.items` entry per chart (`nextFreeCell`), so this path is reachable only via a hand-edited or future-imported `dashboard.json`, not through this PR's own UI.
- **RR-3 — `AuthoringDashboardPreview.tsx`'s manual "再構築" (rebuild) button is a recovery mechanism for a *hypothetical* silent-wrong-render bug**, not a reaction to one observed in this PR's own testing (`mount.test.ts`'s `patch()` suite found none). Kept because the failure mode it defends against — a stale/incorrect reuse that renders without throwing — is invisible to `DashboardErrorBoundary` by construction (it only catches actual exceptions).
- **RR-4 — The shape enumeration for this PR was completed directly by the orchestrator, not the `architect` subagent**, after the subagent hit a weekly API usage limit mid-run. The completed enumeration (`serialized-soaring-map-issue70-shapes.md`) still surfaced one previously-undocumented shape (`layout.items` array-order changes, L4) that was folded into the plan and implementation before Phase 3; no further gaps have surfaced in Phase 6 review as of this writing.

## Consequences

- (+) Editing one chart in a multi-chart grid no longer disposes/re-inits every other chart's ECharts instance — the actual problem issue #70 names, now backed by a real consumer ((B)) instead of speculative infrastructure with nothing to call it.
- (+) `mount()`/`buildOptions`'s existing single-call consumers (bake/CLI/`DashboardPreview`, and any future `v0.4` CLI or `#26` MCP export path) are provably unaffected — same signature, same behavior, same golden output.
- (+) (A) per-card preview and (B) grid preview can coexist showing the same chart in two different containers without cross-contaminating each other's ECharts instance lifecycle.
- (−) `mount.ts`'s module-level state surface grew (`resizeObservers`/`resizeDebounceTimers`/`mountStates`) — approaching, per UX review, the point where a future addition to this file should look hard at consolidating these into one explicit per-container state object rather than three parallel `WeakMap`s.
- (−) (B)'s auto-placed grid is read-only in this PR (no drag-to-rearrange) — an explicit, UI-communicated scope boundary, not an oversight (see plan's "やらないこと").
