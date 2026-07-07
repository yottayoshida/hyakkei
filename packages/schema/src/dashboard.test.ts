import { describe, expect, it } from "vitest";
import { parseDashboard, validateDashboardReferences } from "./validate.js";

// Samples S1/S2/S3 from .claude/plans/2026-07-04-hyakkei-v0.1-pr-issue6-shapes.md
const empty = {
  version: 1,
  meta: { title: "無題のダッシュボード", locale: "ja" },
  theme: { tokens: "@digital-go-jp/design-tokens@2.0.0", palette: "guidebook-blue" },
  sources: [],
  queries: [],
  charts: [],
  layout: { grid: "guidebook-12col", items: [] },
};

const minimal = {
  version: 1,
  meta: { title: "月次KPIダッシュボード", locale: "ja" },
  theme: { tokens: "@digital-go-jp/design-tokens@2.0.0", palette: "guidebook-blue" },
  sources: [
    {
      id: "apps",
      kind: "file",
      format: "xlsx",
      ref: { name: "applications_2026-06.xlsx", sheet: "data" },
    },
  ],
  queries: [
    {
      id: "by_category",
      source: "apps",
      sql: "SELECT category, SUM(amount) AS total FROM apps GROUP BY 1",
    },
  ],
  charts: [
    {
      id: "c1",
      type: "bar",
      query: "by_category",
      encoding: { x: "category", y: "total" },
      options: { title: "区分別申請額" },
    },
  ],
  layout: { grid: "guidebook-12col", items: [{ chart: "c1", x: 0, y: 0, w: 6, h: 4 }] },
};

const full = {
  version: 1,
  meta: { title: "県内自治体横断ダッシュボード", description: "月次+累計", locale: "ja" },
  theme: { tokens: "@digital-go-jp/design-tokens@2.0.0", palette: "guidebook-blue" },
  sources: [
    { id: "apps", kind: "file", format: "xlsx", ref: { name: "apps.xlsx", sheet: "2026" } },
    {
      id: "budget",
      kind: "file",
      format: "csv",
      ref: { name: "budget.csv", encoding: "shift_jis" },
    },
    { id: "open", kind: "url", format: "csv", ref: { url: "https://data.example.lg.jp/x.csv" } },
  ],
  queries: [
    { id: "q_cat", source: "apps", sql: "SELECT category, SUM(amount) total FROM apps GROUP BY 1" },
    {
      id: "q_month",
      source: "apps",
      sql: "SELECT month, COUNT(*) n FROM apps GROUP BY 1 ORDER BY 1",
    },
    { id: "q_bud", source: "budget", sql: "SELECT dept, planned, actual FROM budget" },
  ],
  charts: [
    {
      id: "c1",
      type: "bar",
      query: "q_cat",
      encoding: { x: "category", y: "total" },
      options: { title: "区分別" },
    },
    { id: "c2", type: "line", query: "q_month", encoding: { x: "month", y: "n" }, options: {} },
    {
      id: "c3",
      type: "table",
      query: "q_bud",
      encoding: { columns: ["dept", "planned", "actual"] },
      options: {},
    },
    {
      id: "c4",
      type: "pie",
      query: "q_cat",
      encoding: { category: "category", value: "total" },
      options: {},
    },
  ],
  layout: {
    grid: "guidebook-12col",
    items: [
      { chart: "c1", x: 0, y: 0, w: 6, h: 4 },
      { chart: "c2", x: 6, y: 0, w: 6, h: 4 },
      { chart: "c3", x: 0, y: 4, w: 8, h: 6 },
      { chart: "c4", x: 8, y: 4, w: 4, h: 6 },
    ],
  },
};

describe("dashboard.json — valid shapes", () => {
  it.each([
    ["S1 empty", empty],
    ["S2 minimal", minimal],
    ["S3 full", full],
  ])("%s passes schema validation with zero reference issues", (_label, doc) => {
    const result = parseDashboard(doc);
    expect(result.ok).toBe(true);
    if (result.ok) expect(validateDashboardReferences(result.value)).toEqual([]);
  });

  it("allows a chart with no query bound yet (work-in-progress tile, DA-9)", () => {
    const doc = {
      ...minimal,
      charts: [{ id: "c1", type: "bar", encoding: { x: "a", y: "b" }, options: {} }],
    };
    const result = parseDashboard(doc);
    expect(result.ok).toBe(true);
  });

  it("allows the same query to be referenced by multiple charts (DA-8)", () => {
    const result = parseDashboard(full);
    expect(result.ok).toBe(true);
    if (result.ok) expect(validateDashboardReferences(result.value)).toEqual([]);
  });
});

