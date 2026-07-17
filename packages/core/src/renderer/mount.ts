// DOM adapter (plan §設計方針 1): the one place that touches the DOM and
// ECharts instances. Everything upstream (normalizeAuthoring/normalizeBaked,
// buildOptions) stays pure; mount() is where a RenderModel finally becomes
// pixels. Framework-independent (plain `echarts.init`, plan §技術選定) so
// editor preview, export, and CLI can all call it the same way.
import { GRID_WIDTHS, type Layout } from "@hyakkei/schema";
import * as echarts from "echarts";
import { buildAccessibleDataTable, wrapAccessibleFallback } from "./accessible-table.js";
import { buildOptions } from "./build-options.js";
import { buildMessageTile } from "./dom/message-tile.js";
import { buildStatElement } from "./dom/stat.js";
import { buildTableElement } from "./dom/table.js";
import { encodingColumns } from "./encoding-columns.js";
import type { RenderChart, RenderModel } from "./render-model.js";

// A `LayoutItem.h` unit is an abstract grid row (schema); what one row is
// worth on screen is a presentation decision, so it lives here. Without an
// explicit row size CSS grid's implicit rows are content-sized (`auto`),
// the chart canvas's `height: 100%` resolves against that auto-height
// parent, and the two collapse together to a near-zero box — found on
// first real-browser verification; jsdom does no layout, so no unit test
// in this package can observe it.
const GRID_ROW_SIZE = "4rem";

function gridStyle(container: HTMLElement, layout: Layout) {
  const width = GRID_WIDTHS[layout.grid];
  container.style.display = "grid";
  container.style.gridTemplateColumns = `repeat(${width}, 1fr)`;
  container.style.gridAutoRows = GRID_ROW_SIZE;
  container.style.gap = "1rem";
}

function tileStyle(el: HTMLElement, x: number, y: number, w: number, h: number) {
  el.style.gridColumn = `${x + 1} / span ${w}`;
  el.style.gridRow = `${y + 1} / span ${h}`;
}

/**
 * A `.hyakkei-tile` wrapping a single `buildMessageTile()` is every non-
 * rendering outcome in this file (unconfigured, missing-column, empty,
 * dangling layout reference) -- one place to build that pairing instead of
 * four (/simplify Altitude finding).
 */
function buildTile(...children: HTMLElement[]): HTMLElement {
  const tile = document.createElement("div");
  tile.className = "hyakkei-tile";
  // Flex column so the chart canvas (`flex: 1`) takes the tile height the
  // grid row span gives it, minus the accessible fallback's own height.
  // `minWidth`/`minHeight: 0` override the flex/grid default of
  // `min-*: auto`, which would otherwise let a wide table or an opened
  // fallback dictate the tile's size instead of the layout item's w/h;
  // `overflow: auto` is the escape hatch for content (an opened fallback
  // table) that genuinely exceeds the now-fixed tile height.
  tile.style.display = "flex";
  tile.style.flexDirection = "column";
  tile.style.minWidth = "0";
  tile.style.minHeight = "0";
  tile.style.overflow = "auto";
  for (const child of children) tile.appendChild(child);
  return tile;
}

/**
 * V-105 (missing encoding column): a column referenced by `chart.encoding`
 * that appears in NO row is a query/chart mismatch worth surfacing, not a
 * per-cell null (that's V-107, handled by `numericCell`/`cellText`'s
 * null-safe formatting instead of an error tile). Empty `rows` is its own,
 * non-error case -- there is no column to be "missing" from zero rows.
 *
 * Single pass over `rows` to collect every key present anywhere, rather
 * than `.some()` per column (/simplify Efficiency finding: the previous
 * form was one row-scan per column, i.e. O(columns × rows) on the error
 * path) -- this is O(rows + columns) regardless of outcome.
 */
function missingColumns(chart: RenderChart["chart"], rows: RenderChart["rows"]): string[] {
  if (rows.length === 0) return [];
  const present = new Set<string>();
  for (const row of rows) for (const key of Object.keys(row)) present.add(key);
  return encodingColumns(chart).filter((column) => !present.has(column));
}

