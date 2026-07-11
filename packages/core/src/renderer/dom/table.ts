// `table` ChartVariant: the primary rendering IS a real DOM table, built
// with textContent only (plan §設計方針 6 -- no innerHTML). A row cell is
// row/meta-derived data (schema AB-1: inert by shape, not by content) and
// must never be interpreted as markup. Skeleton (thead/tbody) shared with
// ../accessible-table.ts via data-table.ts.
import type { BakedChart, Chart } from "@hyakkei/schema";
import type { Row } from "../render-model.js";
import { buildDataTableSkeleton } from "./data-table.js";

export function buildTableElement(chart: Chart | BakedChart, rows: Row[]): HTMLTableElement {
  if (chart.type !== "table")
    throw new Error(`buildTableElement: expected table, got ${chart.type}`);

  const table = buildDataTableSkeleton(chart.encoding.columns, rows);
  table.className = "hyakkei-table";
  return table;
}
