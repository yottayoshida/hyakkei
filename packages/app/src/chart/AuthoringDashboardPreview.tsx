// Unified dashboard-grid preview (issue #70, issue #12 ADR-0013 RR-4 (B),
// deferred at the time). Assembles App.tsx's full editor state
// (charts/layout/chartRowsByQuery) into one live Dashboard document and
// renders it through the SAME normalizeAuthoring+mount() contract (A)
// ChartPreview.tsx already uses -- just fed every chart at once instead of
// one per card, via mount.ts's differential-update `patch()` (issue #70)
// instead of a full teardown/rebuild on every edit.
import { normalizeAuthoring, patch, unmount, type Row } from "@hyakkei/core/renderer";
import type { Chart, Dashboard, Layout } from "@hyakkei/schema";
import { useEffect, useRef, useState } from "react";
import { DashboardErrorBoundary } from "../dashboard-error-boundary.js";
import type { ChartRowState } from "../intake/types.js";
import { CHART_ROW_LIMIT } from "./chart-encoding.js";

const THEME = { tokens: "@digital-go-jp/design-tokens@2.0.1", palette: "guidebook-blue" } as const;

/**
 * `chartRowsByQuery`'s Map -> `normalizeAuthoring`'s `Record<string, Row[]>`
 * contract (ADR-0013 RR-4, designed but not built until this PR).
 * `Object.create(null)`, not `{}` (Security review): a query id is an
 * app-generated `query_N` string in practice, but the discipline this
 * codebase already applies to every other data-derived-key structure
 * (`buildOptions`, `lookupRows`) is followed here too rather than assumed
 * safe by provenance alone. Only `"ready"` rows are ever passed through --
 * `"pending"`/`"error"` become `[]` (silent-fail=zero, the same rule (A)
 * `ChartPreview.tsx`'s own `status==='ready' ? rows : []` already applies).
 */
export function toRowsByQuery(chartRowsByQuery: Map<string, ChartRowState>): Record<string, Row[]> {
  const record: Record<string, Row[]> = Object.create(null);
  for (const [queryId, state] of chartRowsByQuery) {
    record[queryId] = state.status === "ready" ? state.rows : [];
  }
  return record;
}

/**
 * `normalizeAuthoring` itself can never produce `"pending"`/`"error"`
 * (render-model.ts's own contract note) -- its `rowsByQuery` input has no
 * room to carry them, only resolved rows or their absence. This overlays
 * the two states this multi-chart grid needs (unlike (A) ChartPreview,
 * which simply never calls mount()/patch() while its one chart's query is
 * unresolved) onto whichever entries `chartRowsByQuery` says are pending or
 * failed, so the OTHER, already-resolved charts in the same grid still
 * render normally.
 */
function withLiveQueryState(
  model: ReturnType<typeof normalizeAuthoring>,
  chartRowsByQuery: Map<string, ChartRowState>,
): ReturnType<typeof normalizeAuthoring> {
  return {
    ...model,
    charts: model.charts.map((entry) => {
      const query = (entry.chart as Chart).query;
      if (!query) return entry;
      const rowState = chartRowsByQuery.get(query);
      if (rowState?.status === "pending") return { ...entry, state: "pending" as const };
      if (rowState?.status === "error") return { ...entry, state: "error" as const };
      return entry;
    }),
  };
}

export type AuthoringDashboardPreviewProps = {
  charts: Chart[];
  layout: Layout;
  chartRowsByQuery: Map<string, ChartRowState>;
};

/**
 * QA Phase 8 finding (Major, Jakob's Law): (A) `ChartBuilder.tsx` already
 * discloses truncation per-chart (`role="status"`, "先頭N件のみ表示していま
 * す。"), but `toRowsByQuery` above discards `ChartRowState`'s own
 * `truncated` flag entirely -- the same chart would otherwise show two
 * different completeness stories depending which of (A)/(B) a user reads.
 * Kept as one aggregate notice here (not a per-tile `mount.ts` advisory,
 * matching this component's own `pending`/`error` precedent of overlaying
 * app-level query state rather than pushing it into the framework-
 * independent core renderer) since a non-technical user reading the
 * grid-of-everything view only needs to know SOME chart may be incomplete,
 * not re-derive it per tile.
 */
function anyChartTruncated(charts: Chart[], chartRowsByQuery: Map<string, ChartRowState>): boolean {
  return charts.some((chart) => {
    const state = chart.query ? chartRowsByQuery.get(chart.query) : undefined;
    return state?.status === "ready" && state.truncated;
  });
}

function buildDoc(charts: Chart[], layout: Layout): Dashboard {
  return {
    version: 1,
    meta: { title: "authoring-dashboard-preview" },
    theme: THEME,
    sources: [],
    queries: [],
    charts,
    layout,
  };
}

type GridProps = AuthoringDashboardPreviewProps;