function renderChartBody(
  entry: RenderChart,
  echartsOptions: Record<string, echarts.EChartsOption>,
): HTMLElement {
  if (entry.chart.type === "table") return buildTableElement(entry.chart, entry.rows);
  if (entry.chart.type === "stat") return buildStatElement(entry.chart, entry.rows);

  const canvas = document.createElement("div");
  canvas.className = "hyakkei-chart-canvas";
  canvas.style.width = "100%";
  // In the tile's flex column: fill whatever height the fallback
  // `<details>` doesn't use (`height: 100%` would instead race the sibling
  // for the same 100% and overflow). `minHeight: 0` again overrides
  // `min-height: auto` so ECharts' own inner div can't prop the box open.
  canvas.style.flex = "1 1 auto";
  canvas.style.minHeight = "0";
  const instance = echarts.init(canvas, undefined, { renderer: "svg" });
  const option = echartsOptions[entry.id];
  if (option) {
    // Codex proxy R1 / /code-review (xhigh) finding (4 independent angles):
    // `echarts.init` registers `instance` in ECharts' own module-level
    // registry (`instances[chart.id] = ...`) BEFORE this line runs -- a
    // `setOption` throw here would otherwise leave that instance orphaned
    // (this `canvas` never reaches `renderTile`'s caller, so `unmount()`'s
    // `querySelectorAll('.hyakkei-chart-canvas')` can never find it to
    // dispose it), leaking its zrender timers/listeners for the page's
    // lifetime. Disposing before re-throwing makes this function's own
    // failure self-contained; renderTile's "ok" case below handles the
    // OTHER orphan path (a throw from the accessible-fallback builder,
    // after this function already returned successfully).
    try {
      instance.setOption(option);
    } catch (err) {
      instance.dispose();
      throw err;
    }
  }
  return canvas;
}

/**
 * Branches on `entry.state` first (the type-level axis ADR-0008 introduced),
 * then checks `missingColumns` only inside the `"ok"` case -- `"empty"`/
 * `"unconfigured"` always have zero rows, so `missingColumns` would always
 * return `[]` for them anyway (/simplify Simplification finding: making
 * that structurally visible instead of relying on a reader to notice it).
 */
function renderTile(
  entry: RenderChart,
  echartsOptions: Record<string, echarts.EChartsOption>,
): HTMLElement {
  switch (entry.state) {
    case "unconfigured":
      return buildTile(buildMessageTile("このチャートはまだデータに接続されていません", "info"));

    case "empty":
      // Still append the (header-only) accessible fallback (Codex R1 P2): a
      // configured-but-empty chart has real column semantics worth exposing
      // to assistive tech, unlike "unconfigured" (nothing wired yet).
      return buildTile(
        buildMessageTile("データがありません", "info"),
        wrapAccessibleFallback(buildAccessibleDataTable(entry.chart, entry.rows)),
      );

    case "ok": {
      const missing = missingColumns(entry.chart, entry.rows);
      if (missing.length > 0) {
        return buildTile(
          buildMessageTile(`データに列が見つかりません: ${missing.join(", ")}`, "error"),
        );
      }
      const body = renderChartBody(entry, echartsOptions);
      // The OTHER orphan path renderChartBody's own try/catch can't cover:
      // by the time body returns, echarts.init already succeeded and
      // registered a live instance -- if buildAccessibleDataTable throws
      // before buildTile ever attaches `body` to the DOM, that instance
      // would otherwise leak the same way (see renderChartBody's comment).
      try {
        return buildTile(
          body,
          wrapAccessibleFallback(buildAccessibleDataTable(entry.chart, entry.rows)),
        );
      } catch (err) {
        echarts.getInstanceByDom(body)?.dispose();
        throw err;
      }
    }
  }
}

/**
 * Per-tile blast-radius containment (issue #69): `renderTile` calls into
 * ECharts (`init`/`setOption`) and the accessible-fallback builders, none
 * of which this file controls end-to-end -- a malformed option shape or an
 * unexpected `RenderModel` value reaching this function must not tear down
 * every OTHER tile too (React unmounts the whole tree past an uncaught
 * render/effect-phase error, plan's own risk-table entry). Console-only
 * detail (errorCopy.ts's discipline elsewhere in this repo: no raw error
 * content in user-facing text) + the existing generic message-tile is the
 * degrade path, not a new UI primitive.
 */
function renderTileSafely(
  entry: RenderChart,
  echartsOptions: Record<string, echarts.EChartsOption>,
): HTMLElement {
  try {
    return renderTile(entry, echartsOptions);
  } catch (err) {
    console.error(`hyakkei: chart "${entry.id}" failed to render`, err);
    // UX review (Phase 8): "チャート", not "グラフ" -- this file's other
    // three user-facing strings (unconfigured/dangling-reference/empty-
    // layout) all say "チャート", and a failed tile can be a table/stat
    // (not a graph at all), so "グラフ" was both inconsistent and
    // sometimes inaccurate.
    return buildTile(buildMessageTile("このチャートを表示できませんでした", "error"));
  }
}

/**
 * Shared by `mount()`'s own post-attach pass and `ResizeObserver`'s
 * callback below (Phase 5 Major review finding) -- both walk the same
 * canvas set and must both survive one instance's `resize()` throwing
 * without abandoning the rest of the batch, the same per-tile blast-radius
 * principle `renderTileSafely` applies to initial render.
 */
function resizeAllCanvases(container: HTMLElement): void {
  for (const canvas of container.querySelectorAll(".hyakkei-chart-canvas")) {
    try {
      echarts.getInstanceByDom(canvas as HTMLElement)?.resize();
    } catch (err) {
      console.error("hyakkei: chart resize failed", err);
    }
  }
}

