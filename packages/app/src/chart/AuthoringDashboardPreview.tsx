// Unified dashboard-grid preview (issue #70, issue #12 ADR-0013 RR-4 (B),
// deferred at the time). Assembles App.tsx's full editor state
// (charts/layout/chartRowsByQuery) into one live Dashboard document and
// renders it through the SAME normalizeAuthoring+mount() contract (A)
// ChartPreview.tsx already uses -- just fed every chart at once instead of
// one per card, via mount.ts's differential-update `patch()` (issue #70)
// instead of a full teardown/rebuild on every edit.
import {
  GRID_GAP,
  GRID_ROW_SIZE,
  normalizeAuthoring,
  patch,
  unmount,
  type Row,
} from "@hyakkei/core/renderer";
import {
  GRID_WIDTHS,
  type Chart,
  type Dashboard,
  type Layout,
  type LayoutItem,
  MAX_LAYOUT_H,
} from "@hyakkei/schema";
import { useCallback, useEffect, useRef, useState } from "react";
import { DashboardErrorBoundary } from "../dashboard-error-boundary.js";
import { DEFAULT_THEME } from "../document/theme.js";
import type { ChartRowState, QueryErrorKind } from "../intake/types.js";
import { CHART_ROW_LIMIT } from "./chart-encoding.js";

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
  /** issue #14: reorders `layout.items` (array-index move + full repack). */
  onReorderLayout: (fromIndex: number, toIndex: number) => void;
  onResizeLayout?: (chartId: string, deltaW: number, deltaH: number) => void;
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

function chartErrorKind(
  charts: Chart[],
  chartRowsByQuery: Map<string, ChartRowState>,
): QueryErrorKind | null {
  let hasQueryError = false;
  for (const chart of charts) {
    const state = chart.query ? chartRowsByQuery.get(chart.query) : undefined;
    if (state?.status !== "error") continue;
    if (state.kind === "oom") return "oom";
    hasQueryError = true;
  }
  return hasQueryError ? "query" : null;
}

function buildDoc(charts: Chart[], layout: Layout): Dashboard {
  return {
    version: 1,
    meta: { title: "authoring-dashboard-preview" },
    theme: DEFAULT_THEME,
    sources: [],
    queries: [],
    charts,
    layout,
  };
}

type GridProps = Omit<AuthoringDashboardPreviewProps, "onReorderLayout" | "onResizeLayout">;

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

const REORDER_HINT_ID = "authoring-dashboard-preview-reorder-hint";

type LayoutReorderOverlayProps = {
  items: LayoutItem[];
  gridWidth: number;
  onReorderLayout: (fromIndex: number, toIndex: number) => void;
  onResizeLayout: (chartId: string, deltaW: number, deltaH: number) => void;
};

/**
 * Transparent operation layer on top of (A) `AuthoringDashboardGrid`'s own
 * live, core-rendered tiles -- NOT a replacement for them (independent
 * review, Major finding: the PR thesis promises "no changes to the shared
 * renderer", which only holds if this overlay never touches that DOM, only
 * reads geometry from it). Every item gets a small `pointerEvents: "auto"`
 * control cluster (drag handle + move buttons) positioned via the exact
 * same `gridColumn`/`gridRow` formula `mount.ts`'s own `tileStyle` uses;
 * everything else in the overlay stays `pointerEvents: "none"` so the real
 * chart underneath (tooltips, table scroll, etc.) keeps working when the
 * user isn't actively reordering.
 *
 * Hit-testing during a pointer drag deliberately does NOT use
 * `document.elementFromPoint()`: that API skips `pointer-events: none`
 * elements entirely, and the per-slot positioning frames below are
 * `pointer-events: none` by design (see above) -- `elementFromPoint` would
 * hit the real chart tile underneath, not this overlay's own slot. Slot
 * `getBoundingClientRect()` comparisons (via `slotRefs`) work regardless of
 * `pointer-events` and don't depend on what's rendered on top.
 */
