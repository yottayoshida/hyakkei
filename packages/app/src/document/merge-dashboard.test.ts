import { describe, expect, it } from "vitest";
import type { IntakeSample } from "../intake/types.js";
import { mergeDashboardSource } from "./merge-dashboard.js";

function source(id: string, name: string): IntakeSample {
  return {
    table: { id, rowCount: 1, columns: [{ name: "value", type: "VARCHAR", category: "text" }] },
    rows: [{ value: name }],
    spec: { id, kind: "file", format: "csv", ref: { name } },
  };
}

describe("mergeDashboardSource", () => {
  it("replaces a disconnected source atomically while preserving its id", () => {
    const disconnected = {
      sourceLabel: "sales.csv",
      sample: source("s1", "sales.csv"),
      typeOverrides: [{ column: "value", category: "number" as const }],
      validation: new Map(),
      previewRows: null,
      previewPending: false,
      disconnected: true,
    };
    const merged = mergeDashboardSource([disconnected], "sales.csv", source("s1", "sales.csv"));
    expect(merged).toHaveLength(1);
    expect(merged[0]?.disconnected).toBe(false);
    expect(merged[0]?.sample.rows).toEqual([{ value: "sales.csv" }]);
    expect(merged[0]?.typeOverrides).toEqual(disconnected.typeOverrides);
  });

  it("keeps a same-label live registration beside a placeholder until App migrates FKs", () => {
    const disconnected = {
      sourceLabel: "sales.csv",
      sample: source("s1", "sales.csv"),
      typeOverrides: [],
      validation: new Map(),
      previewRows: null,
      previewPending: false,
      disconnected: true,
    };
    const merged = mergeDashboardSource([disconnected], "sales.csv", source("s2", "sales.csv"));
    expect(merged.map((entry) => entry.sample.table.id)).toEqual(["s1", "s2"]);
    expect(merged[0]?.disconnected).toBe(true);
  });
});
