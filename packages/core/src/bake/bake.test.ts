import type { Dashboard } from "@hyakkei/schema";
import { parseBakedDashboard } from "@hyakkei/schema";
import { describe, expect, it } from "vitest";
import { bake } from "./bake.js";

const meta = {
  generatedAt: "2026-07-11T00:00:00Z",
  sourceDataAsOf: "2026-07-10",
  hyakkeiVersion: "0.1.0",
};

const doc: Dashboard = {
  version: 1,
  meta: { title: "月次KPI", description: "説明", locale: "ja-JP" },
  theme: { tokens: "@digital-go-jp/design-tokens@2.0.1", palette: "guidebook-blue" },
  sources: [{ id: "apps", kind: "file", format: "csv", ref: { name: "apps.csv" } }],
  queries: [{ id: "q1", source: "apps", sql: "SELECT category, total FROM apps" }],
  charts: [
    { id: "c1", type: "bar", encoding: { x: "category", y: "total" }, query: "q1", options: {} },
    { id: "c2", type: "bar", encoding: { x: "category", y: "total" }, options: {} }, // query未設定
  ],
  layout: {
    grid: "guidebook-12col",
    items: [
      { chart: "c1", x: 0, y: 0, w: 6, h: 4 },
      { chart: "c2", x: 6, y: 0, w: 6, h: 4 },
    ],
  },
};

const resolvedRows = { q1: [{ category: "A", total: 120 }] };

describe("bake()", () => {
  it("produces schema-valid BakedDashboard (ADR-0005 round-trip)", () => {
    const baked = bake(doc, resolvedRows, meta);
    const result = parseBakedDashboard(baked);
    expect(result.ok, JSON.stringify(!result.ok && result.errors)).toBe(true);
  });

  it("never carries sources/queries or a chart-level query/sql field", () => {
    const baked = bake(doc, resolvedRows, meta) as unknown as Record<string, unknown>;
    expect("sources" in baked).toBe(false);
    expect("queries" in baked).toBe(false);
    for (const chart of baked.charts as Record<string, unknown>[]) {
      expect("query" in chart).toBe(false);
      expect("sql" in chart).toBe(false);
    }
  });

  it("skips a query-未設定 chart and its layout item (Mirror handoff delta resolution)", () => {
    const baked = bake(doc, resolvedRows, meta);
    expect(baked.charts.map((c) => c.id)).toEqual(["c1"]);
    expect(baked.layout.items.map((i) => i.chart)).toEqual(["c1"]);
  });

  it("inlines resolved rows and drops the query reference for surviving charts", () => {
    const baked = bake(doc, resolvedRows, meta);
    expect(baked.charts[0]?.rows).toEqual([{ category: "A", total: 120 }]);
  });

  it("merges document meta with caller-supplied bake-time fields", () => {
    const baked = bake(doc, resolvedRows, meta);
    expect(baked.meta).toEqual({
      title: "月次KPI",
      description: "説明",
      locale: "ja-JP",
      generatedAt: meta.generatedAt,
      sourceDataAsOf: meta.sourceDataAsOf,
      hyakkeiVersion: meta.hyakkeiVersion,
    });
  });

  it("is pure: identical inputs produce deep-equal output on repeated calls", () => {
    expect(bake(doc, resolvedRows, meta)).toEqual(bake(doc, resolvedRows, meta));
  });

  it("Codex R1 P2: a layout item that was ALREADY dangling before baking survives bake() unchanged", () => {
    const docWithPreexistingDangling: Dashboard = {
      ...doc,
      layout: {
        grid: "guidebook-12col",
        items: [
          { chart: "c1", x: 0, y: 0, w: 6, h: 4 },
          { chart: "ghost", x: 6, y: 0, w: 6, h: 4 }, // never in charts[] at all
        ],
      },
    };
    const baked = bake(docWithPreexistingDangling, resolvedRows, meta);
    // c2 (query-未設定, skipped by bake()) is absent; "ghost" (pre-existing
    // dangling, unrelated to bake()'s own skip decision) is preserved --
    // the viewer sees the same dangling-reference error tile the editor
    // would, rather than bake() silently erasing evidence of it.
    expect(baked.layout.items.map((i) => i.chart)).toEqual(["c1", "ghost"]);
  });

  it("a query id absent from resolvedRows bakes to empty rows, not a thrown error", () => {
    const docWithUnresolved: Dashboard = {
      ...doc,
      charts: [
        {
          id: "c3",
          type: "bar",
          encoding: { x: "category", y: "total" },
          query: "q-missing",
          options: {},
        },
      ],
      layout: { grid: "guidebook-12col", items: [{ chart: "c3", x: 0, y: 0, w: 6, h: 4 }] },
    };
    const baked = bake(docWithUnresolved, resolvedRows, meta);
    expect(baked.charts[0]?.rows).toEqual([]);
  });

  it("Security Review Phase 8 M2: a query id of '__proto__' or 'toString' bakes to empty rows, not Object.prototype itself", () => {
    // `Chart.query` is a schema-unrestricted NonEmptyString (dashboard.ts,
    // deliberately "opaque") -- these are reachable authoring values, not a
    // hypothetical attack. A plain `resolvedRows[query] ?? []` resolves
    // `Object.prototype`/`Object.prototype.toString` for these keys (both
    // are truthy, so `?? []` never fires), which would then be iterated as
    // if it were a rows array downstream and crash rendering.
    for (const query of ["__proto__", "toString", "constructor"]) {
      const docWithPrototypeQuery: Dashboard = {
        ...doc,
        charts: [
          { id: "c4", type: "bar", encoding: { x: "category", y: "total" }, query, options: {} },
        ],
        layout: { grid: "guidebook-12col", items: [{ chart: "c4", x: 0, y: 0, w: 6, h: 4 }] },
      };
      const baked = bake(docWithPrototypeQuery, resolvedRows, meta);
      expect(baked.charts[0]?.rows, query).toEqual([]);
    }
  });
});