/**
 * The component whose OWN effect calls `patch()` -- split out from
 * `AuthoringDashboardPreview` (Codex review Round 1 P1) so
 * `DashboardErrorBoundary` can wrap it directly. React error boundaries
 * only catch errors from their OWN descendants' render/effect phases, never
 * from an ANCESTOR's effect -- the original single-component version had
 * the boundary rendered INSIDE the component whose effect called `patch()`,
 * so a `patch()` throw would have propagated uncaught past this component
 * entirely, exactly the failure this app's `DashboardErrorBoundary`
 * convention exists to contain elsewhere ((A) `ChartBuilder.tsx` wraps
 * `ChartPreview` -- the component that owns ITS OWN mount()-calling effect
 * -- for the identical reason).
 */
function AuthoringDashboardGrid({ charts, layout, chartRowsByQuery }: GridProps) {
  const containerRef = useRef<HTMLDivElement>(null);

  // patch-effect: re-runs on every edit, but never unmounts on cleanup --
  // that's the teardown-effect below's job alone (issue #55 precedent: a
  // cleanup that reads/acts on the ref for anything other than closing over
  // the CURRENT container risks acting on a stale target once React nulls
  // host refs during unmount).
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const model = withLiveQueryState(
      normalizeAuthoring(buildDoc(charts, layout), toRowsByQuery(chartRowsByQuery)),
      chartRowsByQuery,
    );
    patch(container, model);
  }, [charts, layout, chartRowsByQuery]);

  // teardown-effect: deps=[], closes over the element it mounted into, runs
  // only once on this component's own final unmount -- mirrors (A)
  // ChartPreview.tsx's own split for the identical reason.
  useEffect(() => {
    const container = containerRef.current;
    return () => {
      if (container) unmount(container);
    };
  }, []);

  return <div ref={containerRef} />;
}

/**
 * Stable across every edit (architect review, the single most important
 * design risk this component has): a `key` that changes on every edit would
 * force React to unmount+remount this whole subtree, discarding `patch()`'s
 * own per-container differential-update state (`mount.ts`'s `mountStates`
 * `WeakMap`) and silently erasing issue #70's entire point. (A)
 * `ChartBuilder.tsx` can safely key its OWN boundary on `type`+`encoding`
 * because it wraps exactly one chart; this component wraps the whole grid,
 * so no single chart's shape should ever be allowed to force a full-grid
 * remount. `resetSeq` (below) is the ONE deliberate exception -- it changes
 * only on an explicit user click, never as a side effect of an edit.
 */
const BOUNDARY_KEY = "authoring-dashboard-preview";
const LABEL_ID = "authoring-dashboard-preview-label";

export function AuthoringDashboardPreview({ charts, layout, chartRowsByQuery }: AuthoringDashboardPreviewProps) {
  // UX review (Phase 2, silent-wrong-render recovery): patch()'s failure
  // modes are internal-state bugs (a stale/wrong reuse), not throws -- the
  // error boundary alone can't catch those. Incrementing this remounts
  // `AuthoringDashboardGrid` (a fresh container `patch()` has never seen
  // takes its own "no previous state" branch, unconditionally rebuilding),
  // forcing a genuine full rebuild without reloading the page and losing
  // the DuckDB-WASM session.
  const [resetSeq, setResetSeq] = useState(0);
  // QA Phase 8 finding (Major, Nielsen #1): a click's only externally
  // visible effect was an identical-looking grid -- for a user who clicked
  // specifically because they suspected a silent-wrong render, "nothing
  // happened" reads as "it didn't work", not "it confirmed the render was
  // already correct". Mirrors App.tsx's own `setAnnouncement` convention for
  // every other editor action (add/delete chart, delete source).
  const [resetAnnouncement, setResetAnnouncement] = useState<string | null>(null);

  return (
    <div
      className="hyakkei-authoring-dashboard-preview"
      role="region"
      aria-labelledby={LABEL_ID}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
        {/* UX review: role-separation label from (A) ChartBuilder's own
            per-card preview -- the same chart appears in both, and without
            a label distinguishing them a user may wonder why. */}
        <p id={LABEL_ID} style={{ margin: 0, color: "#6b7280", fontSize: 14 }}>
          配置ビュー（自動レイアウトのプレビュー、読み取り専用）
        </p>
        <button
          type="button"
          onClick={() => {
            setResetSeq((n) => n + 1);
            setResetAnnouncement("配置ビューを再構築しました。");
          }}
          aria-label="配置ビューを再構築"
          title="表示が崩れて見えるときに使う手動再構築ボタンです"
          style={{ minHeight: 44, padding: "0 12px", background: "transparent" }}
        >
          再構築
        </button>
      </div>
      {resetAnnouncement && <p role="status">{resetAnnouncement}</p>}
      {anyChartTruncated(charts, chartRowsByQuery) && (
        <p role="status" style={{ margin: "4px 0", fontSize: 13, color: "#b45309" }}>
          一部のグラフはデータが多いため、先頭{CHART_ROW_LIMIT.toLocaleString("ja-JP")}件のみ表示しています。
        </p>
      )}
      <div style={{ border: "1px dashed #d1d5db", borderRadius: 8, padding: 8 }}>
        <DashboardErrorBoundary key={`${BOUNDARY_KEY}:${resetSeq}`}>
          <AuthoringDashboardGrid charts={charts} layout={layout} chartRowsByQuery={chartRowsByQuery} />
        </DashboardErrorBoundary>
      </div>
    </div>
  );
}
