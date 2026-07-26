import type { Dashboard } from "@hyakkei/schema";
import { describe, expect, it } from "vitest";
import { serializeDashboard } from "./serialize.js";

const DOC: Dashboard = {
  version: 1,
  meta: { title: "月次KPI" },
  theme: { tokens: "@digital-go-jp/design-tokens@2.0.1", palette: "guidebook-blue" },
  sources: [],
  queries: [],
  charts: [],
  layout: { grid: "guidebook-12col", items: [] },
};

describe("serializeDashboard", () => {
  it("indents with 2 spaces (ADR-0002 Git-diffability)", () => {
    expect(serializeDashboard(DOC)).toBe(`${JSON.stringify(DOC, null, 2)}\n`);
  });

  it("ends with exactly one trailing newline", () => {
    const result = serializeDashboard(DOC);
    expect(result.endsWith("\n")).toBe(true);
    expect(result.endsWith("\n\n")).toBe(false);
  });

  it("round-trips through JSON.parse to an equal document", () => {
    expect(JSON.parse(serializeDashboard(DOC))).toEqual(DOC);
  });
});
