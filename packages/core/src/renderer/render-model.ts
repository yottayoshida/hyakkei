// Renderer core (issue #8, PR-B): normalizes both the authoring `Dashboard`
// and the exported `BakedDashboard` onto one `RenderModel` shape, for all 7
// ChartVariant types (docs/adr/0008-renderer-core-and-bake.md).
import type {
  BakedChart,
  BakedDashboard,
  Chart,
  Dashboard,
  JsonPrimitive,
  Layout,
} from "@hyakkei/schema";
import type { EChartsThemeObject } from "../theme/echarts-theme.js";
import { buildEChartsTheme } from "../theme/echarts-theme.js";
import type { FooterModel } from "./dom/dashboard-footer.js";
import { authoringProvenance, bakedProvenance } from "./dom/dashboard-footer.js";

/**
 * One source of truth for "what a baked row's cell may hold," derived from
 * the schema's own `JsonPrimitive` rather than re-declared here (/simplify
 * Reuse finding: this exact union was independently copy-typed in 5 files
 * before this change -- a future 6th JSON primitive type would need manual,
 * easy-to-miss updates in all of them instead of following from one import).
 */
export type Row = Record<string, JsonPrimitive>;

/**
 * `"unconfigured"` exists only on the authoring path (Mirror handoff
 * re-verification, shapes.md): a chart with no `query` yet is a valid
 * mid-edit state (DA-9) distinct from a query that ran and returned zero
 * rows. `normalizeBaked` can never produce it -- `BakedChart` has no `query`
 * field to be absent, only `rows`, which is either populated or empty.
 *
 * `"pending"`/`"error"` (issue #70/#12(B)) exist only for a caller assembling
 * a `RenderModel` from several charts that share one live-editing session
 * (`AuthoringDashboardPreview`, app package): unlike a single-chart preview
 * (`ChartPreview.tsx`), which simply skips calling `mount()`/`patch()` at all
 * while its one query is unresolved, a multi-chart grid must still render
 * the OTHER, already-resolved charts while one query is still pending or
 * failed -- `normalizeAuthoring` itself never produces these two states (its
 * `rowsByQuery: Record<string, Row[]>` contract has no room for "pending"/
 * "error" as a value), a caller must overwrite the affected `RenderChart`s'
 * `state` after calling it. `normalizeBaked` can never produce either, for
 * the same reason as `"unconfigured"` -- a baked snapshot is always
 * fully-resolved.
 */
export type ChartState = "ok" | "empty" | "unconfigured" | "pending" | "error";

export type RenderChart = {
  id: string;
  chart: Chart | BakedChart;
  rows: Row[];
  state: ChartState;
};

/**
 * `footer` is optional so the many test fixtures that build a `RenderModel`
 * as a bare `{charts, layout, theme}` literal keep compiling.
 *
 * It carries an already-split `FooterModel`, not the raw `meta`, and that is
 * the load-bearing part of issue #124's design. Passing `meta: BaseMeta |
 * BakedMeta` instead would look tidier and be wrong twice over:
 *
 * 1. On the authoring side those three baked keys are not schema-typed at
 *    all. `BaseMeta` is a `SafeObject` with `additionalProperties` open, so a
 *    hand-written document may carry `generatedAt: null` (or a number, or an
 *    object) and still parse — verified against the generated validator.
 * 2. TypeScript would then hand out a guarantee it cannot keep: narrowing a
 *    `BaseMeta | BakedMeta` union with `"generatedAt" in meta` yields
 *    `string`, which is a lie for exactly the values in (1). The footer is
 *    appended outside any per-tile `try`, so the resulting `TypeError` would
 *    take down the whole dashboard — while every other failure in this
 *    renderer is contained to one tile (`renderTileSafely`).
 *
 * Splitting in `normalizeBaked`/`normalizeAuthoring` moves the question to
 * where the input type already answers it: `normalizeBaked` receives a
 * `BakedDashboard` whose three freshness/tool stamps are `required` and whose
 * guidebook edition is optional, and
 * `normalizeAuthoring` receives a `BaseMeta` that has no such fields to read
 * — so "an authoring document cannot show bake-recorded provenance" is a
 * compile error rather than a rule someone has to remember.
 */
