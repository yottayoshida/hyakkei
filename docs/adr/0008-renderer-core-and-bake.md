# ADR-0008: Renderer core — RenderModel normalization seam, bake()'s unconfigured-chart contract, subpath isolation

- **Status**: Accepted (2026-07-11)
- **Deciders**: yotta

## Context

Issue #8 (Renderer core) and ADR-0005's `bake()` both land in this PR (issue #8 + #9's PR-B). Two artifact shapes must render through one code path — the authoring `Dashboard` (sources/queries/charts/layout, rows supplied externally at preview time) and the exported `BakedDashboard` (charts carry rows inline, no sources/queries at all, ADR-0005) — without the renderer growing a branch per artifact kind. `/develop` Phase 2 shape enumeration (`~/.claude/plans/2026-07-10-hyakkei-issue4-8-9-renderer-theme-prB-shapes.md`) re-verified the plan's own "no semantic difference in render core" claim against real schema samples and found one delta the plan had underspecified: a chart with no `query` yet (`Chart.query` is optional — DA-9, a valid mid-edit state) is not the same thing as a chart whose query ran and returned zero rows, but `BakedChart` has no `query` field to be absent in the first place. This ADR records how that delta is resolved, plus two further decisions this PR made: what `bake()` does with an unconfigured chart, and how the renderer stays out of a viewer's exported bundle.

## Decision

### RenderModel: the one shape `buildOptions`/`mount` ever see

```ts
type ChartState = "ok" | "empty" | "unconfigured";
type RenderChart = { id: string; chart: Chart | BakedChart; rows: Row[]; state: ChartState };
type RenderModel = { charts: RenderChart[]; layout: Layout; theme: EChartsThemeObject };

normalizeAuthoring(doc: Dashboard, rowsByQuery: Record<string, Row[]>): RenderModel
normalizeBaked(baked: BakedDashboard): RenderModel
buildOptions(model: RenderModel): Record<string, EChartsOption>   // pure, no DOM
mount(container: HTMLElement, model: RenderModel): void            // the one DOM-touching function
```

`state: "unconfigured"` is the shape-enumeration finding, made explicit in the type rather than collapsed into `"empty"`: `normalizeAuthoring` is the only producer (a chart with no `query` is unconfigured regardless of `rowsByQuery`'s contents); `normalizeBaked` can only ever produce `"ok"` or `"empty"`, because a baked chart's `rows` is always populated by definition — there is no "not yet wired" concept once a query engine has already run. `mount()` renders `"unconfigured"` and `"empty"` as different messages (「まだデータに接続されていません」 vs 「データがありません」) — an author editing a fresh tile and a viewer looking at a query that genuinely returned nothing are different situations and should not read as the same message.

Everything else about the two normalize functions converges: `buildOptions` and `mount` take a `RenderModel` and do not know or care which normalize function produced it. `authoring-baked-convergence.test.ts` (V-101 extended) proves this for all 7 `ChartVariant` types by round-tripping the same fixture through both paths and asserting the produced `EChartsOption`s (for the 5 ECharts-backed variants) and DOM (for `table`/`stat`) are identical.

### `bake()` skips a query-未設定 (unconfigured) chart, not "rows: []"

```ts
bake(document: Dashboard, resolvedRows: Record<string, Row[]>, meta: BakeMeta): BakedDashboard
```

A chart with no `query` is dropped from the baked output entirely — along with its `layout.items` entry, so `bake()` itself never introduces a dangling layout reference. Rejected: baking it with `rows: []` (indistinguishable from a query that ran and returned nothing; ships a tile to a viewer who has no way to ever configure it, unlike the editor).

`bake()` takes `meta: {generatedAt, sourceDataAsOf, hyakkeiVersion}` as a caller-supplied argument rather than calling `Date.now()`/reading `package.json` internally — ADR-0005 calls `bake()` "a pure function"; a function that reads wall-clock time or package metadata as a side effect is not pure, and the plan's primary golden-testing mechanism (`buildOptions` output compared with `toEqual`) depends on identical inputs producing byte-identical output on every run (`bake.test.ts`'s purity test: two calls with the same three arguments produce a deep-equal `BakedDashboard`).

