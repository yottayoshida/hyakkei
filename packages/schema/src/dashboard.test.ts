import { describe, expect, it } from "vitest";
import { parseDashboard, validateDashboardReferences } from "./validate.js";

// Samples S1/S2/S3 from .claude/plans/2026-07-04-hyakkei-v0.1-pr-issue6-shapes.md
const empty = {
  version: 1,
  meta: { title: "無題のダッシュボード", locale: "ja" },
  theme: { tokens: "@digital-go-jp/design-tokens@2.0.1", palette: "guidebook-blue" },
  sources: [],
  queries: [],
  charts: [],
  layout: { grid: "guidebook-12col", items: [] },
};

const minimal = {
  version: 1,
  meta: { title: "月次KPIダッシュボード", locale: "ja" },
  theme: { tokens: "@digital-go-jp/design-tokens@2.0.1", palette: "guidebook-blue" },
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
  theme: { tokens: "@digital-go-jp/design-tokens@2.0.1", palette: "guidebook-blue" },
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

  it.each([
    ["SI-1 lowercase ascii", "apps"],
    ["SI-2 snake_case with digits", "budget_2026"],
    ["SI-3 leading underscore", "_tmp"],
    ["SI-4 mixed case", "BySales"],
    ["SI-5 single char", "x"],
    ["SI-B2 at max length (64 chars)", "a".repeat(64)],
  ])("%s is accepted as a Source.id / Query.source", (_label, id) => {
    const doc = {
      ...minimal,
      sources: [{ ...minimal.sources[0], id }],
      queries: [{ ...minimal.queries[0], source: id }],
    };
    expect(parseDashboard(doc).ok).toBe(true);
  });

  it("SI-A5: '__proto__' is accepted as a Source.id *value* (SQL-safe; AA-12 guards property names, not values)", () => {
    const doc = {
      ...minimal,
      sources: [{ ...minimal.sources[0], id: "__proto__" }],
      queries: [{ ...minimal.queries[0], source: "__proto__" }],
    };
    expect(parseDashboard(doc).ok).toBe(true);
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
        theme: { tokens: "@digital-go-jp/design-tokens@2.0.1", palette: "evil" },
      }).ok,
    ).toBe(false);
  });

  it("AA-15: all 7 guidebook key-color Palette values validate (PR-A, M0 spike palette set)", () => {
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
      const result = parseDashboard({ ...minimal, theme: { ...minimal.theme, palette } });
      expect(result.ok, `palette '${palette}' should validate`).toBe(true);
    }
  });

  it("AA-16: theme.appearance is optional and accepts light/dark; other values are rejected", () => {
    expect(parseDashboard(minimal).ok).toBe(true); // no appearance field at all
    for (const appearance of ["light", "dark"]) {
      const result = parseDashboard({
        ...minimal,
        theme: { ...minimal.theme, appearance },
      });
      expect(result.ok, `appearance '${appearance}' should validate`).toBe(true);
      if (result.ok) expect(result.value.theme.appearance).toBe(appearance);
    }
    expect(
      parseDashboard({ ...minimal, theme: { ...minimal.theme, appearance: "sepia" } }).ok,
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

  // Shared across every SqlIdentifier-typed field (Source.id on both the
  // file and url variants, Query.source) so a wiring regression on any one
  // of them — e.g. UrlSource.id silently reverting to NonEmptyString — is
  // caught the same way as on the others (Phase 6-B test-adversarial-review
  // finding: the file-source id and Query.source had asymmetric coverage).
  const INVALID_SQL_IDENTIFIER_SHAPES: Array<[string, string]> = [
    ["SI-B1 empty string", ""],
    ["SI-B3 leading digit", "1st_source"],
    ["SI-B5 Japanese id", "売上"],
    ["SI-B6 leading whitespace", " apps"],
    ["SI-B6 trailing whitespace", "apps "],
    ["SI-A1 classic SQL injection", "t; DROP TABLE x--"],
    ["SI-A2 quote-break attempt", 'a" ; DROP --'],
    ["SI-A7 embedded newline", "apps\nDROP"],
    ["SI-B2 over max length (65 chars)", "a".repeat(65)],
  ];

  // Looked up by kind/id, not by array position (/code-review Phase 9): a
  // positional index into `full` (defined ~350 lines above) has no runtime
  // link to "the url-kind source" — a future edit reordering or inserting
  // into `full.sources` would silently retarget this test at the wrong
  // source variant while it kept passing (the invalid shapes below are
  // rejected regardless of which source they land on), quietly losing
  // UrlSource.id's independent coverage.
  const fileSource = full.sources.find((s) => s.kind === "file")!;
  const urlSource = full.sources.find((s) => s.kind === "url")!;
  const firstQuery = full.queries.find((q) => q.id === "q_cat")!;

  // One loop generating three independently-named it.each blocks, not one
  // block covering all three fields at once: each field still fails on its
  // own if it regresses (the original bug this array closed — see the
  // comment above it), the loop only removes the copy-pasted assertion body
  // (/simplify simplification pass).
  const SQL_IDENTIFIER_TARGETS: Array<[string, (id: string) => unknown]> = [
    ["file Source.id", (id) => ({ ...full, sources: [{ ...fileSource, id }] })],
    [
      "url Source.id (checked independently of the file variant)",
      (id) => ({ ...full, sources: [{ ...urlSource, id }] }),
    ],
    [
      "Query.source (same type as Source.id, checked independently)",
      (source) => ({ ...full, queries: [{ ...firstQuery, source }] }),
    ],
  ];
  for (const [target, buildDoc] of SQL_IDENTIFIER_TARGETS) {
    it.each(INVALID_SQL_IDENTIFIER_SHAPES)(`%s is rejected as a ${target}`, (_label, value) => {
      expect(parseDashboard(buildDoc(value)).ok).toBe(false);
    });
  }

  it.each([
    ["SI-A3 reserved word (lowercase)", "select"],
    ["SI-A3 reserved word (from)", "from"],
    ["SI-A4 reserved word (mixed case)", "Select"],
    ["SI-A4 reserved word (uppercase)", "FROM"],
  ])(
    "%s passes SqlIdentifier's pattern but is flagged by validateDashboardReferences (reserved-word)",
    (_label, id) => {
      const doc = { ...minimal, sources: [{ ...minimal.sources[0], id }] };
      const result = parseDashboard(doc);
      expect(result.ok).toBe(true); // pattern alone can't see keyword membership
      if (result.ok) {
        const issues = validateDashboardReferences(result.value);
        expect(issues.some((i) => i.kind === "reserved-word")).toBe(true);
      }
    },
  );

  it("SI-B4: source ids differing only by case are flagged as a duplicate (DuckDB identifiers are case-insensitive)", () => {
    const doc = {
      ...full,
      sources: [
        { ...full.sources[0], id: "Apps" },
        { ...full.sources[0], id: "apps" },
      ],
    };
    const result = parseDashboard(doc);
    expect(result.ok).toBe(true);
    if (result.ok) {
      const issues = validateDashboardReferences(result.value);
      expect(issues.some((i) => i.kind === "duplicate")).toBe(true);
    }
  });

  // /simplify (altitude pass) caught this: fixing SI-B4's duplicate
  // detection alone left the *dangling-reference* check doing an
  // exact-case lookup — a single-source doc with `Source.id: "Apps"` and
  // `Query.source: "apps"` (a valid reference; DuckDB resolves both to the
  // same table) was wrongly flagged as dangling.
  it("SI-B4 (FK side): a Query.source differing only by case from its declared Source.id is NOT flagged as dangling", () => {
    const doc = {
      ...minimal,
      sources: [{ ...minimal.sources[0], id: "Apps" }],
      queries: [{ ...minimal.queries[0], source: "apps" }],
    };
    const result = parseDashboard(doc);
    expect(result.ok).toBe(true);
    if (result.ok) {
      const issues = validateDashboardReferences(result.value);
      expect(issues.some((i) => i.kind === "dangling")).toBe(false);
    }
  });
});

describe("dashboard.json — Source.typeOverrides (issue 11b)", () => {
  it("TO-1: absent typeOverrides (legacy shape) round-trips as absent -- every pre-#11b fixture in this file has no typeOverrides field and must keep passing untouched", () => {
    const result = parseDashboard(minimal);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.sources[0]).not.toHaveProperty("typeOverrides");
  });

  it("TO-2: an empty typeOverrides array is accepted and round-trips as an empty array (distinct from absent)", () => {
    const doc = {
      ...minimal,
      sources: [{ ...minimal.sources[0], typeOverrides: [] }],
    };
    const result = parseDashboard(doc);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.sources[0]).toMatchObject({ typeOverrides: [] });
  });

  it("TO-3: a valid override entry (column + one of the 3 closed categories) is accepted", () => {
    const doc = {
      ...minimal,
      sources: [
        { ...minimal.sources[0], typeOverrides: [{ column: "amount", category: "number" }] },
      ],
    };
    const result = parseDashboard(doc);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.sources[0]).toMatchObject({
        typeOverrides: [{ column: "amount", category: "number" }],
      });
    }
  });

  // Codex review R1 (P1): TO-3 only exercises "amount" -- this would still
  // pass even if `column` were accidentally tightened from `NonEmptyString`
  // to `SqlIdentifier` (dashboard.ts), silently rejecting the exact
  // injection-shaped/CJK/whitespace column names F12/F13 already document
  // as legitimate data. Proves `column` stays unrestricted independent of
  // that accidental-tightening risk.
  it.each([
    ["F12 injection-shaped column name", 'a" ; DROP TABLE t --'],
    ["F13 whitespace/newline/CJK column name", "郵便 番号\n"],
  ])("TO-3b: %s is accepted as a typeOverrides.column value", (_label, column) => {
    const doc = {
      ...minimal,
      sources: [{ ...minimal.sources[0], typeOverrides: [{ column, category: "text" }] }],
    };
    const result = parseDashboard(doc);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.sources[0]).toMatchObject({
        typeOverrides: [{ column, category: "text" }],
      });
    }
  });

  it("TO-4: typeOverrides is also accepted on a url-kind Source (every Source variant produces a queryable table)", () => {
    // Codex review (Phase 6-B): found by kind, not by array index --
    // `full.sources[2]` would silently start testing a different (file)
    // source variant if this fixture's array order ever changed, and the
    // assertion below would still pass without ever exercising url-kind at
    // all. Asserting the found fixture's `kind` first makes that failure
    // mode loud instead of silent.
    const urlSource = full.sources.find((s) => s.kind === "url");
    expect(urlSource?.kind).toBe("url");
    const doc = {
      ...full,
      sources: [{ ...urlSource, typeOverrides: [{ column: "amount", category: "date" }] }],
    };
    expect(parseDashboard(doc).ok).toBe(true);
  });

  it.each([
    ["text", "text"],
    ["number", "number"],
    ["date", "date"],
  ])("TO-5: category %s is a member of the closed union", (_label, category) => {
    const doc = {
      ...minimal,
      sources: [{ ...minimal.sources[0], typeOverrides: [{ column: "x", category }] }],
    };
    expect(parseDashboard(doc).ok).toBe(true);
  });

  // ADV-1/ADV-2/SEC-1/SEC-5: the whole point of `category` being a closed
  // union rather than a free string is that neither a raw DuckDB type name
  // nor an injection payload can ever reach the CAST target-type position
  // this value is later used to build (`@hyakkei/core`'s `CAST_TARGET`
  // lookup) -- Ajv must reject all of these before any SQL is ever built.
  it.each([
    ["ADV-1 SQL-injection-shaped string", "INTEGER); DROP TABLE t; --"],
    ["ADV-2a a real DuckDB type name, not one of our 3 categories", "double"],
    ["ADV-2b another real DuckDB type name", "varchar"],
    ["case mismatch (closed union is case-sensitive)", "Number"],
    ["empty string", ""],
    ["unrelated known literal from elsewhere in this schema", "guidebook-blue"],
  ])("TO-6: %s is rejected as a typeOverrides category", (_label, category) => {
    const doc = {
      ...minimal,
      sources: [{ ...minimal.sources[0], typeOverrides: [{ column: "x", category }] }],
    };
    expect(parseDashboard(doc).ok).toBe(false);
  });

  it.each([
    ["ADV-10a category as a number", 123],
    ["ADV-10b category as null", null],
    ["ADV-10c category as an array", ["number"]],
  ])("TO-7: %s (non-string category) is rejected", (_label, category) => {
    const doc = {
      ...minimal,
      sources: [{ ...minimal.sources[0], typeOverrides: [{ column: "x", category }] }],
    };
    expect(parseDashboard(doc).ok).toBe(false);
  });

  it("TO-8/ADV-4: typeOverrides as an object (column-name-keyed Record) rather than an array is rejected -- this is the explicitly-rejected alternative design (plan §技術選定)", () => {
    const doc = {
      ...minimal,
      sources: [{ ...minimal.sources[0], typeOverrides: { amount: "number" } }],
    };
    expect(parseDashboard(doc).ok).toBe(false);
  });

  it("TO-9/ADV-11: typeOverrides: null is rejected (Optional means absent-or-array, not null)", () => {
    const doc = { ...minimal, sources: [{ ...minimal.sources[0], typeOverrides: null }] };
    expect(parseDashboard(doc).ok).toBe(false);
  });

  it.each([
    ["TO-10/F5 entry is a bare string", ["number"]],
    ["TO-10/F5 entry is null", [null]],
    ["TO-10/F6a entry missing category", [{ column: "x" }]],
    ["TO-10/F6b entry missing column", [{ category: "number" }]],
    ["TO-10/F7 entry has an empty column string", [{ column: "", category: "number" }]],
  ])("%s is rejected", (_label, typeOverrides) => {
    const doc = { ...minimal, sources: [{ ...minimal.sources[0], typeOverrides }] };
    expect(parseDashboard(doc).ok).toBe(false);
  });

  it("TO-11/ADV-8: '__proto__' as an entry's OWN property name is rejected (SafeObject guard, AA-12 analog)", () => {
    // `JSON.parse`, not an object literal (AA-12's own established pattern,
    // above): writing `{ __proto__: x }` directly in a literal is special-
    // cased by the JS spec to set the prototype, never creating an own
    // property named "__proto__" at all -- which would make this test
    // accidentally assert nothing. `JSON.parse` (and the object spread
    // used to merge it below) both go through `[[DefineOwnProperty]]`,
    // which does create a genuine own "__proto__" property -- the same
    // attack shape a real hand-edited/untrusted dashboard.json would take.
    const withProto = JSON.parse(
      `{"__proto__": {"polluted": true}, "column": "x", "category": "number"}`,
    );
    const doc = {
      ...minimal,
      sources: [{ ...minimal.sources[0], typeOverrides: [withProto] }],
    };
    expect(parseDashboard(doc).ok).toBe(false);
  });

  // ADV-3 (mirrors SI-A5): unlike a property NAME, `__proto__` as a plain
  // string VALUE in an array is never assigned as a JS object key, so there
  // is no pollution surface -- the array shape (not a column-name-keyed
  // Record) is exactly what makes this safe to accept.
  it("TO-12/ADV-3: '__proto__' as a column name VALUE is accepted -- the array shape means it never becomes a JS object key", () => {
    const doc = {
      ...minimal,
      sources: [
        { ...minimal.sources[0], typeOverrides: [{ column: "__proto__", category: "text" }] },
      ],
    };
    const result = parseDashboard(doc);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.sources[0]).toMatchObject({
        typeOverrides: [{ column: "__proto__", category: "text" }],
      });
    }
  });

  // F8/ADV-5: schema-valid (arrays permit duplicates); runtime resolves
  // ambiguity as last-wins with an advisory (ADR-0011, SEC-10) -- schema
  // itself does not need to (and structurally cannot, without becoming the
  // rejected Record-keyed shape) prevent this. `validateDashboardReferences`
  // (not schema) is what surfaces the advisory (Codex review R1 P2:
  // originally documented but not implemented).
  it("TO-13/ADV-5: duplicate column entries in typeOverrides are schema-valid, and flagged by validateDashboardReferences as an advisory duplicate", () => {
    const doc = {
      ...minimal,
      sources: [
        {
          ...minimal.sources[0],
          typeOverrides: [
            { column: "amount", category: "number" },
            { column: "amount", category: "text" },
          ],
        },
      ],
    };
    const result = parseDashboard(doc);
    expect(result.ok).toBe(true);
    if (result.ok) {
      const issues = validateDashboardReferences(result.value);
      expect(issues.some((i) => i.kind === "duplicate" && i.message.includes("amount"))).toBe(true);
    }
  });

  it("TO-13b: no duplicate advisory when every override names a distinct column", () => {
    const doc = {
      ...minimal,
      sources: [
        {
          ...minimal.sources[0],
          typeOverrides: [
            { column: "amount", category: "number" },
            { column: "date", category: "date" },
          ],
        },
      ],
    };
    const result = parseDashboard(doc);
    expect(result.ok).toBe(true);
    if (result.ok) {
      const issues = validateDashboardReferences(result.value);
      expect(issues.some((i) => i.kind === "duplicate")).toBe(false);
    }
  });

  // ADV-6: schema itself never bounds array length -- SEC-6's DoS mitigation
  // (on-change, per-column firing, never a bulk auto-fire) lives at the
  // runtime layer, not here.
  it("TO-14/ADV-6: a large typeOverrides array is schema-valid (no length cap at the schema layer)", () => {
    // 5,000 entries, matching the shape enumeration's own ADV-6 size
    // exactly (serialized-soaring-map-pr1-shapes.md), not a smaller stand-in.
    const typeOverrides = Array.from({ length: 5000 }, (_, i) => ({
      column: `col_${i}`,
      category: "number",
    }));
    const doc = { ...minimal, sources: [{ ...minimal.sources[0], typeOverrides }] };
    expect(parseDashboard(doc).ok).toBe(true);
  });
});