export type RenderModel = {
  charts: RenderChart[];
  layout: Layout;
  theme: EChartsThemeObject;
  footer?: FooterModel;
};

function chartState(rows: Row[] | undefined, hasQuery: boolean): ChartState {
  if (!hasQuery) return "unconfigured";
  return rows && rows.length > 0 ? "ok" : "empty";
}

/**
 * `resolvedRows[key]` alone would resolve `Object.prototype` members for a
 * malicious/malformed `key` like `"__proto__"` or `"toString"` (Security
 * Review Phase 8 M2) -- a `Chart.query` is schema-typed as an unrestricted
 * `NonEmptyString` (dashboard.ts, deliberately "opaque"), so this is a real,
 * reachable input, not a hypothetical one. `Object.hasOwn` checks the
 * object's own keys only. Shared by both `normalizeAuthoring` (below) and
 * `bake()` (bake/bake.ts) -- the same lookup against the same kind of
 * caller-supplied map, so the guard lives in one place rather than two
 * independently-written copies of the same fix.
 */
export function lookupRows(resolvedRows: Record<string, Row[]>, key: string): Row[] {
  return Object.hasOwn(resolvedRows, key) ? resolvedRows[key]! : [];
}

/**
 * `rowsByQuery` is keyed by `Query.id`, not by chart id -- multiple charts
 * may share one query (shapes.md sample S3), so the lookup must go through
 * `chart.query`, not the chart's own id.
 *
 * A `chart.query` set but absent from `rowsByQuery` (the query's own id
 * doesn't resolve, or the caller simply hasn't supplied that entry yet) and
 * a query that legitimately ran and returned zero rows both land on
 * `state: "empty"` here (Codex R1 P2 raised this as worth distinguishing).
 * Deliberately not split into a 4th state: referential integrity of
 * `chart.query` against `doc.queries` is `validateDashboardReferences`'s
 * job (packages/schema/src/validate.ts), not this render function's --
 * `normalizeAuthoring`'s contract is simply "render whatever rows the
 * caller supplies for each query," and a caller that always populates
 * every declared query's entry (even with `[]`) never hits the ambiguity.
 */
export function normalizeAuthoring(
  doc: Dashboard,
  rowsByQuery: Record<string, Row[]>,
): RenderModel {
  const charts: RenderChart[] = doc.charts.map((chart) => {
    const rows = chart.query ? lookupRows(rowsByQuery, chart.query) : [];
    return { id: chart.id, chart, rows, state: chartState(rows, Boolean(chart.query)) };
  });

  return {
    charts,
    layout: doc.layout,
    theme: buildEChartsTheme(doc.theme.palette, doc.theme.appearance ?? "light"),
    // Only what the author declared. `doc.meta` is a `BaseMeta`, so there is
    // no `generatedAt` here to read even when the underlying JSON carries one
    // as an additive unknown — the type is the guard (see `RenderModel`).
    footer: { summary: doc.meta.summary, provenance: authoringProvenance(doc.meta) },
  };
}

export function normalizeBaked(baked: BakedDashboard): RenderModel {
  const charts: RenderChart[] = baked.charts.map((chart) => ({
    id: chart.id,
    chart,
    rows: chart.rows,
    state: chartState(chart.rows, true),
  }));

  return {
    charts,
    layout: baked.layout,
    theme: buildEChartsTheme(baked.theme.palette, baked.theme.appearance ?? "light"),
    // Unconditional for the three required freshness/tool stamps; the
    // optional guidebook edition is projected when an artifact carries it.
    footer: { summary: baked.meta.summary, provenance: bakedProvenance(baked.meta) },
  };
}
