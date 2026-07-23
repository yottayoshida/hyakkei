import type { Chart, ChartVariant } from "@hyakkei/schema";
import { parseDashboard } from "@hyakkei/schema";
import { describe, expect, it } from "vitest";
import {
  appendLimit,
  CHART_ROW_LIMIT,
  detectNumericMismatch,
  isTruncated,
  reconcileChartOptions,
  reconcileEncoding,
  tileToVariant,
  usableColumns,
  variantToTile,
} from "./chart-encoding.js";

const ALL_TYPES: ChartVariant["type"][] = [
  "bar",
  "line",
  "area",
  "scatter",
  "pie",
  "table",
  "stat",
];

const PREVIEW_COLUMNS = ["category", "sum_amount"];

/** Wraps one reconciled encoding in a minimal, otherwise-valid Dashboard document. */
function docWithChart(type: ChartVariant["type"], encoding: ChartVariant["encoding"]) {
  return {
    version: 1,
    meta: { title: "t" },
    theme: { tokens: "@digital-go-jp/design-tokens@2.0.1", palette: "guidebook-blue" },
    sources: [],
    queries: [],
    charts: [{ id: "c1", type, encoding, options: {} } as Chart],
    layout: { grid: "guidebook-12col", items: [{ chart: "c1", x: 0, y: 0, w: 6, h: 6 }] },
  };
}

describe("reconcileEncoding", () => {
  it("builds a structurally valid encoding for every (prevType -> nextType) pair (F2: real Ajv round-trip, not a no-excess-keys check)", () => {
    for (const prevType of ALL_TYPES) {
      const prevEncoding = reconcileEncoding(undefined, prevType, PREVIEW_COLUMNS);
      for (const nextType of ALL_TYPES) {
        const nextEncoding = reconcileEncoding(prevEncoding, nextType, PREVIEW_COLUMNS);
        const result = parseDashboard(docWithChart(nextType, nextEncoding));
        expect(result.ok, `${prevType} -> ${nextType}: ${!result.ok ? result.reason : ""}`).toBe(
          true,
        );
      }
    }
  });

  it("never carries the previous type's encoding object forward via spread (no leftover fields of a shape nextType doesn't declare)", () => {
    const pieEncoding = reconcileEncoding(undefined, "pie", PREVIEW_COLUMNS);
    const barEncoding = reconcileEncoding(pieEncoding, "bar", PREVIEW_COLUMNS);
    expect(barEncoding).toEqual({ x: PREVIEW_COLUMNS[0], y: PREVIEW_COLUMNS[1] });
    expect(Object.keys(barEncoding).sort()).toEqual(["x", "y"]);
  });

  it("a single-column query reuses that one column for both slots of every type (shape enumeration CS-13)", () => {
    for (const type of ALL_TYPES) {
      const encoding = reconcileEncoding(undefined, type, ["only_col"]);
      const values = Object.values(
        encoding as Record<string, string | string[] | undefined>,
      ).flatMap((v) => (v === undefined ? [] : Array.isArray(v) ? v : [v]));
      expect(
        values.every((v) => v === "only_col"),
        `${type}: ${JSON.stringify(encoding)}`,
      ).toBe(true);
    }
  });

  it("carries over a previously-used column value when it still exists in previewColumns", () => {
    const lineEncoding = reconcileEncoding(undefined, "line", ["month", "count"]);
    const areaEncoding = reconcileEncoding(lineEncoding, "area", ["month", "count"]);
    expect(areaEncoding).toEqual({ x: "month", y: "count" });
  });

  it("drops a carried-over column that no longer exists in the current previewColumns", () => {
    const barEncoding = reconcileEncoding(undefined, "bar", ["old_col", "old_measure"]);
    const pieEncoding = reconcileEncoding(barEncoding, "pie", ["new_col", "new_measure"]);
    expect(pieEncoding).toEqual({ category: "new_col", value: "new_measure" });
  });

  it("handles __proto__ / constructor column names as ordinary string values (prototype pollution discipline)", () => {
    const cols = ["__proto__", "constructor"];
    const encoding = reconcileEncoding(undefined, "pie", cols);
    expect(encoding).toEqual({ category: "__proto__", value: "constructor" });
    const result = parseDashboard(docWithChart("pie", encoding));
    expect(result.ok).toBe(true);
  });

  it("scatter drops a carried-over size column when it no longer exists", () => {
    const scatterEncoding = reconcileEncoding({ x: "a", y: "b", size: "c" }, "scatter", ["a", "b"]);
    expect(scatterEncoding).toEqual({ x: "a", y: "b", size: undefined });
  });

  it("table's columns encoding lists every previewColumns entry", () => {
    const tableEncoding = reconcileEncoding(undefined, "table", ["a", "b", "c"]);
    expect(tableEncoding).toEqual({ columns: ["a", "b", "c"] });
  });

  // Codex Round 1 P1: a caller invoking this with zero columns (e.g. an
  // existing chart card after its query errors and previewColumns clears
  // to []) must never silently produce a `Chart` with undefined encoding
  // values -- fail loud instead.
  it("throws when previewColumns is empty, for every chart type", () => {
    for (const type of ALL_TYPES) {
      expect(() => reconcileEncoding(undefined, type, [])).toThrow(RangeError);
    }
  });

  // Code review (Angle Altitude): reconcileEncoding must self-filter via
  // usableColumns at its own entry point, not merely document that callers
  // are expected to -- otherwise a caller that checks raw `.length > 0` but
  // forgets the filter (as one of this PR's own call sites originally did)
  // can pass an all-empty-string array straight through.
  it("throws when previewColumns contains only empty-string entries (self-filters via usableColumns)", () => {
    for (const type of ALL_TYPES) {
      expect(() => reconcileEncoding(undefined, type, ["", ""])).toThrow(RangeError);
    }
  });

  it("filters out an empty-string entry before picking smart defaults", () => {
    expect(reconcileEncoding(undefined, "pie", ["", "category", "value"])).toEqual({
      category: "category",
      value: "value",
    });
  });
});

