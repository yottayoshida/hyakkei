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

function gridStyle(container: HTMLElement, layout: Layout) {
  const width = GRID_WIDTHS[layout.grid];
  container.style.display = "grid";
  container.style.gridTemplateColumns = `repeat(${width}, 1fr)`;
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
  canvas.style.height = "100%";
  const instance = echarts.init(canvas, undefined, { renderer: "svg" });
  const option = echartsOptions[entry.id];
  if (option) instance.setOption(option);
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
      return buildTile(
        renderChartBody(entry, echartsOptions),
        wrapAccessibleFallback(buildAccessibleDataTable(entry.chart, entry.rows)),
      );
    }
  }
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
      ? renderTile(entry, echartsOptions)
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
}
