// DOM adapter (plan §設計方針 1): the one place that touches the DOM and
// ECharts instances. Everything upstream (normalizeAuthoring/normalizeBaked,
// buildOptions) stays pure; mount() is where a RenderModel finally becomes
// pixels. Framework-independent (plain `echarts.init`, plan §技術選定) so
// editor preview, export, and CLI can all call it the same way.
import { GRID_WIDTHS, type ChartVariant, type Layout } from "@hyakkei/schema";
import * as echarts from "echarts";
import type { EChartsOption } from "echarts";
import { buildAccessibleDataTable, wrapAccessibleFallback } from "./accessible-table.js";
import { buildChartOption, buildOptions } from "./build-options.js";
import { buildDashboardFooter } from "./dom/dashboard-footer.js";
import { buildChartAltTextElement } from "./dom/chart-alt-text.js";
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
//
// Exported (issue #14): the (B) edit overlay (`packages/app`) renders its
// own transparent grid on top of this one and must line up with it exactly
// (same `gridTemplateColumns`/`gridAutoRows`/`gap`) -- importing these
// constants directly, instead of re-deriving the same values in app, is how
// that stays true by construction rather than by two hand-kept copies
// drifting apart.
export const GRID_ROW_SIZE = "4rem";
export const GRID_GAP = "1rem";

function gridStyle(container: HTMLElement, layout: Layout) {
  const width = GRID_WIDTHS[layout.grid];
  container.style.display = "grid";
  container.style.gridTemplateColumns = `repeat(${width}, 1fr)`;
  container.style.gridAutoRows = GRID_ROW_SIZE;
  container.style.gap = GRID_GAP;
}

function tileStyle(el: HTMLElement, x: number, y: number, w: number, h: number) {
  el.style.gridColumn = `${x + 1} / span ${w}`;
  el.style.gridRow = `${y + 1} / span ${h}`;
}

/**
 * The grid row the dashboard footer occupies: one past whatever the content
 * above it ends on (issue #124).
 *
 * The `+ 1` is not cosmetic. `tileStyle` starts a tile at `y + 1`, so a tile
 * at `{y: 0, h: 1}` occupies row 1 and `max(y + h)` names that same row —
 * without the increment the footer lands ON the last tile. jsdom performs no
 * layout, so nothing in the unit suite would show it, and regenerating the
 * pixel baselines would bake the overlap in as the expected picture.
 *
 * `items: []` counts as one row because `buildFullyFromScratch`/`patch` place
 * a "配置されたチャートがありません" tile in that case. It has no explicit
 * position, so it auto-places — and auto-placement runs after definite items,
 * meaning a footer claiming row 1 across all columns would push that message
 * BELOW it. Counting the message's row keeps the two in reading order.
 *
 * Deliberately unclamped, though an adversarial `{y: 100_000, h: 10_000}`
 * makes this ~110,000: `tileStyle` already hands that number straight to
 * `gridRow`, so the implicit tracks exist with or without a footer and a cap
 * here would remove none of them. It would instead introduce two new faults —
 * a tile at the cap row and the footer landing on the same row, and, for
 * layouts past the cap, a "footer" rendering above every tile.
 */
function footerRow(layout: Layout): number {
  const contentRows = layout.items.length
    ? Math.max(...layout.items.map((item) => item.y + item.h))
    : 1;
  return contentRows + 1;
}

/**
 * Appended by both DOM-construction paths, immediately after the empty-layout
 * message and before the resize pass.
 *
 * Both, because `patch()` has three exits: two early returns that delegate to
 * `buildFullyFromScratch` (first call on a container; duplicate chart id) and
 * the differential path that ends in its own `replaceChildren`. Putting the
 * call inside `buildFullyFromScratch` covers the first two for free; the
 * third needs its own. Appending after `replaceChildren` in both is also what
 * makes the footer un-stale — it is rebuilt every time rather than diffed.
 *
 * Before the resize pass, not after: appending a child changes the
 * container's height, and `observeResize` would otherwise see that as a
 * resize worth re-measuring every canvas for.
 */
