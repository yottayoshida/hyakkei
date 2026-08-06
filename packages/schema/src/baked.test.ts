import { describe, expect, it } from "vitest";
import { BakedChart, BakedMeta } from "./baked.js";
import { BaseMeta, MAX_LAYOUT_Y } from "./common.js";
import { parseBakedDashboard, validateBakedDashboardReferences } from "./validate.js";

// Samples B1/B2/B3 from .claude/plans/2026-07-04-hyakkei-v0.1-pr-issue6-shapes.md
const emptyBaked = {
  version: 1,
  meta: {
    title: "無題",
    generatedAt: "2026-07-05T00:00:00Z",
    sourceDataAsOf: "2026-06-30",
    hyakkeiVersion: "0.1.0",
    locale: "ja",
  },
  theme: { tokens: "@digital-go-jp/design-tokens@2.0.1", palette: "guidebook-blue" },
  charts: [],
  layout: { grid: "guidebook-12col", items: [] },
};

const minimalBaked = {
  version: 1,
  meta: {
    title: "月次KPI",
    generatedAt: "2026-07-05T00:00:00Z",
    sourceDataAsOf: "2026-06-30",
    hyakkeiVersion: "0.1.0",
  },
  theme: { tokens: "@digital-go-jp/design-tokens@2.0.1", palette: "guidebook-blue" },
  charts: [
    {
      id: "c1",
      type: "bar",
      encoding: { x: "category", y: "total" },
      options: { title: "区分別申請額" },
      rows: [
        { category: "A", total: 120 },
        { category: "B", total: 90 },
      ],
    },
  ],
  layout: { grid: "guidebook-12col", items: [{ chart: "c1", x: 0, y: 0, w: 6, h: 4 }] },
};

const fullBaked = {
  version: 1,
  meta: {
    title: "横断",
    generatedAt: "2026-07-05T00:00:00Z",
    sourceDataAsOf: "2026-06-30",
    hyakkeiVersion: "0.1.0",
  },
  theme: { tokens: "@digital-go-jp/design-tokens@2.0.1", palette: "guidebook-blue" },
  charts: [
    {
      id: "c1",
      type: "bar",
      encoding: { x: "category", y: "total" },
      options: {},
      rows: [
        { category: "A", total: 120 },
        { category: "B", total: 90 },
      ],
    },
    {
      id: "c3",
      type: "table",
      encoding: { columns: ["dept", "planned", "actual"] },
      options: {},
      // a non-aggregated table chart: the "bake bloat" risk from the plan's
      // risk table — schema itself imposes no row-count cap (M0 finding:
      // size is export's job).
      rows: Array.from({ length: 50 }, (_, i) => ({ dept: `d${i}`, planned: i, actual: i - 1 })),
    },
  ],
  layout: {
    grid: "guidebook-12col",
    items: [
      { chart: "c1", x: 0, y: 0, w: 6, h: 4 },
      { chart: "c3", x: 6, y: 0, w: 6, h: 6 },
    ],
  },
};

