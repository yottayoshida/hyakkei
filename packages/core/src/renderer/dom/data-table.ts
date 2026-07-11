// Shared table-skeleton builder for `dom/table.ts` (the `table` ChartVariant's
// primary rendering) and `../accessible-table.ts` (the data-table fallback
// every OTHER variant gets) -- both built the same thead/tbody structure
// independently before this extraction (/simplify Reuse + Altitude
// findings). The two callers differ only in className/caption/`scope`,
// which stays their own responsibility.
import type { Row } from "../render-model.js";
import { cellText } from "./cell-text.js";

export function buildDataTableSkeleton(
  columns: string[],
  rows: Row[],
  options: { scopeCol?: boolean } = {},
): HTMLTableElement {
  const table = document.createElement("table");

  const thead = document.createElement("thead");
  const headerRow = document.createElement("tr");
  for (const column of columns) {
    const th = document.createElement("th");
    if (options.scopeCol) th.setAttribute("scope", "col");
    th.textContent = column;
    headerRow.appendChild(th);
  }
  thead.appendChild(headerRow);
  table.appendChild(thead);

  const tbody = document.createElement("tbody");
  for (const row of rows) {
    const tr = document.createElement("tr");
    for (const column of columns) {
      const td = document.createElement("td");
      td.textContent = cellText(row[column]);
      tr.appendChild(td);
    }
    tbody.appendChild(tr);
  }
  table.appendChild(tbody);

  return table;
}
