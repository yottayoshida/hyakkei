// The gallery's samples are published dashboards, not test data: three people
// can open them from GitHub Pages and check the numbers against e-Stat. That
// makes them subject to the same authoring -> bake -> baked round trip the
// golden fixtures get (`../golden-fixtures/golden-samples.roundtrip.test.ts`),
// plus the guards that are specific to being a PUBLIC EXAMPLE rather than a
// rendering pin.
//
// Those extra guards exist because of what shipped on 2026-08-09: the e-Stat
// snapshots landed in fixtures whose chart types had been chosen for coverage,
// and every layer stayed green. Schema validation passes on a pie summing
// percentages and 万円. The reference lint passes. `bake()` passes. The pixel
// goldens only compare against the previous version of themselves. The one
// guideline rule with a runtime predicate fires at >6 slices, and that pie had
// four. Nothing in the repository was positioned to see it.
import { describe, expect, it } from "vitest";
import {
  formatParseFailure,
  parseBakedDashboard,
  parseDashboard,
  validateBakedDashboardReferences,
  validateDashboardReferences,
} from "@hyakkei/schema";
import { bake } from "../bake/bake.js";
import { lookupRows } from "../renderer/render-model.js";
import { evaluateGuidelines, getGuidelineRules } from "../guideline/rules.js";
import { GALLERY_BAKE_META, GALLERY_SAMPLES } from "./gallery-samples.js";

/** Same name-only lint as the golden fixtures': first `FROM <table>`, no parser. */
const FROM_TABLE = /\bFROM\s+([A-Za-z_][A-Za-z0-9_]*)\b/i;

/**
 * Chart types the gallery is allowed to publish, and the reason each of the
 * other four is absent. This is an allowlist rather than a lint because no
 * check can tell "this line chart shows a trend" from "this line chart joins
 * 男性 to 女性" -- only a person looking at the data can. Widening it is
 * therefore meant to be a deliberate edit with the data in hand:
 *
 *   line, area   -- need an ordered axis. Every snapshot here is a single
 *                   survey year across regions, so an x axis of prefectures
 *                   would draw a progression that does not exist.
 *   pie          -- needs parts of one whole in one unit.
 *   scatter      -- its encoding is x/y/size with no label channel, so with
 *                   five named regions a reader cannot tell which point is
 *                   which, and the accessible fallback table (encoding columns
 *                   only) does not recover the names either.
 */
const PUBLISHABLE_CHART_TYPES = new Set(["bar", "stat", "table"]);

/**
 * Values that are a total over the whole country rather than one region. A bar
 * or pie mixing 全国 with individual prefectures puts a sum and its parts on
 * one axis: 全国's 11194 against 沖縄県's 104 flattened every other bar to
 * invisibility in the version this replaces. Tables are exempt -- a row
 * labelled 全国 beside regional rows reads correctly.
 */
const AGGREGATE_LABELS = ["全国"];

describe("gallery samples", () => {
  it("publishes exactly the three canonical samples", () => {
    expect(GALLERY_SAMPLES.map((s) => s.id)).toEqual(["population", "economy", "administration"]);
  });

  it("gives every sample a distinct title", () => {
    const titles = GALLERY_SAMPLES.map((s) => s.doc.meta.title);
    expect(new Set(titles).size).toBe(titles.length);
  });
});

