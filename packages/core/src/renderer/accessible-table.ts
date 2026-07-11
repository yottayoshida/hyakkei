// Data-table fallback (plan §非機能要件 a11y, PR-C acceptance: "全チャート
// に data-table fallback"). Applied uniformly to every ChartVariant --
// including `table` itself -- so mount.ts has one code path instead of a
// special case that skips the fallback for the one type that happens to
// already look like a table (plan's altitude principle: no bandaids on
// shared infra). Skeleton (thead/tbody) shared with dom/table.ts via
// dom/data-table.ts; this function adds only what's unique to the
// fallback role: a caption and `scope="col"` headers.
import type { BakedChart, Chart } from "@hyakkei/schema";
import { buildDataTableSkeleton } from "./dom/data-table.js";
import { encodingColumns } from "./encoding-columns.js";
import type { Row } from "./render-model.js";

export function buildAccessibleDataTable(chart: Chart | BakedChart, rows: Row[]): HTMLTableElement {
  const table = buildDataTableSkeleton(encodingColumns(chart), rows, { scopeCol: true });
  table.className = "hyakkei-accessible-data-table";

  const caption = document.createElement("caption");
  caption.textContent = chart.options.title ?? `${chart.type} chart data`;
  table.insertBefore(caption, table.firstChild);

  return table;
}

/**
 * `<details>`/`<summary>` is a native disclosure widget -- no ARIA
 * attributes or JS toggle logic needed to make it accessible or keyboard-
 * operable, unlike a custom show/hide `<div>`.
 */
export function wrapAccessibleFallback(dataTable: HTMLTableElement): HTMLDetailsElement {
  const details = document.createElement("details");
  details.className = "hyakkei-accessible-fallback";
  const summary = document.createElement("summary");
  summary.textContent = "データを表で見る";
  details.appendChild(summary);
  details.appendChild(dataTable);
  return details;
}
