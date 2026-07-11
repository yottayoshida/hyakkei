// Shared by accessible-table.ts (which columns to show) and mount.ts (which
// columns must be present in `rows` before rendering, V-105). One source of
// truth for "what column names does this ChartVariant's encoding name" so
// the two call sites cannot silently drift apart on a chart type's shape.
import type { Chart, BakedChart } from "@hyakkei/schema";

export function encodingColumns(chart: Chart | BakedChart): string[] {
  switch (chart.type) {
    case "bar":
    case "line":
    case "area":
      return [chart.encoding.x, chart.encoding.y];
    case "scatter":
      return chart.encoding.size
        ? [chart.encoding.x, chart.encoding.y, chart.encoding.size]
        : [chart.encoding.x, chart.encoding.y];
    case "pie":
      return [chart.encoding.category, chart.encoding.value];
    case "table":
      return chart.encoding.columns;
    case "stat":
      return [chart.encoding.value];
  }
}
