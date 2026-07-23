// Pure boundary (plan §設計方針 1): the only input is `RenderModel`, produced
// by either normalizeAuthoring or normalizeBaked. No document/rows/DOM
// access happens here. Covers the 5 ChartVariant types ECharts renders
// directly (bar/line/area/scatter/pie) -- `table`/`stat` are built as plain
// DOM (renderer/dom/table.ts, stat.ts) and never reach this function.
import type { BakedChart, Chart } from "@hyakkei/schema";
import type { EChartsOption } from "echarts";
import { cellText } from "./dom/cell-text.js";
import type { EChartsThemeObject } from "../theme/echarts-theme.js";
import type { RenderChart, RenderModel } from "./render-model.js";

type LegendPosition = "top" | "bottom" | "left" | "right";

/**
 * Three-valued semantics, pinned by tests (issue #61):
 * 1. no legend object at all -> hidden (charts stay legend-free by default)
 * 2. `show: false`, with or without a position -> hidden (explicit opt-out
 *    always wins)
 * 3. `position` present, `show` omitted -> SHOWN. The only reason to write
 *    `position: "right"` is wanting a legend on the right -- the previous
 *    `if (!show)` treated an omitted `show` as `false` and silently ignored
 *    the position, giving the author no legend and no feedback. The inferred
 *    default is also documented on the schema (`ChartOptions.legend` JSDoc,
 *    packages/schema/src/common.ts) since dashboard.json is an external
 *    authoring contract, not an internal shape.
 */
function legendOption(
  position: LegendPosition | undefined,
  show: boolean | undefined,
): EChartsOption["legend"] {
  const visible = show ?? position !== undefined;
  if (!visible) return { show: false };
  const orient = position === "left" || position === "right" ? "vertical" : "horizontal";
  switch (position ?? "top") {
    case "top":
      return { show: true, orient, top: 0 };
    case "bottom":
      return { show: true, orient, bottom: 0 };
    case "left":
      return { show: true, orient, left: 0 };
    case "right":
      return { show: true, orient, right: 0 };
  }
}

/**
 * `interval: 0` on every category axis is deliberate, not a default left in
 * place (PR-0 finding, docs/spikes/m0-charts.md): ECharts' own default
 * `axisLabel.interval: 'auto'` silently drops a label entirely -- no
 * ellipsis, no rotation -- when adjacent category labels overlap, which is
 * routine for CJK text. Omitting this line reintroduces that exact bug.
 */
function categoryAxis(data: string[], rotate: number | undefined) {
  return { type: "category" as const, data, axisLabel: { interval: 0, rotate: rotate ?? 0 } };
}

/**
 * `title`/`legend` are set identically across all 5 ECharts-backed variants
 * (/simplify Simplification finding: previously copy-pasted 3x) -- every
 * variant-specific function spreads this in, then adds its own `xAxis`/
 * `series`/etc.
 */
function baseOptionFields(chart: Chart | BakedChart): Pick<EChartsOption, "title" | "legend"> {
  return {
    title: chart.options.title ? { text: chart.options.title } : undefined,
    legend: legendOption(chart.options.legend?.position, chart.options.legend?.show),
  };
}

