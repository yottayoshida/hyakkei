// `stat` ChartVariant: a single-value tile. `SingleValue` encoding (schema
// common.ts) has no query aggregation guarantee, so this reads the first
// row only -- an author wanting a specific aggregate (max/latest/sum)
// expresses that in the query SQL, not here.
import type { BakedChart, Chart } from "@hyakkei/schema";
import type { Row } from "../render-model.js";
import { cellText } from "./cell-text.js";

export function buildStatElement(chart: Chart | BakedChart, rows: Row[]): HTMLElement {
  if (chart.type !== "stat") throw new Error(`buildStatElement: expected stat, got ${chart.type}`);
  const { value } = chart.encoding;

  const container = document.createElement("div");
  container.className = "hyakkei-stat";

  if (chart.options.title) {
    const title = document.createElement("div");
    title.className = "hyakkei-stat-title";
    title.textContent = chart.options.title;
    container.appendChild(title);
  }

  const valueEl = document.createElement("div");
  valueEl.className = "hyakkei-stat-value";
  valueEl.textContent = cellText(rows[0]?.[value], "—");
  container.appendChild(valueEl);

  return container;
}