describe("BakedDashboard — valid shapes", () => {
  it.each([
    ["B1 empty baked", emptyBaked],
    ["B2 minimal baked", minimalBaked],
    ["B3 full baked (aggregated + non-aggregated table)", fullBaked],
  ])("%s passes schema validation with zero reference issues", (_label, doc) => {
    const result = parseBakedDashboard(doc);
    expect(result.ok).toBe(true);
    if (result.ok) expect(validateBakedDashboardReferences(result.value)).toEqual([]);
  });

  it("accepts chart-level altText without widening the closed options object", () => {
    expect(JSON.stringify(BakedChart)).toContain('"altText"');
    const chartWithAltText = {
      ...minimalBaked.charts[0],
      altText: "地域別の申請件数を比較した棒グラフです。",
    };
    const result = parseBakedDashboard({ ...minimalBaked, charts: [chartWithAltText] });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.charts[0]?.altText).toBe(chartWithAltText.altText);

    expect(
      parseBakedDashboard({
        ...minimalBaked,
        charts: [{ ...chartWithAltText, options: { ...chartWithAltText.options, altText: "x" } }],
      }).ok,
    ).toBe(false);
  });

  it("DB-4: an empty rows array is valid (a genuinely empty query result, baked)", () => {
    const doc = { ...minimalBaked, charts: [{ ...minimalBaked.charts[0], rows: [] }] };
    expect(parseBakedDashboard(doc).ok).toBe(true);
  });

  it("DB-5: mixed JSON-primitive cell types (string/number/boolean/null) are valid", () => {
    const doc = {
      ...minimalBaked,
      charts: [
        { ...minimalBaked.charts[0], rows: [{ category: "A", total: 1, flag: true, note: null }] },
      ],
    };
    expect(parseBakedDashboard(doc).ok).toBe(true);
  });

  it("AB-1: a rows cell containing an XSS-shaped payload validates as inert data, unmodified (schema's job ends at 'is this a JSON primitive')", () => {
    const payload = "<img src=x onerror=alert(1)>";
    const doc = {
      ...minimalBaked,
      charts: [{ ...minimalBaked.charts[0], rows: [{ category: payload, total: 1 }] }],
    };
    const result = parseBakedDashboard(doc);
    expect(result.ok).toBe(true);
    // Schema neither rejects nor mangles it — the string survives byte-for-byte,
    // exactly as ADR-0005/AB-1 says: sanitizing this for safe rendering is the
    // renderer's contract, not the schema's. Pinning this both ways matters:
    // rejecting valid-shaped-but-suspicious text would be the wrong layer for
    // this concern, and silently altering it would hide a real payload from
    // whatever downstream check the renderer is supposed to apply.
    if (result.ok) expect(result.value.charts[0]?.rows[0]?.category).toBe(payload);
  });
});