describe.each(GALLERY_SAMPLES)("gallery sample '$id'", (sample) => {
  it("re-validates in authoring form", () => {
    const result = parseDashboard(sample.doc);
    expect(result.ok || formatParseFailure(result)).toBe(true);
  });

  it("has zero authoring reference issues", () => {
    expect(validateDashboardReferences(sample.doc)).toEqual([]);
  });

  it("every query's SQL FROM table matches that query's own declared source", () => {
    for (const query of sample.doc.queries) {
      const match = FROM_TABLE.exec(query.sql);
      expect(match?.[1], `query '${query.id}' has a FROM table`).toBeDefined();
      expect(match![1], `query '${query.id}' FROM target`).toBe(query.source);
    }
  });

  it("declares only file-kind sources that name their e-Stat table and year", () => {
    expect(sample.doc.sources.length).toBeGreaterThan(0);
    for (const source of sample.doc.sources) {
      expect(source.kind).toBe("file");
      const ref = source.ref as Record<string, unknown>;
      expect(ref.tableId, `${source.id} tableId`).toMatch(/^\d{10}$/);
      expect(ref.surveyYear, `${source.id} surveyYear`).toMatch(/^\d{4}年度?$/);
    }
  });

  it("bakes into a schema-valid BakedDashboard with zero reference issues", () => {
    const baked = bake(sample.doc, sample.rowsByQuery, GALLERY_BAKE_META);
    const result = parseBakedDashboard(baked);
    expect(result.ok || formatParseFailure(result)).toBe(true);
    expect(validateBakedDashboardReferences(baked)).toEqual([]);
  });

  it("every chart is configured and produces non-empty rows", () => {
    expect(sample.doc.charts.length).toBeGreaterThan(0);
    for (const chart of sample.doc.charts) {
      expect(chart.query, `chart '${chart.id}' has a query`).toBeTruthy();
      expect(lookupRows(sample.rowsByQuery, chart.query!).length).toBeGreaterThan(0);
    }
  });

  it("every chart carries substantive alternative text", () => {
    for (const chart of sample.doc.charts) {
      expect((chart.altText ?? "").trim().length, `chart '${chart.id}' altText`).toBeGreaterThan(
        20,
      );
    }
  });

  it("uses only chart types this data supports", () => {
    for (const chart of sample.doc.charts) {
      expect(
        PUBLISHABLE_CHART_TYPES.has(chart.type),
        `chart '${chart.id}' is a ${chart.type}; see PUBLISHABLE_CHART_TYPES for why the gallery does not publish it`,
      ).toBe(true);
    }
  });

  it("never puts a national total on the same axis as individual regions", () => {
    for (const chart of sample.doc.charts) {
      if (chart.type === "table" || chart.type === "stat") continue;
      const categoryColumn =
        chart.type === "pie" ? chart.encoding.category : (chart.encoding as { x: string }).x;
      const rows = lookupRows(sample.rowsByQuery, chart.query!);
      const labels = rows.map((row) => String(row[categoryColumn] ?? ""));
      for (const aggregate of AGGREGATE_LABELS) {
        expect(labels, `chart '${chart.id}' category axis`).not.toContain(aggregate);
      }
    }
  });

  it("shows one consistent number of decimal places per table column", () => {
    // A JSON number cannot hold a trailing zero. e-Stat publishes 耕地面積比率
    // as 15.0 beside 13.7, and 財政力指数 as 0.500 beside 0.448; read through
    // JSON those arrive as 15 and 0.5, so one column shows two precisions and
    // misstates how exactly each figure is known. Columns whose indicator has
    // decimals therefore keep the published text verbatim.
    //
    // Numbers and strings are measured with the same ruler on purpose. The
    // first version of this guard filtered to strings and paired with a
    // separate "decimals must not be JSON numbers" assertion -- and a single
    // value slipping back to `15.0` in the JSON survived both, because JSON
    // parses it to the integer 15 (so the integer assertion held) and the
    // string filter then dropped it before the columns were compared (so the
    // remaining values looked uniform). Falsifying the guard is what found
    // that; keep the two cases in one pass.
    for (const chart of sample.doc.charts) {
      if (chart.type !== "table") continue;
      const rows = lookupRows(sample.rowsByQuery, chart.query!);
      for (const column of chart.encoding.columns) {
        const decimals = new Set(
          rows
            .map((row) => row[column])
            .filter((value) => typeof value === "number" || typeof value === "string")
            .map((value) => String(value))
            .filter((value) => /^-?\d+(?:\.\d+)?$/.test(value))
            .map((value) => value.split(".")[1]?.length ?? 0),
        );
        expect(
          decimals.size,
          `table '${chart.id}' column '${column}' mixes ${[...decimals].sort().join("/")} decimal places`,
        ).toBeLessThanOrEqual(1);
      }
    }
  });

  it("produces 0 guideline nudges on every chart", () => {
    // PRD §7 acceptance ("100% of nudge rules pass on all gallery templates").
    // Pinned alongside the active-rule count so an empty rule set cannot make
    // this vacuously true -- the same guard `guideline.acceptance.test.ts` uses.
    expect(
      getGuidelineRules()
        .filter((r) => r.status === "active")
        .map((r) => r.id),
    ).toEqual(["pie-too-many-slices"]);
    for (const chart of sample.doc.charts) {
      const rows = chart.query ? lookupRows(sample.rowsByQuery, chart.query) : [];
      expect(evaluateGuidelines(chart.type, rows), `chart '${chart.id}'`).toEqual([]);
    }
  });
});