describe("usableColumns", () => {
  it("filters out empty-string column names", () => {
    expect(usableColumns(["a", "", "b"])).toEqual(["a", "b"]);
  });

  it("returns the input unchanged when every column name is non-empty", () => {
    expect(usableColumns(["a", "b"])).toEqual(["a", "b"]);
  });

  it("returns an empty array when every column name is empty", () => {
    expect(usableColumns(["", ""])).toEqual([]);
  });
});

describe("reconcileChartOptions", () => {
  it("clears donut when switching away from pie", () => {
    expect(reconcileChartOptions({ donut: true, title: "t" }, "bar")).toEqual({ title: "t" });
  });

  it("keeps donut when staying on pie", () => {
    expect(reconcileChartOptions({ donut: true }, "pie")).toEqual({ donut: true });
  });

  it("is a no-op when donut was never set", () => {
    const options = { title: "t" };
    expect(reconcileChartOptions(options, "bar")).toBe(options);
  });
});

describe("chart type tile mapping", () => {
  it("round-trips every tile through tileToVariant/variantToTile", () => {
    for (const tile of [
      "bar",
      "line",
      "area",
      "scatter",
      "pie",
      "donut",
      "table",
      "stat",
    ] as const) {
      const { type, donut } = tileToVariant(tile);
      expect(variantToTile({ type, options: donut ? { donut: true } : {} })).toBe(tile);
    }
  });
});

describe("appendLimit", () => {
  it("appends a numeric LIMIT clause", () => {
    expect(appendLimit("SELECT * FROM t", CHART_ROW_LIMIT)).toBe(
      `SELECT * FROM t LIMIT ${CHART_ROW_LIMIT}`,
    );
  });

  it("CHART_ROW_LIMIT is a positive integer", () => {
    expect(Number.isInteger(CHART_ROW_LIMIT)).toBe(true);
    expect(CHART_ROW_LIMIT).toBeGreaterThan(0);
  });

  it.each([-1, 0, 1.5, NaN, Infinity])("rejects a non-positive-integer limit (%s)", (limit) => {
    expect(() => appendLimit("SELECT * FROM t", limit)).toThrow(RangeError);
  });
});