describe("BakedDashboard — adversarial shapes rejected", () => {
  it("AB-2: chart.options rejects formatter/HTML injection, sharing the authoring allowlist", () => {
    const doc = {
      ...minimalBaked,
      charts: [
        { ...minimalBaked.charts[0], options: { tooltip: { formatter: "<script>1</script>" } } },
      ],
    };
    expect(parseBakedDashboard(doc).ok).toBe(false);
  });

  it("AB-3: theme.tokens/palette reject arbitrary strings, sharing the authoring enum", () => {
    const doc = { ...minimalBaked, theme: { tokens: "evil-package", palette: "guidebook-blue" } };
    expect(parseBakedDashboard(doc).ok).toBe(false);
  });

  it("AB-9: all 7 guidebook key-color Palette values validate on a baked artifact (Theme is shared)", () => {
    const palettes = [
      "guidebook-blue",
      "guidebook-light-blue",
      "guidebook-cyan",
      "guidebook-green",
      "guidebook-orange",
      "guidebook-red",
      "guidebook-neutral",
    ];
    for (const palette of palettes) {
      const result = parseBakedDashboard({
        ...minimalBaked,
        theme: { ...minimalBaked.theme, palette },
      });
      expect(result.ok, `palette '${palette}' should validate`).toBe(true);
    }
  });

  it("AB-10: theme.appearance round-trips onto BakedDashboard (Theme shared with authoring, PR-A)", () => {
    for (const appearance of ["light", "dark"] as const) {
      const result = parseBakedDashboard({
        ...minimalBaked,
        theme: { ...minimalBaked.theme, appearance },
      });
      expect(result.ok, `appearance '${appearance}' should validate`).toBe(true);
      if (result.ok) expect(result.value.theme.appearance).toBe(appearance);
    }

    const withoutAppearance = parseBakedDashboard(minimalBaked);
    expect(withoutAppearance.ok).toBe(true);
    if (withoutAppearance.ok) expect(withoutAppearance.value.theme.appearance).toBeUndefined();

    expect(
      parseBakedDashboard({
        ...minimalBaked,
        theme: { ...minimalBaked.theme, appearance: "sepia" },
      }).ok,
    ).toBe(false);
  });

  it("AB-4: authoring fields (sources/queries) are explicitly forbidden on a baked artifact", () => {
    expect(parseBakedDashboard({ ...minimalBaked, sources: [] }).ok).toBe(false);
    expect(parseBakedDashboard({ ...minimalBaked, queries: [] }).ok).toBe(false);
  });

  it("AB-8: an unknown major version is rejected with a specific, actionable reason", () => {
    const result = parseBakedDashboard({ ...minimalBaked, version: 2 });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/version 2/);
  });

  it("dangling layout->chart reference is flagged by validateBakedDashboardReferences", () => {
    const doc = {
      ...minimalBaked,
      layout: {
        grid: "guidebook-12col",
        items: [{ chart: "does-not-exist", x: 0, y: 0, w: 6, h: 4 }],
      },
    };
    const result = parseBakedDashboard(doc);
    expect(result.ok).toBe(true);
    if (result.ok) {
      const issues = validateBakedDashboardReferences(result.value);
      expect(issues.some((i) => i.kind === "dangling")).toBe(true);
    }
  });

  it("duplicate chart ids are flagged by validateBakedDashboardReferences", () => {
    const doc = { ...fullBaked, charts: [fullBaked.charts[0], { ...fullBaked.charts[0] }] };
    const result = parseBakedDashboard(doc);
    expect(result.ok).toBe(true);
    if (result.ok) {
      const issues = validateBakedDashboardReferences(result.value);
      expect(issues.some((i) => i.kind === "duplicate")).toBe(true);
    }
  });

  it("overlapping layout items are flagged by validateBakedDashboardReferences", () => {
    const doc = {
      ...fullBaked,
      layout: {
        grid: "guidebook-12col",
        items: [
          { chart: "c1", x: 0, y: 0, w: 6, h: 4 },
          { chart: "c3", x: 3, y: 2, w: 6, h: 4 }, // overlaps c1
        ],
      },
    };
    const result = parseBakedDashboard(doc);
    expect(result.ok).toBe(true);
    if (result.ok) {
      const issues = validateBakedDashboardReferences(result.value);
      expect(issues.some((i) => i.kind === "overlap")).toBe(true);
    }
  });

  // Issue #73: on the baked side the data is inline, so "encoding names a
  // column no row carries" is decidable — the exact "passes schema validation
  // but renders blank/NaN" class validateBakedDashboardReferences exists for.
  it("issue #73: an encoding column present in none of the rows is flagged as 'missing-column'", () => {
    const doc = {
      ...minimalBaked,
      charts: [{ ...minimalBaked.charts[0], rows: [{ cat: "A", tot: 1 }] }],
    };
    const result = parseBakedDashboard(doc);
    expect(result.ok).toBe(true);
    if (result.ok) {
      const issues = validateBakedDashboardReferences(result.value);
      // encoding is {x:'category', y:'total'} — both miss
      expect(issues.filter((i) => i.kind === "missing-column")).toHaveLength(2);
      expect(issues.map((i) => i.message).join("\n")).toMatch(/'category'/);
    }
  });

  it("issue #73: empty rows carry no column information and are not flagged", () => {
    const doc = { ...minimalBaked, charts: [{ ...minimalBaked.charts[0], rows: [] }] };
    const result = parseBakedDashboard(doc);
    expect(result.ok).toBe(true);
    if (result.ok) {
      const issues = validateBakedDashboardReferences(result.value);
      expect(issues.some((i) => i.kind === "missing-column")).toBe(false);
    }
  });

  it("issue #73: a column present in only some rows is not flagged (union across rows, sparse data is legal)", () => {
    const doc = {
      ...minimalBaked,
      charts: [
        { ...minimalBaked.charts[0], rows: [{ category: "A" }, { category: "B", total: 90 }] },
      ],
    };
    const result = parseBakedDashboard(doc);
    expect(result.ok).toBe(true);
    if (result.ok) {
      const issues = validateBakedDashboardReferences(result.value);
      expect(issues.some((i) => i.kind === "missing-column")).toBe(false);
    }
  });

  it("issue #73: table 'columns' encoding is checked per column name", () => {
    const doc = {
      ...fullBaked,
      charts: [
        fullBaked.charts[0],
        {
          ...fullBaked.charts[1],
          encoding: { columns: ["dept", "vanished"] },
        },
      ],
    };
    const result = parseBakedDashboard(doc);
    expect(result.ok).toBe(true);
    if (result.ok) {
      const issues = validateBakedDashboardReferences(result.value);
      const missing = issues.filter((i) => i.kind === "missing-column");
      expect(missing).toHaveLength(1);
      expect(missing[0]?.message).toMatch(/'vanished'/);
    }
  });

  // Issue #59: y/h used to be unbounded, and at y=2^53 rectsOverlap's float
  // addition (`2^53 + 1 === 2^53`) let two fully coincident tiles pass
  // overlap detection. The schema maxima make that input unrepresentable...
  it("issue #59: y beyond MAX_LAYOUT_Y (the old float-precision window) fails schema validation", () => {
    const doc = {
      ...minimalBaked,
      layout: {
        grid: "guidebook-12col",
        items: [{ chart: "c1", x: 0, y: 9007199254740992, w: 6, h: 1 }],
      },
    };
    expect(parseBakedDashboard(doc).ok).toBe(false);
    const atLimit = {
      ...minimalBaked,
      layout: {
        grid: "guidebook-12col",
        items: [{ chart: "c1", x: 0, y: MAX_LAYOUT_Y, w: 6, h: 1 }],
      },
    };
    expect(parseBakedDashboard(atLimit).ok).toBe(true);
  });

  // ...and inside the representable range, addition is integer-exact, so the
  // original bug scenario (coincident tiles) is detected even at the ceiling.
  it("issue #59: coincident tiles at the maximum y are flagged as overlap", () => {
    const doc = {
      ...fullBaked,
      layout: {
        grid: "guidebook-12col",
        items: [
          { chart: "c1", x: 0, y: MAX_LAYOUT_Y, w: 6, h: 1 },
          { chart: "c3", x: 0, y: MAX_LAYOUT_Y, w: 6, h: 1 },
        ],
      },
    };
    const result = parseBakedDashboard(doc);
    expect(result.ok).toBe(true);
    if (result.ok) {
      const issues = validateBakedDashboardReferences(result.value);
      expect(issues.some((i) => i.kind === "overlap")).toBe(true);
    }
  });

  it("AB-2 (nested): chart.options.legend rejects unknown keys on baked charts too", () => {
    const doc = {
      ...minimalBaked,
      charts: [{ ...minimalBaked.charts[0], options: { legend: { formatter: "x" } } }],
    };
    expect(parseBakedDashboard(doc).ok).toBe(false);
  });

  it("AB-4 (chart-level): 'query'/'sql' riding along on a baked chart are explicitly forbidden", () => {
    expect(
      parseBakedDashboard({ ...minimalBaked, charts: [{ ...minimalBaked.charts[0], query: "q1" }] })
        .ok,
    ).toBe(false);
    expect(
      parseBakedDashboard({
        ...minimalBaked,
        charts: [{ ...minimalBaked.charts[0], sql: "SELECT 1" }],
      }).ok,
    ).toBe(false);
  });

  it("AB-7: an unanchored-looking hyakkeiVersion with trailing garbage is rejected", () => {
    const doc = {
      ...minimalBaked,
      meta: { ...minimalBaked.meta, hyakkeiVersion: "0.1.0<script>" },
    };
    expect(parseBakedDashboard(doc).ok).toBe(false);
  });

  it("B5: a malformed generatedAt (not date-time) is rejected — pins the ajv-formats wiring, not just hyakkeiVersion", () => {
    const doc = { ...minimalBaked, meta: { ...minimalBaked.meta, generatedAt: "not-a-date" } };
    expect(parseBakedDashboard(doc).ok).toBe(false);
  });

  it("B5: a malformed sourceDataAsOf (not date) is rejected", () => {
    const doc = { ...minimalBaked, meta: { ...minimalBaked.meta, sourceDataAsOf: "2026-13-45" } };
    expect(parseBakedDashboard(doc).ok).toBe(false);
  });

  it("AA-12 (baked): '__proto__' as a property name is rejected", () => {
    const withProto = JSON.parse(`{"__proto__": {"polluted": true}}`);
    expect(parseBakedDashboard({ ...minimalBaked, ...withProto }).ok).toBe(false);
  });

  it("AA-12 (baked meta): '__proto__' nested in meta is rejected (regression: Type.Composite dropped propertyNames)", () => {
    const withProto = JSON.parse(`{"__proto__": {"polluted": true}}`);
    const doc = { ...minimalBaked, meta: { ...minimalBaked.meta, ...withProto } };
    expect(parseBakedDashboard(doc).ok).toBe(false);
  });

  it("AA-12 (baked row key): '__proto__' as a row's own key is rejected (regression: Type.Record had no propertyNames guard)", () => {
    const withProto = JSON.parse(`{"__proto__": "polluted", "category": "A", "total": 1}`);
    const doc = { ...minimalBaked, charts: [{ ...minimalBaked.charts[0], rows: [withProto] }] };
    expect(parseBakedDashboard(doc).ok).toBe(false);
  });

  it("row key containing a newline does not bypass value validation (regression: Type.Record's '^(.*)$' pattern doesn't match line terminators, leaving unmatched keys unconstrained)", () => {
    const doc = {
      ...minimalBaked,
      charts: [
        {
          ...minimalBaked.charts[0],
          rows: [
            {
              "weird\nkey": { nested: { arbitrary: "not-a-json-primitive" } },
              category: "A",
              total: 1,
            },
          ],
        },
      ],
    };
    // A non-primitive value must still be rejected even under a pattern-breaking key —
    // if this were `true`, an object/array could ride through as a "row cell."
    expect(parseBakedDashboard(doc).ok).toBe(false);
  });
});

