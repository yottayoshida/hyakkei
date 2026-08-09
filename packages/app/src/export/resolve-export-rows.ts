import type { Row } from "@hyakkei/core/renderer";
import { appendLimit } from "../chart/chart-encoding.js";
import type { ChartRowState } from "../intake/types.js";

/** One extra row distinguishes exactly 100,000 rows from an oversized export. */
export const EXPORT_ROW_LIMIT = 100_000;

export class ExportRowsError extends Error {
  constructor(
    public readonly code: "row-limit" | "not-ready",
    message: string,
  ) {
    super(message);
    this.name = "ExportRowsError";
  }
}

type ExportChart = { query?: string };
type ExportQuery = { id: string; sql: string };

export type ResolveExportRowsInput = {
  charts: readonly ExportChart[];
  queries: readonly ExportQuery[];
  previewRowsByQuery: ReadonlyMap<string, ChartRowState>;
  execute: (sql: string) => Promise<Row[]>;
};

/**
 * Resolves the exact data snapshot used by export. Preview rows that might
 * have been capped are re-run with a 100001-row sentinel; every chart sharing
 * a query observes the one stable snapshot for that query.
 */
export async function resolveExportRows({
  charts,
  queries,
  previewRowsByQuery,
  execute,
}: ResolveExportRowsInput): Promise<Record<string, Row[]>> {
  const queryIds = [...new Set(charts.flatMap((chart) => (chart.query ? [chart.query] : [])))];
  const rowsByQuery: Record<string, Row[]> = Object.create(null);

  for (const queryId of queryIds) {
    const query = queries.find((candidate) => candidate.id === queryId);
    const preview = previewRowsByQuery.get(queryId);
    if (!query || query.sql === "" || preview?.status !== "ready") {
      throw new ExportRowsError(
        "not-ready",
        "配布用HTMLを書き出すには、元データを接続してグラフの計算を完了してください。",
      );
    }

    if (!preview.truncated) {
      rowsByQuery[queryId] = preview.rows;
      continue;
    }

    const fullRows = await execute(appendLimit(query.sql, EXPORT_ROW_LIMIT + 1));
    if (fullRows.length > EXPORT_ROW_LIMIT) {
      throw new ExportRowsError(
        "row-limit",
        "配布用データが10万行を超えています。条件や集計を追加してください。",
      );
    }
    rowsByQuery[queryId] = fullRows;
  }

  return rowsByQuery;
}