// QA Phase 8, V-008 Minor finding: the truncation boundary had no test at
// all (matching the fact that the advisory itself didn't exist yet).
describe("isTruncated", () => {
  it("is false one row short of the limit", () => {
    expect(isTruncated(CHART_ROW_LIMIT - 1)).toBe(false);
  });

  it("is true exactly at the limit (appendLimit guarantees rows.length never exceeds it)", () => {
    expect(isTruncated(CHART_ROW_LIMIT)).toBe(true);
  });

  it("is true for a count above the limit too (defensive, not reachable via the real fetch path)", () => {
    expect(isTruncated(CHART_ROW_LIMIT + 1)).toBe(true);
  });

  it("is false for zero rows", () => {
    expect(isTruncated(0)).toBe(false);
  });
});

describe("detectNumericMismatch", () => {
  const barChart: Chart = {
    id: "c1",
    type: "bar",
    encoding: { x: "cat", y: "amount" },
    options: {},
  };

  it("returns empty with no rows (nothing to judge yet)", () => {
    expect(detectNumericMismatch(barChart.type, barChart.encoding, [])).toEqual([]);
  });

  it("flags y when every row's y value is non-numeric text", () => {
    const rows = [
      { cat: "A", amount: "not a number" },
      { cat: "B", amount: "also not a number" },
    ];
    expect(detectNumericMismatch(barChart.type, barChart.encoding, rows)).toEqual(["y"]);
  });

  it("does not flag y when at least one row has a real numeric value", () => {
    const rows = [
      { cat: "A", amount: "oops" },
      { cat: "B", amount: 42 },
    ];
    expect(detectNumericMismatch(barChart.type, barChart.encoding, rows)).toEqual([]);
  });

  it("treats null/NaN/Infinity consistently as non-numeric", () => {
    const rows = [{ cat: "A", amount: null }];
    expect(detectNumericMismatch(barChart.type, barChart.encoding, rows)).toEqual(["y"]);
  });

  // Code review (Angle A): a column entirely ABSENT from every row's own
  // keys (e.g. a measure an elsewhere-made override change silently
  // excluded, ADR-0013 RR-6) must NOT be flagged as a type mismatch -- the
  // renderer's own missing-column tile already reports that case
  // accurately, and "could not be recognized as numeric" would be a
  // second, actively wrong message for a column that isn't non-numeric, it
  // simply doesn't exist.
  it("does not flag y when the column is entirely absent from every row (missing-column, not non-numeric)", () => {
    const rows = [{ cat: "A" }, { cat: "B" }]; // no "amount" key at all
    expect(detectNumericMismatch(barChart.type, barChart.encoding, rows)).toEqual([]);
  });

  it("scatter checks x, y, AND size independently -- not just y", () => {
    const scatterChart: Chart = {
      id: "c2",
      type: "scatter",
      encoding: { x: "bad_x", y: "good_y", size: "bad_size" },
      options: {},
    };
    const rows = [{ bad_x: "text", good_y: 1, bad_size: "text" }];
    expect(detectNumericMismatch(scatterChart.type, scatterChart.encoding, rows).sort()).toEqual([
      "size",
      "x",
    ]);
  });

  it("stat is never flagged, even with an all-text value column (buildStatElement renders it as plain text, not numeric)", () => {
    const statChart: Chart = { id: "c3", type: "stat", encoding: { value: "label" }, options: {} };
    const rows = [{ label: "定性的な値" }];
    expect(detectNumericMismatch(statChart.type, statChart.encoding, rows)).toEqual([]);
  });

  it("table is never flagged (columns[] is not a numeric-consuming channel)", () => {
    const tableChart: Chart = {
      id: "c4",
      type: "table",
      encoding: { columns: ["a"] },
      options: {},
    };
    expect(detectNumericMismatch(tableChart.type, tableChart.encoding, [{ a: "text" }])).toEqual(
      [],
    );
  });
});
