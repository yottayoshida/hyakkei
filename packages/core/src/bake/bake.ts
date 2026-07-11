// bake() (issue #8, ADR-0005). Pure function: no DuckDB, no Date.now() --
// timestamps are caller-supplied so the same (document, resolvedRows, meta)
// always produces byte-identical output (golden-test determinism, plan
// §技術選定 "golden 3 層").
import type { BakedDashboard, Dashboard } from "@hyakkei/schema";
import { lookupRows, type Row } from "../renderer/render-model.js";

export type BakeMeta = {
  generatedAt: string;
  sourceDataAsOf: string;
  hyakkeiVersion: string;
};

function bakeChart(
  chart: Dashboard["charts"][number],
  resolvedRows: Record<string, Row[]>,
): BakedDashboard["charts"][number] {
  // `query` is destructured out, not carried by a `{...chart, rows}` spread
  // -- `BakedChart` forbids it (schema `ForbidFields("query", "sql")`), and
  // a straight spread would silently carry it forward.
  const { query, ...rest } = chart;
  // Rows are copied, not aliased: a BakedDashboard is a snapshot pinned to
  // `meta.sourceDataAsOf`, and `lookupRows` returns the caller's own array --
  // an editor that re-runs a query and mutates the same `resolvedRows` entry
  // for live preview must not retroactively rewrite an already-baked
  // artifact (issue #66). Rows are schema-constrained to flat primitive
  // records, so a per-row spread is a full copy.
  const rows = query ? lookupRows(resolvedRows, query).map((row) => ({ ...row })) : [];
  return { ...rest, rows } as unknown as BakedDashboard["charts"][number];
}

/**
 * Query-未設定 (unconfigured) charts are skipped, not baked with `rows: []`
 * (Mirror handoff re-verification, shapes.md): baked has no concept of "not
 * yet wired," only "ran and returned rows" -- shipping an unconfigured tile
 * to a viewer who can never configure it serves no one. Skipping its layout
 * item too keeps bake() from *introducing* a new dangling reference.
 *
 * The "which charts get skipped" predicate is its own named step (`filter`
 * before `map`, /simplify Altitude finding) rather than a `Set` mutated
 * inside the same pass that builds the baked chart -- a future consumer
 * (e.g. an editor surfacing "N charts aren't wired yet") can reuse the
 * predicate without re-deriving it from bake()'s internals.
 *
 * A layout item that was ALREADY dangling before baking (references a chart
 * id that was never in `document.charts` at all -- an adversarial/malformed
 * authoring shape, shapes.md) is deliberately left in place, not swept up by
 * the same filter (Codex R1 P2: an earlier version filtered to "chart id
 * survived," which also silently dropped pre-existing dangling items --
 * the viewer would then see one fewer error tile than the editor did, for
 * the same document). `mount()` is the single place that decides what a
 * dangling reference looks like on screen; `bake()`'s only job is to not
 * make its OWN skip decision look identical to a pre-existing one.
 */
export function bake(
  document: Dashboard,
  resolvedRows: Record<string, Row[]>,
  meta: BakeMeta,
): BakedDashboard {
  // The chart filter is per-element (`chart.query` on the element itself),
  // never id-based: duplicate ids are schema-parseable (validate* is
  // advisory), and an id-keyed skip set would let one unconfigured
  // `{id:'kpi'}` drag a configured `{id:'kpi', query}` -- and its layout
  // item -- out of the baked artifact with it (issue #56). `skippedIds` is
  // therefore only "ids with no surviving chart at all", which is the only
  // id-shaped question the layout filter below actually needs answered.
  const includedCharts = document.charts.filter((chart) => chart.query !== undefined);
  const survivingIds = new Set(includedCharts.map((chart) => chart.id));
  const skippedIds = new Set(
    document.charts
      .filter((chart) => chart.query === undefined && !survivingIds.has(chart.id))
      .map((chart) => chart.id),
  );
  const charts = includedCharts.map((chart) => bakeChart(chart, resolvedRows));

  return {
    version: document.version,
    meta: { ...document.meta, ...meta },
    theme: document.theme,
    charts,
    layout: {
      ...document.layout,
      items: document.layout.items.filter((item) => !skippedIds.has(item.chart)),
    },
  };
}
