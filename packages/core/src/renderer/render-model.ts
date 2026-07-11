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
 */
export type ChartState = "ok" | "empty" | "unconfigured";

export type RenderChart = {
  id: string;
  chart: Chart | BakedChart;
  rows: Row[];
  state: ChartState;
};

export type RenderModel = {
  charts: RenderChart[];
  layout: Layout;
  theme: EChartsThemeObject;
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
  };
}
