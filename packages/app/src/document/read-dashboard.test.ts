import { describe, expect, it } from "vitest";
import { readDashboardText, DashboardReadError } from "./read-dashboard.js";

const MINIMAL = {
  version: 1,
  meta: { title: "開いたダッシュボード" },
  theme: { tokens: "@digital-go-jp/design-tokens@2.0.1", palette: "guidebook-blue" },
  sources: [],
  queries: [],
  charts: [],
  layout: { grid: "guidebook-12col", items: [] },
};

describe("readDashboardText", () => {
  it("parses a valid dashboard document", () => {
    expect(readDashboardText(JSON.stringify(MINIMAL))).toEqual(MINIMAL);
  });

  it("rejects malformed JSON with a user-safe error", () => {
    expect(() => readDashboardText("{not-json")).toThrow(DashboardReadError);
    expect(() => readDashboardText("{not-json")).toThrow("ダッシュボードファイルを読み込めませんでした");
  });

  it("rejects schema-invalid or dangling-reference documents", () => {
    expect(() =>
      readDashboardText(JSON.stringify({ ...MINIMAL, meta: { title: "" } })),
    ).toThrow(DashboardReadError);
    expect(() =>
      readDashboardText(
        JSON.stringify({
          ...MINIMAL,
          sources: [{ id: "s1", kind: "file", format: "csv", ref: { name: "a.csv" } }],
          queries: [{ id: "q1", source: "missing", sql: "SELECT 1" }],
        }),
      ),
    ).toThrow("参照関係が壊れています");
  });
});
