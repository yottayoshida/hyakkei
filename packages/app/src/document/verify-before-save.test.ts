import type { Dashboard } from "@hyakkei/schema";
import { describe, expect, it } from "vitest";
import { verifyBeforeSave } from "./verify-before-save.js";

function baseDoc(): Dashboard {
  return {
    version: 1,
    meta: { title: "月次KPI" },
    theme: { tokens: "@digital-go-jp/design-tokens@2.0.1", palette: "guidebook-blue" },
    sources: [{ id: "s1", kind: "file", format: "csv", ref: { name: "a.csv" } }],
    queries: [{ id: "q1", source: "s1", sql: "SELECT 1" }],
    charts: [{ id: "c1", type: "bar", query: "q1", encoding: { x: "a", y: "b" }, options: {} }],
    layout: { grid: "guidebook-12col", items: [{ chart: "c1", x: 0, y: 0, w: 6, h: 4 }] },
  };
}

describe("verifyBeforeSave", () => {
  it("returns null (passes) for a valid document", () => {
    expect(verifyBeforeSave(baseDoc())).toBeNull();
  });

  it("returns a schema failure when meta.title is empty (Query.sql/BaseMeta.title are NonEmptyString)", () => {
    const doc = { ...baseDoc(), meta: { title: "" } };
    const result = verifyBeforeSave(doc);
    expect(result?.kind).toBe("schema");
  });

  // issue #15/F7, Phase 6.5 audit (V-020): a dangling chart reference is
  // structurally undetectable by schema validation alone (validate.ts's
  // own doc comment) -- this is exactly the class validateDashboardReferences
  // exists for.
  it("returns a references failure (fatal: dangling) when a query references a nonexistent source", () => {
    const doc = baseDoc();
    doc.queries = [{ id: "q1", source: "nonexistent", sql: "SELECT 1" }];
    const result = verifyBeforeSave(doc);
    expect(result).toEqual({
      kind: "references",
      issues: [
        {
          kind: "dangling",
          message: "query 'q1' references unknown source 'nonexistent'",
        },
      ],
    });
  });

  it("returns a references failure (fatal: out-of-bounds) when a layout item exceeds the grid width", () => {
    const doc = baseDoc();
    doc.layout = { grid: "guidebook-12col", items: [{ chart: "c1", x: 10, y: 0, w: 6, h: 4 }] };
    const result = verifyBeforeSave(doc);
    expect(result?.kind).toBe("references");
    if (result?.kind === "references") {
      expect(result.issues.some((i) => i.kind === "out-of-bounds")).toBe(true);
    }
  });

  // shape enumeration A8: reserved-word / duplicate must NOT be fatal --
  // the editor has no code path that produces either, and today's editor
  // has no way for the user to fix it before re-saving (blocking here
  // would strand a user on a valid-enough document).
  it("does not fail on a reserved-word source id (advisory only, not fatal)", () => {
    const doc = baseDoc();
    doc.sources = [{ id: "select", kind: "file", format: "csv", ref: { name: "a.csv" } }];
    doc.queries = [{ id: "q1", source: "select", sql: "SELECT 1" }];
    expect(verifyBeforeSave(doc)).toBeNull();
  });

  it("does not fail on overlapping layout items (advisory only, not fatal)", () => {
    const doc = baseDoc();
    doc.charts = [
      ...doc.charts,
      { id: "c2", type: "bar", query: "q1", encoding: { x: "a", y: "b" }, options: {} },
    ];
    doc.layout = {
      grid: "guidebook-12col",
      items: [
        { chart: "c1", x: 0, y: 0, w: 6, h: 4 },
        { chart: "c2", x: 0, y: 0, w: 6, h: 4 },
      ],
    };
    expect(verifyBeforeSave(doc)).toBeNull();
  });
});