// issue #124. `BakedMeta` spreads `BASE_META_FIELDS` rather than re-declaring
// the shared fields, so "the two objects agree on the shared block" is true by
// construction and needs no test. An earlier draft hand-copied all six fields
// and guarded them with schema-equality and optionality assertions;
// `/simplify` pointed at the record-sharing idiom already in `common.ts`, and
// removing the duplication removed the need for its detector.
//
// What the spread does NOT decide is the set of keys unique to the baked side.
// That stays pinned: a fourth baked-only field is a real design change — it
// becomes something a viewer can be told that an author cannot state — and it
// should not arrive as a side effect of an unrelated edit.
describe("BakedMeta adds exactly the bake-time stamps", () => {
  it("shares BaseMeta's fields and adds only the four recorded fields", () => {
    const baseKeys = Object.keys(BaseMeta.properties);
    const bakedKeys = Object.keys(BakedMeta.properties);
    expect(bakedKeys).toEqual([
      ...baseKeys,
      "generatedAt",
      "sourceDataAsOf",
      "hyakkeiVersion",
      "guidebookVersion",
    ]);
  });

  it("accepts an optional publisher-labelled guidebook version for old artifact compatibility", () => {
    expect(
      parseBakedDashboard({
        ...minimalBaked,
        meta: { ...minimalBaked.meta, guidebookVersion: "v02" },
      }).ok,
    ).toBe(true);
    expect(
      parseBakedDashboard({
        ...minimalBaked,
        meta: { ...minimalBaked.meta, guidebookVersion: "forged" },
      }).ok,
    ).toBe(false);
  });
});