describe("dashboard.json — Query.builderState (issue 11c)", () => {
  it("BS-1: absent builderState (legacy shape) round-trips as absent -- every pre-#11c fixture in this file has no builderState field and must keep passing untouched", () => {
    const result = parseDashboard(minimal);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.queries[0]).not.toHaveProperty("builderState");
  });

  it("BS-2/G1: builderState: {} (all 3 arrays missing) is rejected -- filters/groupBy/measures are required, not each independently Optional", () => {
    const doc = {
      ...minimal,
      queries: [{ ...minimal.queries[0], builderState: {} }],
    };
    expect(parseDashboard(doc).ok).toBe(false);
  });

  it("BS-3/G1: builderState with all 3 arrays present-but-empty is accepted -- distinct from BS-2, the 'nothing configured yet' state", () => {
    const doc = {
      ...minimal,
      queries: [
        { ...minimal.queries[0], builderState: { filters: [], groupBy: [], measures: [] } },
      ],
    };
    const result = parseDashboard(doc);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.queries[0]).toMatchObject({
        builderState: { filters: [], groupBy: [], measures: [] },
      });
    }
  });

  it("BS-4: a valid filter entry (column + operator + value) is accepted", () => {
    const doc = {
      ...minimal,
      queries: [
        {
          ...minimal.queries[0],
          builderState: {
            filters: [{ column: "amount", operator: "gt", value: "1000" }],
            groupBy: [],
            measures: [],
          },
        },
      ],
    };
    const result = parseDashboard(doc);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.queries[0]).toMatchObject({
        builderState: { filters: [{ column: "amount", operator: "gt", value: "1000" }] },
      });
    }
  });

  it("BS-5: is_null/is_not_null are accepted with no value field at all", () => {
    const doc = {
      ...minimal,
      queries: [
        {
          ...minimal.queries[0],
          builderState: {
            filters: [
              { column: "amount", operator: "is_null" },
              { column: "amount", operator: "is_not_null" },
            ],
            groupBy: [],
            measures: [],
          },
        },
      ],
    };
    expect(parseDashboard(doc).ok).toBe(true);
  });

  it("BS-6/G4: value: '' (empty string) is accepted and distinct from an absent value", () => {
    const doc = {
      ...minimal,
      queries: [
        {
          ...minimal.queries[0],
          builderState: {
            filters: [{ column: "amount", operator: "eq", value: "" }],
            groupBy: [],
            measures: [],
          },
        },
      ],
    };
    const result = parseDashboard(doc);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.queries[0]).toMatchObject({
        builderState: { filters: [{ column: "amount", operator: "eq", value: "" }] },
      });
    }
  });

  it.each([
    ["eq", "eq"],
    ["ne", "ne"],
    ["lt", "lt"],
    ["lte", "lte"],
    ["gt", "gt"],
    ["gte", "gte"],
    ["contains", "contains"],
    ["not_contains", "not_contains"],
    ["is_null", "is_null"],
    ["is_not_null", "is_not_null"],
  ])("BS-7: operator %s is a member of the closed union", (_label, operator) => {
    const doc = {
      ...minimal,
      queries: [
        {
          ...minimal.queries[0],
          builderState: {
            filters: [{ column: "x", operator, value: "y" }],
            groupBy: [],
            measures: [],
          },
        },
      ],
    };
    expect(parseDashboard(doc).ok).toBe(true);
  });

  // Same rationale as TO-6/ADV-1/ADV-2: the operator position is exactly as
  // unescapable as the CAST type position, so Ajv rejecting free text here
  // is the load-bearing control, not `quoteIdentifier`-style escaping.
  it.each([
    ["ADV SQL-injection-shaped string", "eq); DROP TABLE t; --"],
    ["a raw SQL operator, not one of our 10 literals", "="],
    ["case mismatch (closed union is case-sensitive)", "EQ"],
    ["empty string", ""],
    ["a property shaped like an Object.prototype member", "toString"],
  ])("BS-8: %s is rejected as a filter operator", (_label, operator) => {
    const doc = {
      ...minimal,
      queries: [
        {
          ...minimal.queries[0],
          builderState: {
            filters: [{ column: "x", operator, value: "y" }],
            groupBy: [],
            measures: [],
          },
        },
      ],
    };
    expect(parseDashboard(doc).ok).toBe(false);
  });

  it.each([
    ["sum", "sum"],
    ["count", "count"],
    ["avg", "avg"],
  ])("BS-9: aggregate %s is a member of the closed union", (_label, aggregate) => {
    const doc = {
      ...minimal,
      queries: [
        {
          ...minimal.queries[0],
          builderState: { filters: [], groupBy: [], measures: [{ column: "amount", aggregate }] },
        },
      ],
    };
    expect(parseDashboard(doc).ok).toBe(true);
  });

  it.each([
    ["ADV SQL-injection-shaped string", "sum); DROP TABLE t; --"],
    ["a raw SQL function name, not one of our 3 literals", "SUM"],
    ["min/max are explicitly out of scope for v1", "min"],
    ["empty string", ""],
  ])("BS-10: %s is rejected as an aggregate function", (_label, aggregate) => {
    const doc = {
      ...minimal,
      queries: [
        {
          ...minimal.queries[0],
          builderState: { filters: [], groupBy: [], measures: [{ column: "amount", aggregate }] },
        },
      ],
    };
    expect(parseDashboard(doc).ok).toBe(false);
  });

  it.each([
    ["F12-analog injection-shaped column name", 'a" ; DROP TABLE t --'],
    ["F13-analog whitespace/newline/CJK column name", "郵便 番号\n"],
  ])("BS-11: %s is accepted as a groupBy/filter/measure column value", (_label, column) => {
    const doc = {
      ...minimal,
      queries: [
        {
          ...minimal.queries[0],
          builderState: {
            filters: [{ column, operator: "is_null" }],
            groupBy: [column],
            measures: [{ column, aggregate: "count" }],
          },
        },
      ],
    };
    expect(parseDashboard(doc).ok).toBe(true);
  });

  // TO-12-analog: '__proto__' as a column name VALUE (array element, never
  // an object key) is safe and accepted -- the whole point of keeping
  // `groupBy` array-shaped rather than a column-name-keyed Record.
  it("BS-12/ADV-3-analog: '__proto__' as a column name VALUE (filters/groupBy/measures) is accepted -- never becomes a JS object key", () => {
    const doc = {
      ...minimal,
      queries: [
        {
          ...minimal.queries[0],
          builderState: {
            filters: [{ column: "__proto__", operator: "is_not_null" }],
            groupBy: ["__proto__"],
            measures: [{ column: "__proto__", aggregate: "count" }],
          },
        },
      ],
    };
    const result = parseDashboard(doc);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.queries[0]).toMatchObject({
        builderState: { groupBy: ["__proto__"] },
      });
    }
  });

  // TO-11-analog: '__proto__' as an entry's OWN property name (not a column
  // VALUE) is rejected by the SafeObject guard, same as typeOverrides.
  it("BS-13/ADV-8-analog: '__proto__' as a filter entry's OWN property name is rejected (SafeObject guard)", () => {
    const withProto = JSON.parse(
      `{"__proto__": {"polluted": true}, "column": "x", "operator": "eq", "value": "y"}`,
    );
    const doc = {
      ...minimal,
      queries: [
        {
          ...minimal.queries[0],
          builderState: { filters: [withProto], groupBy: [], measures: [] },
        },
      ],
    };
    expect(parseDashboard(doc).ok).toBe(false);
  });

  // Codex test-adversarial review finding: BS-13 only exercised a FILTER
  // entry's own property name -- `Measure` is a second, independent
  // `SafeObject` and `builderState` itself is a third, neither previously
  // pinned against the same `__proto__`/`constructor` own-property attack.
  it("BS-13b: '__proto__' as a measure entry's OWN property name is rejected", () => {
    const withProto = JSON.parse(
      `{"__proto__": {"polluted": true}, "column": "x", "aggregate": "count"}`,
    );
    const doc = {
      ...minimal,
      queries: [
        {
          ...minimal.queries[0],
          builderState: { filters: [], groupBy: [], measures: [withProto] },
        },
      ],
    };
    expect(parseDashboard(doc).ok).toBe(false);
  });

  it("BS-13c: '__proto__' as builderState's OWN property name (alongside filters/groupBy/measures) is rejected", () => {
    const withProto = JSON.parse(
      `{"__proto__": {"polluted": true}, "filters": [], "groupBy": [], "measures": []}`,
    );
    const doc = {
      ...minimal,
      queries: [{ ...minimal.queries[0], builderState: withProto }],
    };
    expect(parseDashboard(doc).ok).toBe(false);
  });

  it("BS-13d: 'constructor' as a filter/measure entry's OWN property name is rejected", () => {
    const filterWithConstructor = JSON.parse(
      `{"constructor": {"polluted": true}, "column": "x", "operator": "eq", "value": "y"}`,
    );
    const measureWithConstructor = JSON.parse(
      `{"constructor": {"polluted": true}, "column": "x", "aggregate": "count"}`,
    );
    expect(
      parseDashboard({
        ...minimal,
        queries: [
          {
            ...minimal.queries[0],
            builderState: { filters: [filterWithConstructor], groupBy: [], measures: [] },
          },
        ],
      }).ok,
    ).toBe(false);
    expect(
      parseDashboard({
        ...minimal,
        queries: [
          {
            ...minimal.queries[0],
            builderState: { filters: [], groupBy: [], measures: [measureWithConstructor] },
          },
        ],
      }).ok,
    ).toBe(false);
  });

  // TO-8-analog: the explicitly-rejected column-name-keyed object shape.
  it("BS-14: builderState.filters/groupBy/measures as objects (not arrays) are rejected", () => {
    const filtersAsObject = {
      ...minimal,
      queries: [
        {
          ...minimal.queries[0],
          builderState: { filters: { amount: "gt" }, groupBy: [], measures: [] },
        },
      ],
    };
    expect(parseDashboard(filtersAsObject).ok).toBe(false);

    const groupByAsObject = {
      ...minimal,
      queries: [
        {
          ...minimal.queries[0],
          builderState: { filters: [], groupBy: { amount: true }, measures: [] },
        },
      ],
    };
    expect(parseDashboard(groupByAsObject).ok).toBe(false);

    const measuresAsObject = {
      ...minimal,
      queries: [
        {
          ...minimal.queries[0],
          builderState: { filters: [], groupBy: [], measures: { amount: "sum" } },
        },
      ],
    };
    expect(parseDashboard(measuresAsObject).ok).toBe(false);
  });

  it.each([
    ["filter entry missing operator", { filters: [{ column: "x" }], groupBy: [], measures: [] }],
    ["filter entry missing column", { filters: [{ operator: "eq" }], groupBy: [], measures: [] }],
    ["measure entry missing aggregate", { filters: [], groupBy: [], measures: [{ column: "x" }] }],
    [
      "measure entry missing column",
      { filters: [], groupBy: [], measures: [{ aggregate: "sum" }] },
    ],
    ["groupBy entry is not a string", { filters: [], groupBy: [123], measures: [] }],
  ])("BS-15: %s is rejected", (_label, builderState) => {
    const doc = { ...minimal, queries: [{ ...minimal.queries[0], builderState }] };
    expect(parseDashboard(doc).ok).toBe(false);
  });

  it("BS-16: a large builderState (many filters/measures) is schema-valid -- no length cap at the schema layer (mirrors TO-14/ADV-6)", () => {
    const filters = Array.from({ length: 500 }, (_, i) => ({
      column: `col_${i}`,
      operator: "eq" as const,
      value: "x",
    }));
    const measures = Array.from({ length: 500 }, (_, i) => ({
      column: `col_${i}`,
      aggregate: "count" as const,
    }));
    const doc = {
      ...minimal,
      queries: [{ ...minimal.queries[0], builderState: { filters, groupBy: [], measures } }],
    };
    expect(parseDashboard(doc).ok).toBe(true);
  });
});

