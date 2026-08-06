import type { Dashboard } from "@hyakkei/schema";
import { parseBakedDashboard } from "@hyakkei/schema";
import { describe, expect, it } from "vitest";
import { bake, type BakeMeta } from "./bake.js";

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

  it("copies Chart.altText into BakedChart without moving it into options", () => {
    const document: Dashboard = {
      ...doc,
      charts: doc.charts.map((chart) =>
        chart.id === "c1" ? { ...chart, altText: "月別件数の推移です。" } : chart,
      ),
    };
    const result = bake(document, resolvedRows, meta);
    expect(result.charts[0]?.altText).toBe("月別件数の推移です。");
    expect(result.charts[0]?.options).not.toHaveProperty("altText");
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
      guidebookVersion: "v02",
    });
  });

  it("stamps the current guidebook version and ignores an author-forged value", () => {
    expect(bake(doc, resolvedRows, meta).meta.guidebookVersion).toBe("v02");
    const forged = {
      ...doc,
      meta: { ...doc.meta, guidebookVersion: "forged" },
    } as Dashboard;
    expect(bake(forged, resolvedRows, meta).meta.guidebookVersion).toBe("v02");
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

  it("issue #56: a configured chart sharing an id with an unconfigured one survives, with its layout item", () => {
    // Duplicate ids are schema-parseable (validate* is advisory) — an
    // id-keyed skip set used to drop BOTH charts and the layout item,
    // silently emptying the baked artifact where the editor showed a tile.
    const docWithDuplicateId: Dashboard = {
      ...doc,
      charts: [
        {
          id: "kpi",
          type: "bar",
          encoding: { x: "category", y: "total" },
          query: "q1",
          options: {},
        },
        { id: "kpi", type: "bar", encoding: { x: "category", y: "total" }, options: {} },
      ],
      layout: { grid: "guidebook-12col", items: [{ chart: "kpi", x: 0, y: 0, w: 6, h: 4 }] },
    };
    const baked = bake(docWithDuplicateId, resolvedRows, meta);
    expect(baked.charts.map((c) => c.id)).toEqual(["kpi"]);
    expect(baked.charts[0]?.rows).toEqual([{ category: "A", total: 120 }]);
    expect(baked.layout.items.map((i) => i.chart)).toEqual(["kpi"]);
  });

  it("issue #66: post-bake mutation of resolvedRows does not rewrite the baked snapshot", () => {
    // A BakedDashboard is pinned to meta.sourceDataAsOf; the M2 editor
    // re-running queries into the same resolvedRows entry must not
    // retroactively change an already-baked artifact.
    const liveRows = { q1: [{ category: "A", total: 120 }] };
    const baked = bake(doc, liveRows, meta);
    liveRows.q1.push({ category: "B", total: 999 }); // array mutation
    liveRows.q1[0]!.total = -1; // row-object mutation
    expect(baked.charts[0]?.rows).toEqual([{ category: "A", total: 120 }]);
  });
});

// issue #124. The footer labels `generatedAt`/`sourceDataAsOf`/`hyakkeiVersion`
// as *recorded* and the author's own fields as *declared*, and the entire
// weight of that distinction rests on one spread in `bake()`. Until now it
// rested on a doc comment: flipping the merge order so the document wins
// passed all 660 tests, because the fixture's meta shares no keys with the
// bake meta and carries none of the new fields.
describe("bake() meta merge (issue #124: what makes `recorded` mean anything)", () => {
  it("keeps guidebookVersion out of caller-controlled BakeMeta", () => {
    const invalidBakeMeta: BakeMeta = {
      generatedAt: meta.generatedAt,
      sourceDataAsOf: meta.sourceDataAsOf,
      hyakkeiVersion: meta.hyakkeiVersion,
      // @ts-expect-error guidebookVersion is stamped from GUIDEBOOK_SOURCE, not selected by callers.
      guidebookVersion: "forged",
    };
    void invalidBakeMeta;
  });

  it("overrides a document that hand-writes the bake-only stamps", () => {
    // `BaseMeta` is additive-open, so a hand-written dashboard.json may carry
    // these keys with any value at all. They must not survive the bake.
    const forging = {
      ...doc,
      meta: {
        ...doc.meta,
        generatedAt: "1999-01-01T00:00:00Z",
        sourceDataAsOf: "1999-01-01",
        hyakkeiVersion: "9.9.9",
      },
    } as Dashboard;
    expect(bake(forging, resolvedRows, meta).meta).toMatchObject(meta);
  });

  it("V-108: carries the author's guidebook fields through untouched", () => {
    // The other half: the three the author DOES own must survive, or the
    // footer's `declared` half is empty for every artifact.
    const withDoSide = {
      ...doc,
      meta: { ...doc.meta, updatedAt: "2026-06-30", sourceNote: "統計局", summary: "要約" },
    };
    expect(bake(withDoSide, resolvedRows, meta).meta).toMatchObject({
      updatedAt: "2026-06-30",
      sourceNote: "統計局",
      summary: "要約",
    });
  });
});
