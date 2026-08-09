import type { Row } from "@hyakkei/core/renderer";
import { describe, expect, it, vi } from "vitest";
import { EXPORT_ROW_LIMIT, ExportRowsError, resolveExportRows } from "./resolve-export-rows.js";

const ROW: Row = { label: "A", value: 1 };

describe("resolveExportRows", () => {
  it("reuses complete preview rows and re-runs each truncated query just once", async () => {
    const execute = vi.fn(async (sql: string) => {
      expect(sql).toBe("SELECT * FROM data LIMIT 100001");
      return [ROW, { label: "B", value: 2 }];
    });

    const rows = await resolveExportRows({
      charts: [{ query: "q1" }, { query: "q1" }, { query: "q2" }],
      queries: [
        { id: "q1", sql: "SELECT * FROM data" },
        { id: "q2", sql: "SELECT * FROM complete" },
      ],
      previewRowsByQuery: new Map([
        ["q1", { status: "ready" as const, rows: [ROW], truncated: true }],
        ["q2", { status: "ready" as const, rows: [{ label: "C", value: 3 }], truncated: false }],
      ]),
      execute,
    });

    expect(execute).toHaveBeenCalledTimes(1);
    expect(rows).toEqual({ q1: [ROW, { label: "B", value: 2 }], q2: [{ label: "C", value: 3 }] });
  });

  it("fails explicitly instead of silently truncating at the 100001-row sentinel", async () => {
    const execute = vi.fn(async () => Array.from({ length: EXPORT_ROW_LIMIT + 1 }, () => ROW));

    await expect(
      resolveExportRows({
        charts: [{ query: "q1" }],
        queries: [{ id: "q1", sql: "SELECT * FROM data" }],
        previewRowsByQuery: new Map([
          ["q1", { status: "ready" as const, rows: [ROW], truncated: true }],
        ]),
        execute,
      }),
    ).rejects.toMatchObject({
      name: "ExportRowsError",
      code: "row-limit",
      message: "配布用データが10万行を超えています。条件や集計を追加してください。",
    } satisfies Partial<ExportRowsError>);
  });
});