function LayoutReorderOverlay({
  items,
  gridWidth,
  onReorderLayout,
  onResizeLayout,
}: LayoutReorderOverlayProps) {
  const [dragFromChartId, setDragFromChartId] = useState<string | null>(null);
  const [dragOverChartId, setDragOverChartId] = useState<string | null>(null);
  // Keyed by chart id, NOT array index (fixed after an actual bug found
  // while testing the mid-drag-delete scenario e2e): the ref callback below
  // is a fresh closure every render, so React re-subscribes it whenever ITS
  // OWN identity changes -- if it closed over `index` instead, a shrinking
  // array reassigns indices to different charts across renders, and the
  // old/new callbacks for DIFFERENT charts sharing the same index number
  // could race (one's cleanup deleting the other's fresh registration).
  // Chart id is stable for a given chart regardless of array position, so
  // this has no such race.
  const slotRefs = useRef<Map<string, HTMLElement>>(new Map());

  // Codex R2 finding: if the chart currently being dragged is deleted
  // mid-drag (an async chart-delete while the pointer is still captured),
  // its handle `<span>` unmounts -- no `pointerup`/`pointercancel`/
  // `lostpointercapture` can ever fire on an element that's gone, so
  // without this the drop-target highlight and drag state would stay stuck
  // forever. Self-terminating in one corrective render (same "adjusting
  // state during render" pattern as `effectiveEditMode`'s reset below):
  // once cleared, `dragFromChartId === null` short-circuits this check.
  if (dragFromChartId !== null && !items.some((item) => item.chart === dragFromChartId)) {
    setDragFromChartId(null);
    setDragOverChartId(null);
  }

  const setSlotRef = useCallback((chartId: string, el: HTMLElement | null) => {
    if (el) slotRefs.current.set(chartId, el);
    else slotRefs.current.delete(chartId);
  }, []);

  // /simplify (Efficiency finding): tile positions are fixed for the whole
  // duration of one drag (layout only changes on drop), so the hit-test
  // targets are snapshotted ONCE here rather than re-measuring every slot's
  // `getBoundingClientRect()` on every `pointermove` -- native pointermove
  // can fire well over 100/s, which would otherwise force a DOM layout read
  // per tile that many times a second for no benefit.
  const dragSlotRectsRef = useRef<Array<{ chartId: string; rect: DOMRect }>>([]);

  const beginDrag = useCallback((chartId: string, event: React.PointerEvent<HTMLElement>) => {
    event.currentTarget.setPointerCapture(event.pointerId);
    dragSlotRectsRef.current = Array.from(slotRefs.current, ([id, el]) => ({
      chartId: id,
      rect: el.getBoundingClientRect(),
    }));
    setDragFromChartId(chartId);
    setDragOverChartId(chartId);
  }, []);

  const trackDrag = useCallback(
    (event: React.PointerEvent<HTMLElement>) => {
      if (dragFromChartId === null) return;
      for (const { chartId, rect } of dragSlotRectsRef.current) {
        if (
          event.clientX >= rect.left &&
          event.clientX <= rect.right &&
          event.clientY >= rect.top &&
          event.clientY <= rect.bottom
        ) {
          setDragOverChartId(chartId);
          return;
        }
      }
    },
    [dragFromChartId],
  );

  // Releases pointer capture (guarded: a "cancel"/"lost capture" event can
  // fire after capture was already released) and clears drag state -- shared
  // by a successful drop AND an interrupted drag (Codex R1 finding: without
  // `onPointerCancel`/`onLostPointerCapture`, a canceled touch/pointer
  // sequence left the drop-target highlight stuck showing forever).
  const cancelDrag = useCallback((event: React.PointerEvent<HTMLElement>) => {
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    setDragFromChartId(null);
    setDragOverChartId(null);
  }, []);

  const endDrag = useCallback(
    (event: React.PointerEvent<HTMLElement>) => {
      // Both indices are re-derived from the CURRENT `items` at drop time
      // (Security review, TOCTOU / Codex R1 finding): `dragFromChartId`/
      // `dragOverChartId` are stable identities, but the array positions
      // they occupied at any earlier moment can go stale if an async chart
      // add/delete shifts the array while the drag is still in progress.
      // If either chart no longer exists (deleted mid-drag), the drop is
      // simply abandoned.
      if (dragFromChartId !== null && dragOverChartId !== null) {
        const fromIndex = items.findIndex((item) => item.chart === dragFromChartId);
        const toIndex = items.findIndex((item) => item.chart === dragOverChartId);
        if (fromIndex !== -1 && toIndex !== -1) onReorderLayout(fromIndex, toIndex);
      }
      cancelDrag(event);
    },
    [dragFromChartId, dragOverChartId, items, onReorderLayout, cancelDrag],
  );

  return (
    <div
      style={{
        position: "absolute",
        inset: 0,
        display: "grid",
        gridTemplateColumns: `repeat(${gridWidth}, 1fr)`,
        gridAutoRows: GRID_ROW_SIZE,
        gap: GRID_GAP,
        pointerEvents: "none",
      }}
    >
      {items.map((item, index) => {
        const isFirst = index === 0;
        const isLast = index === items.length - 1;
        // Highlights the slot the drag is currently over as the drop
        // target (UX review, Jakob's Law: shows WHERE it will land before
        // release, rather than a free-floating ghost implying free-form
        // placement -- this design reorders+re-packs everything, so a
        // pixel-exact insertion caret would misrepresent the other tiles
        // that also shift once the drop actually repacks the whole array).
        const isDropTarget =
          dragFromChartId !== null &&
          dragOverChartId === item.chart &&
          item.chart !== dragFromChartId;
        return (
          <div
            key={item.chart}
            ref={(el) => setSlotRef(item.chart, el)}
            style={{
              gridColumn: `${item.x + 1} / span ${item.w}`,
              gridRow: `${item.y + 1} / span ${item.h}`,
              position: "relative",
              pointerEvents: "none",
              outline: isDropTarget ? "2px solid #2563eb" : "none",
              outlineOffset: -2,
            }}
          >
            <div
              data-layout-item-chart-id={item.chart}
              role="group"
              aria-label={`「${index + 1}番目のグラフ」の並び順操作`}
              // Focusable (not part of Tab order) so the reorder focus-
              // restoration effect (App.tsx) has something to actually
              // focus after a pointer drag, which -- unlike a button click
              // -- leaves nothing focused on its own. Same pattern as (A)
              // ChartBuilder.tsx's own `data-chart-id` container.
              tabIndex={-1}
              style={{
                position: "absolute",
                top: 4,
                left: 4,
                display: "flex",
                gap: 4,
                pointerEvents: "auto",
                background: "rgba(255,255,255,0.92)",
                border: "1px solid #d1d5db",
                borderRadius: 6,
                padding: 4,
              }}
            >
              {/* /simplify (Simplification finding): one template instead of
                  two copy-pasted buttons differing only in label/delta. */}
              {(
                [
                  { label: "前へ", ariaLabel: "前へ移動", disabled: isFirst, delta: -1 },
                  { label: "後ろへ", ariaLabel: "後ろへ移動", disabled: isLast, delta: 1 },
                ] as const
              ).map(({ label, ariaLabel, disabled, delta }) => (
                <button
                  key={ariaLabel}
                  type="button"
                  aria-label={ariaLabel}
                  aria-describedby={REORDER_HINT_ID}
                  disabled={disabled}
                  onClick={() => onReorderLayout(index, index + delta)}
                  style={{ minHeight: 44, minWidth: 44 }}
                >
                  {label}
                </button>
              ))}
              <button
                type="button"
                aria-label={`「${item.chart}」の幅を狭くする`}
                onClick={() => onResizeLayout(item.chart, -1, 0)}
                disabled={item.w <= 1}
                style={{ minHeight: 44, minWidth: 44 }}
              >
                幅−
              </button>
              <button
                type="button"
                aria-label={`「${item.chart}」の幅を広くする`}
                onClick={() => onResizeLayout(item.chart, 1, 0)}
                disabled={item.w >= gridWidth}
                style={{ minHeight: 44, minWidth: 44 }}
              >
                幅＋
              </button>
              <button
                type="button"
                aria-label={`「${item.chart}」の高さを低くする`}
                onClick={() => onResizeLayout(item.chart, 0, -1)}
                disabled={item.h <= 1}
                style={{ minHeight: 44, minWidth: 44 }}
              >
                高さ−
              </button>
              <button
                type="button"
                aria-label={`「${item.chart}」の高さを高くする`}
                disabled={item.h >= MAX_LAYOUT_H}
                onClick={() => onResizeLayout(item.chart, 0, 1)}
                style={{ minHeight: 44, minWidth: 44 }}
              >
                高さ＋
              </button>
              {/* Pointer-only drag handle (WCAG 2.5.7): the two buttons
                  above already satisfy "keyboard operable" (2.1.1) and
                  "non-dragging single-pointer alternative" (2.5.7) on their
                  own -- this handle is an ADDITIONAL input, not a
                  requirement, so it carries no keyboard semantics of its
                  own. */}
              <span
                aria-hidden="true"
                onPointerDown={(event) => beginDrag(item.chart, event)}
                onPointerMove={trackDrag}
                onPointerUp={endDrag}
                onPointerCancel={cancelDrag}
                onLostPointerCapture={cancelDrag}
                style={{
                  minHeight: 44,
                  minWidth: 44,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  cursor: "grab",
                  touchAction: "none",
                }}
              >
                ⠿
              </span>
            </div>
          </div>
        );
      })}
    </div>
  );
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

export function AuthoringDashboardPreview({
  charts,
  layout,
  chartRowsByQuery,
  onReorderLayout,
  onResizeLayout = () => {},
}: AuthoringDashboardPreviewProps) {
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

  // issue #14: edit mode is a MODE of this same view, not a second grid
  // (UX review, IA finding -- a separate overlay grid rendered alongside
  // the read-only one would leave the user unsure which one they're
  // editing). Disabled with a reason below 2 items (Hick's Law/Nielsen #5:
  // don't offer a control with nothing to do).
  const [editMode, setEditMode] = useState(false);
  const [editModeAnnouncement, setEditModeAnnouncement] = useState<string | null>(null);
  const canReorder = layout.items.length >= 2;
  // Codex R1 finding: deleting a chart while in edit mode could drop
  // `canReorder` to false without ever resetting `editMode`, leaving the
  // toggle stuck showing "pressed" AND disabled with no way to un-press it.
  // `effectiveEditMode` is correct on the SAME render `canReorder` changes
  // and is used everywhere below instead of the raw `editMode` flag.
  const effectiveEditMode = editMode && canReorder;
  // Also resets the underlying `editMode` state itself, so a LATER chart
  // add doesn't silently resurrect a stale "was editing" flag the user
  // never explicitly re-enabled. Done during render via React's own
  // documented "adjusting state when a prop changes" pattern (comparing
  // against a STATE-held previous value, not a ref -- this repo's lint
  // rejects both a bare `setState` inside `useEffect` and any ref read/
  // write during render, so `useState` is the only compliant form left).
  const [prevCanReorder, setPrevCanReorder] = useState(canReorder);
  if (prevCanReorder !== canReorder) {
    setPrevCanReorder(canReorder);
    if (!canReorder && editMode) {
      setEditMode(false);
      setEditModeAnnouncement(null);
    }
  }

  return (
    <div className="hyakkei-authoring-dashboard-preview" role="region" aria-labelledby={LABEL_ID}>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: 4,
        }}
      >
        {/* UX review: role-separation label from (A) ChartBuilder's own
            per-card preview -- the same chart appears in both, and without
            a label distinguishing them a user may wonder why. Text changes
            with edit mode (UX review: visually/textually distinguish
            viewing from editing, Nielsen #1). */}
        <p id={LABEL_ID} style={{ margin: 0, color: "#6b7280", fontSize: 14 }}>
          {effectiveEditMode
            ? "配置ビュー（並び順編集モード）"
            : "配置ビュー（自動レイアウトのプレビュー、読み取り専用）"}
        </p>
        <div style={{ display: "flex", gap: 8 }}>
          <button
            type="button"
            aria-pressed={effectiveEditMode}
            disabled={!canReorder}
            title={canReorder ? undefined : "並び替えるにはグラフが2つ以上必要です"}
            onClick={() => {
              const next = !effectiveEditMode;
              setEditMode(next);
              if (next) {
                setEditModeAnnouncement(
                  "並び順編集モードに入りました。各グラフの「前へ」「後ろへ」ボタン、またはハンドルのドラッグで並び順を変更できます。",
                );
              } else {
                // Codex R1 finding (P2): leaving the announcement visible
                // after explicitly leaving edit mode reads as "you are
                // still editing" -- clear it, unlike `resetAnnouncement`
                // (a one-shot confirmation with no corresponding "undo"
                // state, where staying visible is harmless).
                setEditModeAnnouncement(null);
              }
            }}
            style={{ minHeight: 44, padding: "0 12px", background: "transparent" }}
          >
            並び順を編集
          </button>
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
      </div>
      {resetAnnouncement && <p role="status">{resetAnnouncement}</p>}
      {editModeAnnouncement && <p role="status">{editModeAnnouncement}</p>}
      {chartErrorKind(charts, chartRowsByQuery) && (
        <p role="alert" style={{ margin: "4px 0", fontSize: 13, color: "#b91c1c" }}>
          {chartErrorKind(charts, chartRowsByQuery) === "oom"
            ? "メモリ不足でグラフを表示できませんでした。データ量を減らして再実行してください。"
            : "グラフの集計に失敗しました。条件や列の種類を確認して再実行してください。"}
        </p>
      )}
      {anyChartTruncated(charts, chartRowsByQuery) && (
        <p role="status" style={{ margin: "4px 0", fontSize: 13, color: "#b45309" }}>
          一部のグラフはデータが多いため、先頭{CHART_ROW_LIMIT.toLocaleString("ja-JP")}
          件のみ表示しています。
        </p>
      )}
      <p id={REORDER_HINT_ID} hidden>
        「前へ」「後ろへ」ボタン、またはハンドルのドラッグで並び順を変更できます。
      </p>
      <div style={{ border: "1px dashed #d1d5db", borderRadius: 8, padding: 8 }}>
        {/* issue #14 (Codex R1 finding): `position: relative` must live on a
            wrapper with NO padding of its own -- an absolutely-positioned
            overlay's `inset: 0` resolves against its positioned ancestor's
            PADDING box, so putting `position: relative` on the OUTER
            (padded) div left the overlay's grid offset from the real
            core-rendered grid by the padding amount on every side. */}
        <div style={{ position: "relative" }}>
          <DashboardErrorBoundary key={`${BOUNDARY_KEY}:${resetSeq}`}>
            <AuthoringDashboardGrid
              charts={charts}
              layout={layout}
              chartRowsByQuery={chartRowsByQuery}
            />
          </DashboardErrorBoundary>
          {effectiveEditMode && (
            <LayoutReorderOverlay
              items={layout.items}
              gridWidth={GRID_WIDTHS[layout.grid]}
              onReorderLayout={onReorderLayout}
              onResizeLayout={onResizeLayout}
            />
          )}
        </div>
      </div>
    </div>
  );
}