// issue #124: the guidebook's Do-side fields (p41 メタ情報を記載する, p56
// 要約したテキスト情報を用意する). Same five-part shape the two prior additive
// fields shipped with (ADR-0011 `typeOverrides`, ADR-0012 `builderState`):
// absent-legacy, empty-vs-absent, valid-value plus a "still unrestricted"
// guard, a rejection matrix, and round-trip additivity one level down
// (round-trip.test.ts).
describe("dashboard.json — meta.updatedAt / sourceNote / summary (issue #124)", () => {
  const withMeta = (meta: Record<string, unknown>) => ({ ...minimal, meta });

  it("MD-1: absent (legacy shape) round-trips as absent -- every pre-#124 fixture in this file omits all three and must keep passing untouched", () => {
    const result = parseDashboard(minimal);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.meta).not.toHaveProperty("updatedAt");
      expect(result.value.meta).not.toHaveProperty("sourceNote");
      expect(result.value.meta).not.toHaveProperty("summary");
    }
  });

  it("MD-2: empty strings are accepted and round-trip as empty (distinct from absent)", () => {
    // Schema-valid on purpose: `Type.String()` has no `minLength`, matching
    // `description`/`locale`. Emptiness is a RENDER-time concern -- the footer
    // runs `sanitizeDisplayText` and treats a blank result as absent, so a
    // value that is only whitespace or only bidi controls draws nothing. That
    // belongs at the render layer, not here: rejecting `""` in the schema
    // would make a document unopenable over a cosmetic mistake.
    const result = parseDashboard(withMeta({ title: "t", sourceNote: "", summary: "" }));
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.meta).toMatchObject({ sourceNote: "", summary: "" });
  });

  it("MD-3: valid values are accepted", () => {
    const result = parseDashboard(
      withMeta({
        title: "t",
        updatedAt: "2026-06-30",
        sourceNote: "総務省統計局「家計調査」2026年6月分",
        summary: "申請件数は4月の51件から9月の66件へ増加した。",
      }),
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.meta).toMatchObject({
        updatedAt: "2026-06-30",
        sourceNote: "総務省統計局「家計調査」2026年6月分",
        summary: "申請件数は4月の51件から9月の66件へ増加した。",
      });
    }
  });

  it("MD-3b: sourceNote/summary stay unrestricted free text -- URLs, newlines, CJK, quotes, injection-shaped strings", () => {
    // Mirrors TO-3b's reasoning: MD-3 alone would still pass if these were
    // accidentally tightened to a pattern or a maxLength. A source citation
    // legitimately contains slashes, colons and full-width punctuation, and
    // `common.ts` states the no-maxLength choice is deliberate.
    const result = parseDashboard(
      withMeta({
        title: "t",
        sourceNote: 'https://example.go.jp/data?a=1&b=2 — 注記: a" ; DROP TABLE t --\n免責事項',
        summary: "一行目\n二行目\t（タブ）　全角空白",
      }),
    );
    expect(result.ok).toBe(true);
  });

  it("MD-4: updatedAt rejects everything that is not a calendar date", () => {
    // `format: "date"` is strict here, so a typo makes the whole document
    // unopenable rather than degrading -- worth pinning explicitly.
    for (const bad of [
      "2026-13-45",
      "2026-02-30",
      "not-a-date",
      "2026-06-30T00:00:00Z",
      "2026/06/30",
      "２０２６-０６-３０",
      "2026-06-30 ",
      "",
    ]) {
      expect(parseDashboard(withMeta({ title: "t", updatedAt: bad })).ok, `updatedAt=${bad}`).toBe(
        false,
      );
    }
  });

  it("MD-5: wrong container types are rejected for all three", () => {
    for (const key of ["updatedAt", "sourceNote", "summary"]) {
      for (const bad of [null, 123, [], {}, true]) {
        expect(
          parseDashboard(withMeta({ title: "t", [key]: bad })).ok,
          `${key}=${JSON.stringify(bad)}`,
        ).toBe(false);
      }
    }
  });

  it("MD-6: no length cap -- a 100,000-character summary is schema-valid (mirrors TO-14/BS-16)", () => {
    const result = parseDashboard(withMeta({ title: "t", summary: "あ".repeat(100_000) }));
    expect(result.ok).toBe(true);
  });
});