// Issue #68: an observer handle has no DOM-queryable trace (unlike an
// ECharts instance, which `echarts.getInstanceByDom` can always find again
// from the canvas element alone) -- module-state WeakMaps are what let
// `unmount()`/a re-`observeResize()` call find and tear down a PREVIOUS
// container's observer instead of silently accumulating one per mount.
const resizeObservers = new WeakMap<HTMLElement, ResizeObserver>();
const resizeDebounceTimers = new WeakMap<HTMLElement, ReturnType<typeof setTimeout>>();
const RESIZE_DEBOUNCE_MS = 100;

function disconnectResize(container: HTMLElement): void {
  resizeObservers.get(container)?.disconnect();
  resizeObservers.delete(container);
  const timer = resizeDebounceTimers.get(container);
  if (timer !== undefined) clearTimeout(timer);
  resizeDebounceTimers.delete(container);
}

/**
 * `disconnectResize` first (not just `??=`-style skip-if-present): a
 * container mounted a second time (editor's own `useEffect([dashboard])`
 * remount path) must not accumulate a second observer alongside the first
 * -- every resize would then fire the debounced callback twice, doubling
 * `resizeAllCanvases` work per resize event, unbounded with each remount.
 */
function observeResize(container: HTMLElement): void {
  disconnectResize(container);
  // /code-review (xhigh) Efficiency finding: per spec, observe() reports an
  // initial size on any already-laid-out element -- redundant here since
  // mount()'s own one-shot resizeAllCanvases() (just before this call)
  // already measured that same initial size. Skipping only the FIRST
  // notification (not every one) is what keeps every later, genuine resize
  // debounced and handled as before.
  let primed = false;
  const observer = new ResizeObserver(() => {
    if (!primed) {
      primed = true;
      return;
    }
    const existing = resizeDebounceTimers.get(container);
    if (existing !== undefined) clearTimeout(existing);
    resizeDebounceTimers.set(
      container,
      setTimeout(() => resizeAllCanvases(container), RESIZE_DEBOUNCE_MS),
    );
  });
  observer.observe(container);
  resizeObservers.set(container, observer);
}

/**
 * A remount (editor swapping the previewed dashboard, plan's App.tsx
 * `useEffect(..., [dashboard])`) must not leak the previous mount's ECharts
 * instances (Codex R1 P3): `replaceChildren()` alone discards the DOM nodes
 * an instance is attached to without releasing the instance's own internal
 * state (event listeners, zrender scheduling) -- `echarts.dispose()` is the
 * one API that actually releases it. Exported as `unmount()` too
 * (/simplify Efficiency finding) so a component whose *own* lifecycle ends
 * (not just its dashboard prop changing) has a disposal path -- `mount()`'s
 * internal call only covers "the same container gets mounted again."
 */
export function unmount(container: HTMLElement): void {
  disconnectResize(container);
  for (const canvas of container.querySelectorAll(".hyakkei-chart-canvas")) {
    echarts.getInstanceByDom(canvas as HTMLElement)?.dispose();
  }
}

export function mount(container: HTMLElement, model: RenderModel): void {
  unmount(container);
  container.replaceChildren();
  gridStyle(container, model.layout);

  const echartsOptions = buildOptions(model);
  const chartsById = new Map(model.charts.map((entry) => [entry.id, entry]));

  for (const item of model.layout.items) {
    // A `layout.items` entry referencing a chart id absent from
    // `model.charts` (dangling reference, shapes.md finding:
    // `validateLayoutReferences` is advisory only and never throws) reaches
    // this function un-rejected -- the renderer is the last line of defense
    // against a blank grid slot.
    const entry = chartsById.get(item.chart);
    const tile = entry
      ? renderTileSafely(entry, echartsOptions)
      : buildTile(
          buildMessageTile(
            `レイアウトが存在しないチャート '${item.chart}' を参照しています`,
            "error",
          ),
        );

    tileStyle(tile, item.x, item.y, item.w, item.h);
    container.appendChild(tile);
  }

  if (model.layout.items.length === 0) {
    container.appendChild(buildMessageTile("配置されたチャートがありません", "info"));
  }

  // `echarts.init` above ran on a still-detached div (renderChartBody
  // builds tiles before this loop appends them), so ECharts measured 0×0
  // and rendered at its internal fallback size — the "Can't get DOM width
  // or height" warning in every jsdom test run was this same condition.
  // ECharts never re-measures on its own; one explicit resize() now that
  // every tile is attached and the grid has sized it is what makes the
  // chart fill its real box.
  resizeAllCanvases(container);
  // Issue #68: the one-shot resize() above only covers the moment of
  // mount -- nothing previously re-measured a chart after ITS container
  // was resized post-mount (a maximized window, a resizable editor pane).
  observeResize(container);
}
