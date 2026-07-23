// Per-card inline live preview (issue #12, plan §プレビュー描画, (A) required).
// Renders exclusively through the existing normalizeAuthoring+mount()
// pipeline (SEC-1) -- no new DOM-construction path, no
// dangerouslySetInnerHTML. The same rendering contract `DashboardPreview`
// (App.tsx, baked-only) already uses, just fed a minimal single-chart
// authoring Dashboard instead of a BakedDashboard.
import { mount, normalizeAuthoring, unmount, type Row } from "@hyakkei/core/renderer";
import type { Chart, Dashboard } from "@hyakkei/schema";
import { useEffect, useMemo, useRef } from "react";
import type { ChartRowState } from "../intake/types.js";

/** Same literal `SAMPLE_DASHBOARD` (App.tsx) already uses -- no persisted theme exists yet in this PR's scope (F7). */
const DEFAULT_CHART_THEME = {
  tokens: "@digital-go-jp/design-tokens@2.0.1",
  palette: "guidebook-blue",
} as const;

export type ChartPreviewProps = {
  chart: Chart;
  rowState: ChartRowState;
};

export function ChartPreview({ chart, rowState }: ChartPreviewProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  // Memoized (code review, Angle D: a fresh `[]` literal every render
  // otherwise makes the useEffect dependency below unstable whenever
  // rowState isn't "ready" -- flagged by `react-hooks/exhaustive-deps` as a
  // real lint error, confirmed via `npx eslint`, not just a style nit).
  const rows: Row[] = useMemo(
    () => (rowState.status === "ready" ? rowState.rows : []),
    [rowState],
  );

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    // Computed-key object literal, not `Object.create(null)`/a Map->Record
    // helper (plan conformance audit note): safe as-is -- `chart.query` is
    // always an app-generated id (`queryIdSeqRef`-minted, e.g. "query_1"),
    // never a data-derived string, AND computed-key syntax `{ [k]: v }`
    // uses `CreateDataPropertyOrThrow` regardless of `k`'s value (verified:
    // `{ ["__proto__"]: x }` creates a real OWN property, never touches the
    // prototype chain -- unlike the object-literal shorthand `{ __proto__:
    // x }`, or a later `obj[k] = v` assignment). The plan's own `Object.
    // create(null)`-based conversion helper is for the DEFERRED (B) unified
    // preview, which would consume the app's full `chartRowsByQuery` Map --
    // this single-entry record never touches that Map at all.
    const rowsByQuery: Record<string, Row[]> = chart.query ? { [chart.query]: rows } : {};
    const doc: Dashboard = {
      version: 1,
      meta: { title: chart.options.title ?? chart.id },
      theme: DEFAULT_CHART_THEME,
      sources: [],
      queries: [],
      charts: [chart],
      layout: { grid: "guidebook-12col", items: [{ chart: chart.id, x: 0, y: 0, w: 12, h: 6 }] },
    };
    mount(container, normalizeAuthoring(doc, rowsByQuery));
    return () => unmount(container);
  }, [chart, rows]);

  if (rowState.status === "pending") {
    return <p role="status">計算中…</p>;
  }
  if (rowState.status === "error") {
    // UX review (Phase 8, Minor): matches the recovery-guidance pattern the
    // column-info error message above (ChartBuilder.tsx) already uses --
    // "何が起きたか" alone left this a dead end, with no "何をすべきか".
    return <p role="alert">プレビューを表示できませんでした。集計の内容を確認してください。</p>;
  }
  return <div ref={containerRef} />;
}
