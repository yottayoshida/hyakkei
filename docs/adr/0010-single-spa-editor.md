# ADR-0010: Single-SPA editor integration — index.html absorbs intake, sources[] accumulate

- **Status**: Accepted (2026-07-21)
- **Deciders**: yotta

## Context

M1 shipped two separate Vite entries: `index.html` (a fixed-sample viewer, `App.tsx`) and `intake.html` (the file/URL ingestion UI, `IntakeApp.tsx`, issue #7's PR-B). M2's editor (issues #11-#16) needs both in the same session — a user drops data, then builds charts against it — but DuckDB-WASM is in-memory and session-scoped: a page navigation between two separate HTML entries would discard every registered table. Issue #11a is where M2's first PR reconciles this: `index.html` becomes the product's single entry, `IntakeApp` is embedded directly in a new editor shell (`App.tsx`), and `intake.html` is retired.

`/plan` investigation (architect + QA + security + UX, two rounds of adversarial review — one MCP Codex round before this session's Codex authentication lapsed, two subsequent proxy rounds via independent fresh-session review) surfaced three decisions this ADR records:

1. **How does the editor shell reuse `IntakeApp` without reshaping its already-hardened state machine** (`intake/types.ts`'s 6-phase reducer, generation-guarded async, `usedIds` collision tracking)?
2. **How is the entry-chunk isolation contract (issue #54's data-layer lazy-load boundary) re-verified once `index.html` legitimately needs to reach the data layer** — a property Stage A only ever proved for the now-retired `intake.html`?
3. **What semantic changes does "one source, terminal flow" → "sources[] accumulate, non-terminal" actually require**, beyond swapping which HTML file loads first?

## Decision

### `IntakeApp` embedded verbatim, `sources[]`/`usedIds` lifted to the shell — reducer untouched

`App.tsx` owns `sources: WorkspaceSource[]` (accumulated, `useState`) and `usedIds: Set<string>` (also `useState`'s lazy initializer, not `useRef` — the react-hooks `refs` lint rule forbids reading `ref.current` during render, and `usedIds` is read in JSX to pass down as a prop). `IntakeApp` itself gets three new props (`mode: "onboard" | "panel"`, `usedIds`, `onComplete`) and loses its former `handleConfirm`/`handleRedo` — the reducer (`intake/types.ts`) is **unchanged**. `IntakeApp` still owns `generationRef`/`pendingSheetPickRef` (attempt-scoped state that correctly resets when a panel-mode instance unmounts); only `usedIds` moved to the shell, because it must outlive any single `IntakeApp` mount ("add another source" mounts a fresh instance per attempt, but the DuckDB catalog and the ids reserved against it persist across that).

**Rejected: lift the reducer itself to shell-level state**, with `IntakeApp` reduced to a presentational sub-view. `#11a` registers sources one at a time (never two attempts concurrently) — accumulation lives correctly in a plain array *outside* the reducer, at zero cost to the reducer's existing guarantees. Reshaping a reducer whose phase-guard discipline and generation-based staleness handling were already hardened through multiple prior review rounds, for a benefit `#11a`'s actual usage pattern doesn't need, was assessed as pure regression risk.

### `onComplete` fires from an effect watching `phase === "registered"`, not an imperative call

```ts
useEffect(() => {
  if (state.phase === "registered") onComplete(state.sourceLabel, state.sample);
}, [state, onComplete]);
```

This was the one design point overturned during implementation-time shape enumeration (`architect` subagent, adversarial case A1: closing the "add source" panel while still `"reading"`). An imperative call from inside `runRegistration` would need an explicit guard to discard a result arriving after the panel unmounted; the effect needs none — unmounting stops the effect from ever running with `phase === "registered"`, so "closed mid-load" and "cancelled" collapse into the same, already-correct code path. `onComplete` must be `useCallback`-stabilized at the call site (App.tsx) and its merge into `sources[]` dedupes by `sample.table.id` (`mergeWorkspaceSource`) as a defensive backstop against any future duplicate call. **Correction (post-implementation review)**: the original version of this ADR justified the dedupe by React 18 StrictMode's dev-only effect double-invocation — an independent review fact-checked this against React's own source and found it does not actually apply here: StrictMode only double-invokes effects at a component's *initial mount*, and this effect's meaningful firing (`phase === "registered"`) always happens well after mount, via async file/DuckDB work, outside that window. The dedupe is kept regardless — it is cheap and has no legitimate case where the same `table.id` should ever produce two workspace cards — but the specific StrictMode rationale was inaccurate and has been corrected in the code comments (`App.tsx`, `IntakeApp.tsx`) alongside this note.

### Registration success auto-enters the workspace; "確定"/"やり直す" become "自動入場"/"削除"

The former terminal screen (`RegisteredSummary`, D7's "確定"/"やり直す" pair) looked identical either way to the user (UX review M-2, Hick's Law violation) despite one path keeping the data and the other discarding it. Under accumulation, there is nothing left to separately confirm — the table is already live the instant `onComplete` fires — so registration success transitions directly into the workspace (operation count 2→1). `RegisteredSummary` is repurposed from a one-time completion screen into the workspace's persistent per-source data card: `onConfirm`/`onRedo` are replaced by a single `onDelete`, and the workspace (not each card) carries the forward-looking "グラフ作成機能は今後の更新で追加されます" note once. Source deletion (`DROP TABLE` + `usedIds.delete` + array removal, all three owned by the shell) is a direct extension of the former `handleRedo`'s best-effort discipline.

### Two new app-only error kinds, layered onto (not merged into) core's `DataSourceErrorKind`

Issue #91 (a data-layer chunk `import()` failure) and issue #42 (a legacy `.xls` file) both surface *before* any `DataSource` is ever constructed — neither is a `DataSourceError`. `intake/types.ts` defines `AppErrorKind = DataSourceErrorKind | "data-layer-load" | "legacy-xls"`; `IntakeError.kind`/`describeError()` widen to this superset. `data-layer.ts` now exports a `DataLayerLoadError` class that `importDataLayer()`'s rejection handler wraps the underlying error in; `toIntakeError` checks `instanceof DataLayerLoadError` **before** its existing `DataSourceError` check (previously, `getResolvedDataLayer()` returning `undefined` was indistinguishable from a genuine content problem, and both fell through to the same "内容を読み取れませんでした" / corrupt misattribution — the exact bug issue #91 named). `.xls` gets its own actionable copy ("Excelで開き直し.xlsxで保存し直してください") rather than the generic unsupported-format fallback, since this repo's own target persona (old government-distributed spreadsheets) hits this format specifically.

**Rejected: add `data-layer-load`/`legacy-xls` as leaves on core's `DataSourceErrorKind` union.** That union's own doc comment commits to "leaf addition only, no reshape" for *datasource-layer* errors; a chunk-import failure and an extension check that runs before any `DataSource` exists are both app-layer classification, and mixing them into the core union would blur that boundary for no benefit — `errorCopy.ts` (the only consumer) is itself an app-layer file, so the wider union costs nothing to define there instead.

**Correction (post-implementation review): the `data-layer-load` reload button originally carried a discard-confirmation gate (`hasPendingSources` prop threaded through `IntakeApp`/`ErrorPanel`), motivated by Phase 2's Security review (T-C: a reload while sources[] is non-empty would discard them, DuckDB-WASM being in-memory).** An architecture check proved this combination cannot occur: `loadDataLayer()` (data-layer.ts) memoizes permanently on success and is never re-attempted after that, and the only way any source ever gets registered at all is through a code path (`runRegistration`) that already awaited it successfully. So by the time `sources[]` could be non-empty, this specific failure kind can no longer occur — the confirm gate was guarding a combination the architecture itself forecloses, not a real risk. Removed (`ErrorPanel.tsx`/`IntakeApp.tsx`/`App.tsx`); the reload button now calls `window.location.reload()` unconditionally, same as it always could have.

### Entry-chunk isolation re-verified via Vite's build manifest, not text-grepping

Issue #54 Stage A proved `intake.html`'s entry chunk was statically clean of `duckdb`/`exceljs`/`iconv` via `dist/`-text FORBIDDEN_MARKERS grepping (with a `__vite__mapDeps` array-literal strip for the one legitimate lazy-chunk-filename reference). Stage B needed the same property for `index.html`, which now legitimately reaches the data layer (through `data-layer.ts`'s existing dynamic-import boundary) — but two review rounds (one MCP-Codex-equivalent proxy round, one adversarial follow-up) each disproved a text-based extraction approach empirically against this exact build:

- **Round 1 finding**: checking "the data layer exists somewhere outside both entries' static graphs" cannot distinguish index.html's own lazy edge from `register-harness.html` sharing the same chunk via Rollup dedup (both entries reach the same chunk, one statically, one lazily — a chunk-filename-based check conflates the two).
- **Round 2 finding**: a `__vite__mapDeps=[...]`-array text-extraction approach (the fix proposed in response to round 1) fails on a chunk reached via a bare `import("./chunk.js")` call site with no array literal at all — empirically confirmed: `data-layer.ts`'s `./duckdb/factory.js` edge produces exactly this pattern in the real build, leaving no filename trace for that approach to find.

**Decision**: `vite.config.ts` sets `build: { manifest: true }`, emitting `dist/.vite/manifest.json`. Its `imports` (static) and `dynamicImports` (lazy) fields, keyed by resolved module source path (`"../core/dist/datasource/index.js"`, `"src/duckdb/factory.ts"`) rather than an unstable content-hashed filename, give a structural answer immune to both failure modes: `bundle-isolation.test.ts` walks `index.html`'s static-`imports` closure (must not contain either key) and separately its transitive `dynamicImports` (must contain both) — `register-harness.html` reaches the same two modules through its own `imports` field only, a different manifest key entirely, so it cannot be conflated with `index.html`'s dynamic edge either way. PoC-verified against a real build before implementation began.

## Alternatives considered

| Option | Rejected because |
|---|---|
| Lift `intakeReducer` to shell-level state | `#11a`'s usage (one attempt at a time) doesn't need it; pure reshape risk against an already-hardened reducer |
| `onComplete` called imperatively from `runRegistration` | Needs an explicit stale-result guard for the panel-closed-mid-load case; the effect-based design needs none (unmount alone suffices) |
| Keep "確定" as an explicit click before workspace entry | Reintroduces the exact Hick's Law violation (2 visually-identical choices) UX review already flagged; the preview persists in the workspace regardless, so no information is lost by removing the click |
| `data-layer-load`/`legacy-xls` as core `DataSourceErrorKind` leaves | Blurs the "leaf-only, datasource-layer" contract that union's own doc comment commits to; costs nothing to keep app-layer instead |
| `__vite__mapDeps` array-literal text extraction for Stage B | Empirically disproven: misses a chunk reached via a bare `import()` call site with no array literal |
| "entry chunk's data layer exists somewhere outside both entries" (chunk-filename-set approach) | Cannot distinguish index.html's own lazy edge from register-harness.html's static edge to a Rollup-deduped shared chunk |

## Residual risks (accepted for this PR)

- **RR-1 — WebKit does not re-fetch a dynamically-`import()`-ed chunk whose earlier request was aborted, even across a full `location.reload()`.** Empirically confirmed via network trace (2026-07-21, e2e/intake-harness.spec.ts): Chromium and Firefox both correctly re-request the previously-failed chunk on reload and the registration then succeeds; WebKit fetches the other two needed chunks fresh but never re-requests the one that was aborted, and a second registration attempt fails identically. Read as WebKit scoping a failed module resolution to something that survives a same-document reload (broader than "the page's own lifetime," which is what data-layer.ts's own module-map doc comment — and Chromium/Firefox's actual behavior — assumes). This is very likely specific to a *synthetic, test-harness-induced* abort rather than a genuine transient network failure (nothing suggests a real, non-test network blip would be cached the same way), but it is unverified for the general case. The corresponding e2e assertion is skipped on WebKit with this exact rationale recorded in-line; a real user hitting this on WebKit would need to force-reload (bypass cache) rather than a plain reload, an affordance not built into this PR's error UI.
- **RR-2 (carried forward from PR-M2-1)**: zrender's internal async scheduling (timers/rAF) still runs outside any React-managed callback, so `DashboardErrorBoundary` cannot catch a throw originating there — unchanged by this PR.
- **RR-3**: a source deleted while `"reading"` a different, unrelated new attempt (cancel-then-abandon path) can leave an orphaned DuckDB table invisible to `sources[]` (register() cannot be aborted, no `AbortSignal` on the core API) — pre-existing since PR-A2, unaffected by this PR's scope, tracked as a known gap rather than closed here.

## Consequences

- (+) `intake.html`, `intake-main.tsx` retired; `index.html` is the product's sole entry, matching the plan the M2 kickoff prompt names.
- (+) `#91`'s misattribution (chunk-load failure blamed on the user's file) is closed; `#42`'s generic `.xls` rejection now names the actual fix.
- (+) Entry-chunk isolation (issue #54's core invariant) is re-verified for the single-entry shape via a manifest-based method that is more robust than the Stage A text-grep approach it replaces, not just carried forward unchanged.
- (−) The workspace's chart preview (`DashboardPreview`/`SAMPLE_DASHBOARD`) still renders a hardcoded sample regardless of which sources are actually registered — real chart-building against accumulated sources is issue #11c's scope, not this PR's.
- (−) `mount()`'s full teardown/rebuild per dashboard change (issue #70) is unaddressed; this PR does not introduce a live-editing feature that would exercise it, per the M2 kickoff plan's explicit deferral.