### Subpath isolation: `@hyakkei/core/renderer` re-exports only renderer + theme

```json
// package.json
"exports": { ".": "./dist/index.js", "./renderer": "./dist/renderer/index.js" }
```

`packages/core/src/renderer/index.ts` re-exports `./theme` and its own modules only — never `./datasource` or `./bake`. Both of those are editor/export-time-only surfaces (ADR-0005); `datasource` carries a real `@duckdb/duckdb-wasm` dependency (currently type-only, but PR-A2 will add a runtime one) and `exceljs` sits behind it transitively. A viewer that only ever displays an already-baked artifact has no use for either. `bundle-isolation.test.ts` verifies this empirically — actually bundling `renderer/index.ts` with esbuild and asserting no `duckdb`/`exceljs`/`AsyncDuckDB`/`new Worker(` marker appears in the resolved input graph or the output text — rather than trusting the import graph by inspection (ADR-0005's own CSP-hash caveat: "verify empirically, don't trust it by construction"). The test's mutation check (temporarily adding a real `import "@duckdb/duckdb-wasm"` to `renderer/index.ts`) confirmed it fails when the invariant is actually broken, not just when nothing has changed.

The main `@hyakkei/core` entry point still re-exports everything (`datasource`, `bake`, `renderer`, `theme`) — the editor needs the full surface; only a consumer that imports the `./renderer` subpath specifically gets the narrower, duckdb/exceljs-free graph.

## Alternatives considered

| Option | Rejected because |
|---|---|
| Collapse `"unconfigured"` into `"empty"` | Loses a real authoring-time distinction the shape enumeration surfaced; an author's freshly-added, not-yet-wired tile and a viewer's genuinely-empty query result read as the same "no data" message otherwise |
| `bake()` emits an unconfigured chart with `rows: []` | Ships a tile to a viewer that can never be configured; also reintroduces the very "is this empty-by-design or empty-by-accident" ambiguity the `state` field exists to resolve |
| `bake()` reads `Date.now()`/package version internally | Breaks purity — the golden-testing strategy this plan commits to (`EChartsOption` deep-equal) requires identical inputs to produce identical output on every run |
| ECharts `symbolSize` as a series-level callback function (scatter) | A function value is never `===`/deep-equal across two independently-built option objects with identical data — this silently breaks the `toEqual`-based golden strategy for every scatter chart. Found by the PoC's own convergence test failing with "no visual difference" (Vitest can't diff two distinct function references); fixed by moving `symbolSize` onto each data item (`{value, symbolSize}`) instead |
| New `packages/renderer` workspace package instead of a subpath | Heavier monorepo change for the same isolation guarantee a subpath export already provides; revisit only if the renderer's own dependency footprint grows enough to need independent versioning |

## Consequences

- (+) `buildOptions`/`mount` have exactly one input shape to reason about and test against, regardless of which artifact produced it.
- (+) The "unconfigured vs empty" distinction is visible in the type system (`ChartState`), not just in comments — a future call site that needs to branch on it (e.g. an editor-only "configure this chart" prompt) has something to switch on.
- (+) A viewer bundle's freedom from `duckdb-wasm`/`exceljs` is a tested fact (`bundle-isolation.test.ts`), not an assumption that could silently regress the next time `datasource/` grows a runtime import.
- (+) `bake()`'s purity makes golden fixtures (PR-C) reproducible: the same `(document, resolvedRows, meta)` triple always produces the same `BakedDashboard`, independent of when or how many times it's called.
- (−) Every `EChartsOption`-producing function in `buildOptions` must avoid function-valued fields, which rules out a few ECharts convenience APIs (per-point callbacks) in favor of slightly more verbose per-item data shapes. Documented in-code at the one call site (`scatterOption`) where this mattered.
- (−) Callers of `bake()` must supply `meta` themselves rather than getting it "for free" — a minor ergonomics cost for editor/export code, in exchange for testability.
