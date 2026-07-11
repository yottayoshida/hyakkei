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
  const rows = query ? lookupRows(resolvedRows, query) : [];
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
  const skippedIds = new Set(
    document.charts.filter((chart) => !chart.query).map((chart) => chart.id),
  );
  const charts = document.charts
    .filter((chart) => !skippedIds.has(chart.id))
    .map((chart) => bakeChart(chart, resolvedRows));

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