describe("dashboard.json — adversarial shapes rejected", () => {
  it("AA-1: type mismatches are rejected", () => {
    expect(parseDashboard({ ...minimal, version: "1" }).ok).toBe(false);
    expect(parseDashboard({ ...minimal, sources: {} }).ok).toBe(false);
    expect(parseDashboard({ ...minimal, charts: "x" }).ok).toBe(false);
  });

  it("AA-2: missing required fields are rejected", () => {
    const { theme, ...withoutTheme } = minimal;
    void theme;
    expect(parseDashboard(withoutTheme).ok).toBe(false);
  });

  it("AA-3: theme.tokens/palette reject arbitrary strings (RCE-adjacent enum allowlist)", () => {
    expect(
      parseDashboard({
        ...minimal,
        theme: { tokens: "../../etc/passwd", palette: "guidebook-blue" },
      }).ok,
    ).toBe(false);
    expect(
      parseDashboard({
        ...minimal,
        theme: { tokens: "@digital-go-jp/design-tokens@2.0.0", palette: "evil" },
      }).ok,
    ).toBe(false);
  });

  it("AA-4: chart.options rejects unknown keys (no formatter/HTML passthrough to ECharts)", () => {
    const doc = {
      ...minimal,
      charts: [
        {
          ...minimal.charts[0],
          options: { tooltip: { formatter: "<img src=x onerror=alert(1)>" } },
        },
      ],
    };
    expect(parseDashboard(doc).ok).toBe(false);
  });

  it("AA-5: SQL text is intentionally passed through unexamined (containment is CSP's job, not schema's)", () => {
    const doc = {
      ...minimal,
      queries: [
        {
          id: "by_category",
          source: "apps",
          sql: "INSTALL httpfs; LOAD httpfs; SELECT * FROM 'https://evil/x'",
        },
      ],
    };
    expect(parseDashboard(doc).ok).toBe(true);
  });

  it("AA-6: dangling references are schema-valid but flagged by validateDashboardReferences", () => {
    const doc = { ...minimal, charts: [{ ...minimal.charts[0], query: "does-not-exist" }] };
    const result = parseDashboard(doc);
    expect(result.ok).toBe(true);
    if (result.ok) {
      const issues = validateDashboardReferences(result.value);
      expect(issues.some((i) => i.kind === "dangling")).toBe(true);
    }
  });

  it("AA-7: duplicate ids are flagged by validateDashboardReferences", () => {
    const doc = { ...full, sources: [full.sources[0], { ...full.sources[0] }] };
    const result = parseDashboard(doc);
    expect(result.ok).toBe(true);
    if (result.ok) {
      const issues = validateDashboardReferences(result.value);
      expect(issues.some((i) => i.kind === "duplicate")).toBe(true);
    }
  });

  it("AA-8: overlapping layout items are flagged by validateDashboardReferences", () => {
    const doc = {
      ...minimal,
      charts: [minimal.charts[0], { ...minimal.charts[0], id: "c2" }],
      layout: {
        grid: "guidebook-12col",
        items: [
          { chart: "c1", x: 0, y: 0, w: 6, h: 4 },
          { chart: "c2", x: 3, y: 2, w: 6, h: 4 }, // overlaps c1
        ],
      },
    };
    const result = parseDashboard(doc);
    expect(result.ok).toBe(true);
    if (result.ok) {
      const issues = validateDashboardReferences(result.value);
      expect(issues.some((i) => i.kind === "overlap")).toBe(true);
    }
  });

  it("AA-11: non-https source URLs are rejected (scheme allowlist)", () => {
    const doc = {
      ...full,
      sources: [{ id: "s", kind: "url", format: "csv", ref: { url: "file:///etc/passwd" } }],
    };
    expect(parseDashboard(doc).ok).toBe(false);
  });

  it("AA-13: an unknown major version is rejected with a specific, actionable reason", () => {
    const result = parseDashboard({ ...minimal, version: 2 });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/version 2/);
  });

  it("AA-14: chart type/encoding mismatches are structurally rejected", () => {
    const doc = {
      ...minimal,
      charts: [
        { id: "c1", type: "pie", query: "by_category", encoding: { x: "a", y: "b" }, options: {} },
      ],
    };
    expect(parseDashboard(doc).ok).toBe(false);
  });

  it("DA-6: source.kind 'proxy' is rejected — not part of the v0.1 enum", () => {
    const doc = { ...full, sources: [{ id: "s", kind: "proxy", format: "csv", ref: {} }] };
    expect(parseDashboard(doc).ok).toBe(false);
  });

  it("AA-4 (nested): chart.options.legend rejects unknown keys, not just the top level", () => {
    const doc = {
      ...minimal,
      charts: [{ ...minimal.charts[0], options: { legend: { formatter: "<script>1</script>" } } }],
    };
    expect(parseDashboard(doc).ok).toBe(false);
  });

  it("AA-12: '__proto__'/'constructor'/'prototype' as a property name is rejected", () => {
    const withProto = JSON.parse(`{"__proto__": {"polluted": true}}`);
    expect(parseDashboard({ ...minimal, ...withProto }).ok).toBe(false);
    expect(parseDashboard({ ...minimal, meta: { title: "x", constructor: "x" } }).ok).toBe(false);
  });

  it("AA-12 (chart encoding): '__proto__' nested inside a chart's encoding object is rejected (chartVariant's internal SafeObject wrap)", () => {
    const withProto = JSON.parse(`{"__proto__": "x"}`);
    const doc = {
      ...minimal,
      charts: [
        { ...minimal.charts[0], encoding: { ...minimal.charts[0]?.encoding, ...withProto } },
      ],
    };
    expect(parseDashboard(doc).ok).toBe(false);
  });

  it("AA-12 (source ref): '__proto__' nested inside a source's ref object is rejected (fileSource's internal SafeObject wrap)", () => {
    const withProto = JSON.parse(`{"__proto__": "x"}`);
    const doc = {
      ...minimal,
      sources: [{ ...minimal.sources[0], ref: { ...minimal.sources[0]?.ref, ...withProto } }],
    };
    expect(parseDashboard(doc).ok).toBe(false);
  });

  it("DA-7: each format has its own documented optional ref field (xlsx/csv/parquet are distinct)", () => {
    expect(
      parseDashboard({
        ...full,
        sources: [
          { id: "s", kind: "file", format: "xlsx", ref: { name: "a.xlsx", sheet: "Sheet1" } },
        ],
      }).ok,
    ).toBe(true); // sheet is xlsx's own optional field
    expect(
      parseDashboard({
        ...full,
        sources: [
          { id: "s", kind: "file", format: "csv", ref: { name: "a.csv", encoding: "shift_jis" } },
        ],
      }).ok,
    ).toBe(true); // encoding is csv's own optional field
    // A format-mismatched field (e.g. encoding on an xlsx source) is
    // deliberately NOT rejected — see the SafeObject/additive-only comment
    // on `dashboard.ts`'s Source definition. `ref` isn't a security boundary,
    // so it gets the same forward-compat treatment as the rest of the
    // document, not a stricter closed shape just for this one field.
    expect(
      parseDashboard({
        ...full,
        sources: [
          { id: "s", kind: "file", format: "xlsx", ref: { name: "a.xlsx", encoding: "shift_jis" } },
        ],
      }).ok,
    ).toBe(true);
    expect(
      parseDashboard({
        ...full,
        sources: [{ id: "s", kind: "file", format: "parquet", ref: { name: "a.parquet" } }],
      }).ok,
    ).toBe(true); // parquet takes neither
  });

  it("area/scatter/stat chart types validate with their own encoding shapes (PRD F3's 7 types)", () => {
    const withChart = (chart: Record<string, unknown>) =>
      parseDashboard({ ...minimal, charts: [{ ...chart, query: "by_category" }] }).ok;
    expect(withChart({ id: "c", type: "area", encoding: { x: "a", y: "b" }, options: {} })).toBe(
      true,
    );
    expect(
      withChart({ id: "c", type: "scatter", encoding: { x: "a", y: "b", size: "c" }, options: {} }),
    ).toBe(true);
    expect(withChart({ id: "c", type: "stat", encoding: { value: "a" }, options: {} })).toBe(true);
  });

  it("AA-8 (bounds): a layout item extending past the 12-column grid is flagged by validateDashboardReferences", () => {
    const doc = {
      ...minimal,
      layout: { grid: "guidebook-12col", items: [{ chart: "c1", x: 8, y: 0, w: 6, h: 4 }] },
    };
    const result = parseDashboard(doc);
    expect(result.ok).toBe(true);
    if (result.ok) {
      const issues = validateDashboardReferences(result.value);
      expect(issues.some((i) => i.kind === "out-of-bounds")).toBe(true);
    }
  });
});