function appendFooter(container: HTMLElement, model: RenderModel): void {
  const footer = buildDashboardFooter(model.footer);
  // Cleared unconditionally: `replaceChildren` discards children but leaves
  // inline styles behind, so a container that showed a footer once would keep
  // its row template after being patched with a model that has none.
  container.style.gridTemplateRows = "";
  if (!footer) return;

  const row = footerRow(model.layout);
  footer.style.gridRow = String(row);

  // The footer's row has to size to its content, and `gridStyle`'s
  // `gridAutoRows: 4rem` makes every implicit row exactly that. A footer
  // holding a summary plus five provenance items needs more, and an
  // over-full grid row does NOT grow — the content spills outside the
  // container's own height, so the part below the fold is simply not there
  // for the reader. Found by screenshotting the real browser output: the
  // whole provenance line was missing while every unit test passed, because
  // jsdom performs no layout and the elements existed either way.
  //
  // Declaring the rows above the footer explicitly at the same 4rem, then
  // `auto` for the footer's own, leaves tile sizing byte-identical while
  // letting just this one row grow. Tiles cannot be affected: they sit in the
  // `repeat()` part at the size they already had.
  container.style.gridTemplateRows = `repeat(${row - 1}, ${GRID_ROW_SIZE}) auto`;
  container.appendChild(footer);
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

/** Chart types ECharts itself renders (as opposed to `table`/`stat`, plain DOM). */
function isEchartsType(type: ChartVariant["type"]): boolean {
  return type !== "table" && type !== "stat";
}

function renderChartBody(entry: RenderChart, option: EChartsOption | undefined): HTMLElement {
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
 * `"unconfigured"`/`"pending"`/`"error"` always have zero rows or no
 * meaningful rows yet, so `missingColumns` would always return `[]` for them
 * anyway (/simplify Simplification finding: making that structurally visible
 * instead of relying on a reader to notice it).
 *
 * Takes the single `EChartsOption` this one chart needs, not the whole
 * `Record<string, EChartsOption>` map `buildOptions` used to produce (issue
 * #70): `patch()`'s differential path builds an option for at most a
 * handful of changed charts per call, never the whole model -- a shared
 * record forced every caller to have already built options for charts it
 * has no intention of touching.
 */
function renderTile(entry: RenderChart, option: EChartsOption | undefined): HTMLElement {
  switch (entry.state) {
    case "unconfigured":
      return buildTile(buildMessageTile("このチャートはまだデータに接続されていません", "info"));

    case "pending":
      // issue #70/#12(B): a chart whose query hasn't resolved yet, in a
      // multi-chart grid where OTHER charts must still render. Mirrors (A)
      // `ChartPreview.tsx`'s own "計算中…" copy -- that component never
      // reaches mount() at all while pending, so this is the first place
      // this exact state needs its own tile.
      return buildTile(buildMessageTile("計算中…", "info"));

    case "error":
      // issue #70/#12(B): the query behind this chart failed. Mirrors (A)
      // `ChartPreview.tsx`'s post-Phase-8 error copy (recovery guidance,
      // not just "something broke") -- kept word-for-word identical so the
      // same failure reads the same way in both surfaces.
      return buildTile(
        buildMessageTile(
          "プレビューを表示できませんでした。集計の内容を確認してください。",
          "error",
        ),
      );

    case "empty": {
      // Still append the (header-only) accessible fallback (Codex R1 P2): a
      // configured-but-empty chart has real column semantics worth exposing
      // to assistive tech, unlike "unconfigured" (nothing wired yet).
      const emptyAltText = isEchartsType(entry.chart.type)
        ? undefined
        : buildChartAltTextElement(entry.chart.altText);
      return buildTile(
        ...(emptyAltText ? [emptyAltText] : []),
        buildMessageTile("データがありません", "info"),
        wrapAccessibleFallback(buildAccessibleDataTable(entry.chart, entry.rows)),
      );
    }

    case "ok": {
      const missing = missingColumns(entry.chart, entry.rows);
      if (missing.length > 0) {
        return buildTile(
          buildMessageTile(`データに列が見つかりません: ${missing.join(", ")}`, "error"),
        );
      }
      const body = renderChartBody(entry, option);
      const altText = isEchartsType(entry.chart.type)
        ? undefined
        : buildChartAltTextElement(entry.chart.altText);
      // The OTHER orphan path renderChartBody's own try/catch can't cover:
      // by the time body returns, echarts.init already succeeded and
      // registered a live instance -- if buildAccessibleDataTable throws
      // before buildTile ever attaches `body` to the DOM, that instance
      // would otherwise leak the same way (see renderChartBody's comment).
      try {
        return buildTile(
          ...(altText ? [altText] : []),
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
function renderTileSafely(entry: RenderChart, option: EChartsOption | undefined): HTMLElement {
  try {
    return renderTile(entry, option);
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
  const instances: echarts.ECharts[] = [];
  for (const canvas of container.querySelectorAll(".hyakkei-chart-canvas")) {
    const instance = echarts.getInstanceByDom(canvas as HTMLElement);
    if (instance) instances.push(instance);
  }
  resizeInstances(instances);
}

/** Per-instance containment (one instance's `resize()` throwing must never skip the rest), for `patch()`'s own targeted resize set (issue #70) -- only the specific instances a diff actually touched, not every canvas in the container. `resizeAllCanvases` above delegates here too (/simplify Reuse+Simplification finding: both were independently re-implementing this same try/catch loop). */
function resizeInstances(instances: Iterable<echarts.ECharts>): void {
  for (const instance of instances) {
    try {
      instance.resize();
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
 * A live ECharts instance `patch()` (issue #70) is tracking for one chart
 * id, paired with the outer tile DOM node currently representing it (so a
 * "completely unchanged" chart can be re-attached to the container without
 * rebuilding any DOM) and the chart type the instance was actually built
 * for (so a same-id type change -- even bar->pie, both ECharts-backed -- is
 * never mistaken for a reusable instance, plan §差分キー). `instance`/`type`
 * are both absent for a tile with no live ECharts instance (message tile,
 * `table`/`stat`).
 */
type Held = { tile: HTMLElement; instance?: echarts.ECharts; type?: ChartVariant["type"] };

/**
 * Per-container differential-update state (issue #70): container-scoped,
 * never a global chart-id-keyed map (Security review) -- (A) `ChartPreview`
 * (per-card) and (B) `AuthoringDashboardPreview` (grid) can mount the SAME
 * chart id into two DIFFERENT containers at once, and disposing one must
 * never reach into the other. Mirrors `resizeObservers`/`resizeDebounceTimers`
 * above (container-scoped `WeakMap`), extended to a 1:N (container -> many
 * charts) shape those two 1:1 precedents didn't need.
 */
const mountStates = new WeakMap<HTMLElement, { held: Map<string, Held>; model: RenderModel }>();

function themeEqual(a: RenderModel["theme"], b: RenderModel["theme"]): boolean {
  return (
    a.backgroundColor === b.backgroundColor &&
    a.textStyle.color === b.textStyle.color &&
    a.color.length === b.color.length &&
    a.color.every((value, index) => value === b.color[index])
  );
}

/**
 * A `layout.items` entry referencing a chart id absent from `model.charts`
 * (dangling reference, shapes.md finding: `validateLayoutReferences` is
 * advisory only and never throws) -- the renderer's last line of defense
 * against a blank grid slot. Shared by `buildFullyFromScratch` and `patch()`'s
 * own dangling-reference branch (/simplify Reuse finding: this literal was
 * independently duplicated at both call sites).
 */
function buildDanglingReferenceTile(chartId: string): HTMLElement {
  return buildTile(
    buildMessageTile(`レイアウトが存在しないチャート '${chartId}' を参照しています`, "error"),
  );
}

/**
 * Re-derives the `Held` entry for a tile just built for `entry` (/simplify
 * Simplification finding: `buildFullyFromScratch` and `patch()`'s full-rebuild
 * branch each re-implemented this independently). Returns `undefined` when
 * `entry` is ECharts-backed and "ok" but no live instance was actually found
 * on the tile (`renderTileSafely` fell back to an error tile) -- callers must
 * skip adding a registry entry in that case rather than fabricating a
 * tile-only one for a chart type that should always have an instance.
 */
function deriveHeld(tile: HTMLElement, entry: RenderChart): Held | undefined {
  if (entry.state !== "ok" || !isEchartsType(entry.chart.type)) return { tile };
  const canvas = tile.querySelector(".hyakkei-chart-canvas");
  const instance = canvas ? echarts.getInstanceByDom(canvas as HTMLElement) : undefined;
  return instance ? { tile, instance, type: entry.chart.type } : undefined;
}

/**
 * Builds every tile from scratch into `container` (shared by `mount()` and
 * `patch()`'s initial/degrade-to-full-rebuild paths, issue #70) -- the exact
 * construction loop `mount()` always had, extracted so `patch()` can reuse
 * it byte-for-byte instead of drifting into a second, independently
 * -maintained copy. Additionally returns a `Held` map (one entry per
 * ECharts-backed "ok" chart actually placed) so a caller building
 * differential-update state has something to seed it with; `mount()` itself
 * discards this return value -- callers that only ever call `mount()`
 * (bake/CLI/static `DashboardPreview`) never pay for or need to know about
 * `patch()`'s own registry.
 */
function buildFullyFromScratch(container: HTMLElement, model: RenderModel): Map<string, Held> {
  container.replaceChildren();
  gridStyle(container, model.layout);

  const echartsOptions = buildOptions(model);
  const chartsById = new Map(model.charts.map((entry) => [entry.id, entry]));
  const held = new Map<string, Held>();

  for (const item of model.layout.items) {
    // A `layout.items` entry referencing a chart id absent from
    // `model.charts` (dangling reference, shapes.md finding:
    // `validateLayoutReferences` is advisory only and never throws) reaches
    // this function un-rejected -- the renderer is the last line of defense
    // against a blank grid slot.
    const entry = chartsById.get(item.chart);
    const tile = entry
      ? renderTileSafely(entry, echartsOptions[item.chart])
      : buildDanglingReferenceTile(item.chart);

    tileStyle(tile, item.x, item.y, item.w, item.h);
    container.appendChild(tile);

    if (entry) {
      const derived = deriveHeld(tile, entry);
      if (derived) held.set(entry.id, derived);
    }
  }

  if (model.layout.items.length === 0) {
    container.appendChild(buildMessageTile("配置されたチャートがありません", "info"));
  }

  appendFooter(container, model);

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

  return held;
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
 *
 * Also clears `patch()`'s own `mountStates` entry for this container (issue
 * #70, Codex review Major): `mount()`'s own contract ("shed every prior
 * instance for this container") stays unchanged, but a container that was
 * previously driven by `patch()` must not leave stale differential-update
 * state (and the disposed instances it references) behind once `unmount()`
 * runs -- whether `unmount()` is called directly (a component's own final
 * teardown) or implicitly via `mount()`'s first line (a caller that always
 * uses `mount()`, never `patch()`, for this container).
 */
export function unmount(container: HTMLElement): void {
  const state = mountStates.get(container);
  if (state) {
    for (const held of state.held.values()) held.instance?.dispose();
    mountStates.delete(container);
  }
  disconnectResize(container);
  for (const canvas of container.querySelectorAll(".hyakkei-chart-canvas")) {
    echarts.getInstanceByDom(canvas as HTMLElement)?.dispose();
  }
}

export function mount(container: HTMLElement, model: RenderModel): void {
  unmount(container);
  buildFullyFromScratch(container, model);
}

/**
 * Differential update (issue #70/#12(B)): reuses a surviving ECharts
 * instance via `setOption(option, {notMerge:true})` when a chart's id AND
 * `chart.type` both match the previous `patch()` call, and only
 * dispose+re-inits tiles whose id/type/state actually changed. A chart
 * whose `chart`/`rows` references, `state`, and the model's `theme`
 * (structural, not reference, comparison -- `buildEChartsTheme` returns a
 * fresh object every call) are ALL unchanged from the previous call is
 * reused with NO ECharts interaction at all -- not even `setOption`.
 *
 * `mount()` itself is untouched by this function's existence: a caller that
 * only ever calls `mount()` for a container (bake/CLI/static
 * `DashboardPreview`) never triggers this differential path, and that
 * container never accumulates an entry in `mountStates`.
 */
export function patch(container: HTMLElement, model: RenderModel): void {
  // shape enumeration A1: `layout.items` may reference the same chart id
  // more than once (schema's own `validateLayoutReferences` only checks
  // dangling/out-of-bounds/overlap, never duplicate chart-id references).
  // A chart-id-keyed registry cannot represent "one id, several live
  // instances" -- computed BEFORE checking for prior state (Codex review
  // Round 2: a duplicate can appear on the very FIRST `patch()` call for a
  // container too, not only on a transition from a previously-unique
  // model; checking this only inside the "prev exists" branch missed that
  // case entirely).
  const seenIds = new Set<string>();
  let hasDuplicateChartId = false;
  for (const item of model.layout.items) {
    if (seenIds.has(item.chart)) {
      hasDuplicateChartId = true;
      break;
    }
    seenIds.add(item.chart);
  }

  const prev = mountStates.get(container);
  if (!prev || hasDuplicateChartId) {
    // Codex review Round 1 P1: this container may already hold live,
    // untracked ECharts instances (a prior plain `mount()` call, a prior
    // `patch()` call, or none at all) -- `unmount()`'s own DOM
    // `querySelectorAll` fallback disposes them regardless of
    // `mountStates` tracking, so this call is required even when
    // `mountStates` itself has nothing to clear.
    unmount(container);
    const held = buildFullyFromScratch(container, model);
    if (hasDuplicateChartId) {
      // Codex review Round 1 P0: `buildFullyFromScratch`'s `held` map can
      // only track ONE instance per chart id (`Map` semantics) -- a
      // duplicate id's "extra" instance(s) render correctly but would be
      // silently untracked if seeded into `mountStates` here. Deliberately
      // NOT seeding it -- the next `patch()` call for this container
      // always takes THIS SAME branch again (no `mountStates` entry to
      // find), which calls `unmount()` first regardless of whether that
      // model is still duplicated or has resolved to unique, closing the
      // gap on either transition.
      return;
    }
    mountStates.set(container, { held, model });
    return;
  }

  const prevChartsById = new Map(prev.model.charts.map((entry) => [entry.id, entry]));
  const nextChartsById = new Map(model.charts.map((entry) => [entry.id, entry]));
  const prevItemsByChart = new Map(prev.model.layout.items.map((item) => [item.chart, item]));
  const themeChanged = !themeEqual(prev.model.theme, model.theme);
  if (prev.model.layout.grid !== model.layout.grid) gridStyle(container, model.layout);

  const nextHeld = new Map<string, Held>();
  const tiles: HTMLElement[] = [];
  const processedIds = new Set<string>();
  const toResize: echarts.ECharts[] = [];

  for (const item of model.layout.items) {
    processedIds.add(item.chart);
    const entry = nextChartsById.get(item.chart);
    if (!entry) {
      const tile = buildDanglingReferenceTile(item.chart);
      tileStyle(tile, item.x, item.y, item.w, item.h);
      tiles.push(tile);
      continue;
    }

    const prevEntry = prevChartsById.get(item.chart);
    const prevItem = prevItemsByChart.get(item.chart);
    const prevTile = prev.held.get(item.chart);
    const samePosition =
      prevItem !== undefined &&
      prevItem.x === item.x &&
      prevItem.y === item.y &&
      prevItem.w === item.w &&
      prevItem.h === item.h;

    // Completely unchanged: chart/rows references, state, and theme must
    // ALL hold -- `chart` includes `options` (title etc.), so a title-only
    // edit already produces a new `chart` reference upstream (App.tsx) and
    // never lands here (V-010).
    if (
      prevTile !== undefined &&
      prevEntry !== undefined &&
      !themeChanged &&
      prevEntry.chart === entry.chart &&
      prevEntry.rows === entry.rows &&
      prevEntry.state === entry.state
    ) {
      if (!samePosition) {
        tileStyle(prevTile.tile, item.x, item.y, item.w, item.h);
        // A layout-only w/h change resizes this tile's own box without
        // necessarily resizing `container` itself (e.g. a fixed-height grid
        // where only one item's column/row span changed) -- the
        // ResizeObserver on `container` won't fire, so the reused instance
        // must be resized explicitly (Codex review, Phase 6-C).
        if (prevTile.instance) toResize.push(prevTile.instance);
      }
      tiles.push(prevTile.tile);
      nextHeld.set(item.chart, prevTile);
      continue;
    }

    // Same id AND same type or both non-ECharts (table/stat has no
    // instance to reuse) with the current chart in a live-rendering state:
    // reuse the existing ECharts instance via setOption(notMerge), rebuild
    // only the accessible-fallback table (QA V-006 -- a stale fallback next
    // to a fresh canvas is its own silent-stale bug), and re-tag the tile.
    if (
      prevTile?.instance !== undefined &&
      prevTile.type !== undefined &&
      entry.state === "ok" &&
      isEchartsType(entry.chart.type) &&
      prevTile.type === entry.chart.type &&
      missingColumns(entry.chart, entry.rows).length === 0
    ) {
      try {
        const option = buildChartOption(entry, model.theme)!;
        prevTile.instance.setOption(option, { notMerge: true, lazyUpdate: false });
        const canvas = prevTile.tile.querySelector(".hyakkei-chart-canvas") as HTMLElement;
        const tile = buildTile(
          canvas,
          wrapAccessibleFallback(buildAccessibleDataTable(entry.chart, entry.rows)),
        );
        tileStyle(tile, item.x, item.y, item.w, item.h);
        tiles.push(tile);
        nextHeld.set(item.chart, { tile, instance: prevTile.instance, type: entry.chart.type });
        toResize.push(prevTile.instance);
        continue;
      } catch (err) {
        console.error(`hyakkei: chart "${item.chart}" failed to update`, err);
        prevTile.instance.dispose();
        const tile = buildTile(buildMessageTile("このチャートを表示できませんでした", "error"));
        tileStyle(tile, item.x, item.y, item.w, item.h);
        tiles.push(tile);
        // No `nextHeld` entry: the next patch() sees no prior instance for
        // this id and treats it as a fresh build (Codex review Major --
        // a failed slot's registry entry must never linger).
        continue;
      }
    }

    // Everything else (new chart id, type change, state transition, or a
    // missing-column tile) -- full rebuild for this one chart. Disposing
    // whatever instance the previous tile held (if any) first.
    prevTile?.instance?.dispose();
    const option = entry.state === "ok" ? buildChartOption(entry, model.theme) : undefined;
    const tile = renderTileSafely(entry, option);
    tileStyle(tile, item.x, item.y, item.w, item.h);
    tiles.push(tile);
    const derived = deriveHeld(tile, entry);
    if (derived) {
      nextHeld.set(item.chart, derived);
      if (derived.instance) toResize.push(derived.instance);
    }
  }

  // Any chart id the previous patch() held but the current layout.items
  // walk never visited at all (truly removed, not just changed in place).
  for (const [id, held] of prev.held) {
    if (!processedIds.has(id)) held.instance?.dispose();
  }

  container.replaceChildren(...tiles);
  if (model.layout.items.length === 0) {
    container.appendChild(buildMessageTile("配置されたチャートがありません", "info"));
  }
  appendFooter(container, model);
  resizeInstances(toResize);
  observeResize(container);

  mountStates.set(container, { held: nextHeld, model });
}