// `Number.isFinite`, not just `typeof` (issue #57): NaN/Infinity are
// representable in live query results (`SELECT 1.0/0`) but JSON-serialize to
// `null` -- letting them through here means the authoring preview (Infinity
// reaches the value axis, breaking its extent) and the baked viewer (a normal
// null gap after the artifact's JSON round-trip) render the SAME document
// differently, violating the authoring==baked identity. Normalizing at this
// boundary makes both paths see what JSON can carry.
function numericCell(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

// Pie's `PieDataItemOption.value` doesn't accept `null` the way xy/scatter
// series data does (a gap in a bar chart vs. a slice with no defined size
// are different concepts) -- `undefined` is pie's own "no value" spelling.
function numericCellOrUndefined(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function xyOption(entry: RenderChart, seriesType: "bar" | "line" | "area"): EChartsOption {
  const chart = entry.chart;
  if (chart.type !== seriesType)
    throw new Error(`xyOption: expected ${seriesType}, got ${chart.type}`);
  const { x, y } = chart.encoding;

  // Single pass over rows (/simplify Efficiency finding: two independent
  // `.map()` calls previously walked the same array). `cellText`, not raw
  // `String()` (QA Phase 8 F-001): a null/undefined category cell must
  // render the same "blank" way here as it does in the a11y fallback table
  // (dom/data-table.ts, via the same `cellText`) -- raw `String()` would
  // print the literal word "null"/"undefined" on the chart axis while the
  // fallback table shows an empty cell for the identical data, exactly the
  // formatting drift `cellText`'s own doc comment says it exists to prevent.
  const categories: string[] = [];
  const values: (number | null)[] = [];
  for (const row of entry.rows) {
    categories.push(cellText(row[x]));
    values.push(numericCell(row[y]));
  }

  return {
    ...baseOptionFields(chart),
    xAxis: categoryAxis(categories, chart.options.xAxisLabelRotate),
    yAxis: { type: "value" },
    series: [
      {
        type: seriesType === "area" ? "line" : seriesType,
        areaStyle: seriesType === "area" ? {} : undefined,
        label: { show: chart.options.showDataLabels ?? false },
        data: values,
      },
    ],
  };
}

const DEFAULT_SYMBOL_SIZE = 10;

function scatterOption(entry: RenderChart): EChartsOption {
  const chart = entry.chart;
  if (chart.type !== "scatter")
    throw new Error(`scatterOption: expected scatter, got ${chart.type}`);
  const { x, y, size } = chart.encoding;

  return {
    ...baseOptionFields(chart),
    xAxis: { type: "value" },
    yAxis: { type: "value" },
    series: [
      {
        type: "scatter",
        // Per-point `symbolSize` on each data item (not a series-level
        // `symbolSize` callback): a callback is a function value, which
        // breaks `toEqual`/JSON-based golden comparison (plan §技術選定
        // "EChartsOption deep-equal" is the primary golden layer) -- two
        // behaviorally-identical closures are never `===` or structurally
        // equal to a deep-equal matcher.
        data: entry.rows.map((row) => ({
          value: [numericCell(row[x]), numericCell(row[y])],
          symbolSize: size ? (numericCell(row[size]) ?? DEFAULT_SYMBOL_SIZE) : undefined,
        })),
      },
    ],
  };
}

function pieOption(entry: RenderChart): EChartsOption {
  const chart = entry.chart;
  if (chart.type !== "pie") throw new Error(`pieOption: expected pie, got ${chart.type}`);
  const { category, value } = chart.encoding;

  return {
    ...baseOptionFields(chart),
    series: [
      {
        type: "pie",
        radius: chart.options.donut ? ["40%", "70%"] : "70%",
        label: { show: chart.options.showDataLabels ?? false },
        data: entry.rows.map((row) => ({
          name: cellText(row[category]), // QA Phase 8 F-001: match a11y fallback formatting
          value: numericCellOrUndefined(row[value]),
        })),
      },
    ],
  };
}

/**
 * One chart's full (theme-merged) option, extracted from `buildOptions`'
 * former per-entry loop body (issue #70, plan §buildOptions分割) so `patch()`
 * (mount.ts) can build a single chart's option on demand -- reusing this
 * exact function keeps `buildOptions`' own output byte-identical (same merge
 * order, same `table`/`stat` `undefined` short-circuit) instead of drifting
 * into a second, independently-maintained per-chart builder.
 */
export function buildChartOption(
  entry: RenderChart,
  theme: EChartsThemeObject,
): EChartsOption | undefined {
  const built = ((): EChartsOption | undefined => {
    switch (entry.chart.type) {
      case "bar":
      case "line":
      case "area":
        return xyOption(entry, entry.chart.type);
      case "scatter":
        return scatterOption(entry);
      case "pie":
        return pieOption(entry);
      default:
        return undefined; // table/stat render as DOM, not ECharts options
    }
  })();
  if (!built) return undefined;
  return {
    backgroundColor: theme.backgroundColor,
    color: theme.color,
    textStyle: theme.textStyle,
    animation: false,
    aria: { enabled: true, decal: { show: true } },
    tooltip: { show: true },
    ...built,
  };
}

export function buildOptions(model: RenderModel): Record<string, EChartsOption> {
  // `Object.create(null)`, not `{}` (issue #57 sibling, issue #58):
  // `Chart.id` is an unrestricted NonEmptyString, and on a plain object
  // `options["__proto__"] = built` triggers the inherited setter instead of
  // creating an own key -- the chart then renders only via accidental
  // prototype lookup while every `Object.keys`/`entries`/`JSON.stringify`
  // consumer (the xss dangerous-key scan, the golden deep-equal layer) is
  // blind to its entire option tree. Same reachability argument, same fix
  // family, as `lookupRows`'s `Object.hasOwn` guard.
  const options: Record<string, EChartsOption> = Object.create(null);

  for (const entry of model.charts) {
    const option = buildChartOption(entry, model.theme);
    if (option) options[entry.id] = option;
  }

  return options;
}
