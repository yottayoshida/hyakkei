import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { parseBakedDashboard, parseDashboard } from "./validate.js";

// S4/B4 (shapes.md): additive-only within version 1 means unknown fields must
// survive validation untouched — this is the load-bearing round-trip
// guarantee behind ADR-0002's "schema is a stable public contract." A future
// hyakkei writing a field this version doesn't know about must not have that
// field silently deleted when an older hyakkei opens and re-saves the file.
//
// Excludes '__proto__'/'constructor'/'prototype': those are the one class of
// "unknown key" that must NOT be preserved (AA-12) — see dashboard.test.ts /
// baked.test.ts for their dedicated rejection tests.
const FORBIDDEN_KEYS = new Set(["__proto__", "constructor", "prototype"]);
const unknownKey = (excluded: Set<string>) =>
  fc.string({ minLength: 1 }).filter((k) => !excluded.has(k) && !FORBIDDEN_KEYS.has(k));

const unknownValue = fc.oneof(
  fc.string(),
  fc.integer(),
  fc.boolean(),
  fc.record({ nested: fc.string() }),
);

const baseDashboard = () => ({
  version: 1 as const,
  meta: { title: "x", locale: "ja" },
  theme: {
    tokens: "@digital-go-jp/design-tokens@2.0.1" as const,
    palette: "guidebook-blue" as const,
  },
  sources: [{ id: "s1", kind: "file" as const, format: "xlsx" as const, ref: { name: "a.xlsx" } }],
  queries: [{ id: "q1", source: "s1", sql: "SELECT 1" }],
  charts: [
    { id: "c1", type: "bar" as const, query: "q1", encoding: { x: "a", y: "b" }, options: {} },
  ],
  layout: { grid: "guidebook-12col" as const, items: [{ chart: "c1", x: 0, y: 0, w: 6, h: 4 }] },
});

const baseBaked = () => ({
  version: 1 as const,
  meta: {
    title: "x",
    generatedAt: "2026-07-05T00:00:00Z",
    sourceDataAsOf: "2026-06-30",
    hyakkeiVersion: "0.1.0",
  },
  theme: {
    tokens: "@digital-go-jp/design-tokens@2.0.1" as const,
    palette: "guidebook-blue" as const,
  },
  charts: [{ id: "c1", type: "bar" as const, encoding: { x: "a", y: "b" }, options: {}, rows: [] }],
  layout: { grid: "guidebook-12col" as const, items: [{ chart: "c1", x: 0, y: 0, w: 6, h: 4 }] },
});

describe("round-trip: theme.appearance is additive and shared (PR-A)", () => {
  it("appearance survives on both Dashboard and BakedDashboard, absent stays absent", () => {
    for (const appearance of ["light", "dark"] as const) {
      const dashDoc = { ...baseDashboard(), theme: { ...baseDashboard().theme, appearance } };
      const dashResult = parseDashboard(dashDoc);
      expect(dashResult.ok).toBe(true);
      if (dashResult.ok) expect(dashResult.value.theme.appearance).toBe(appearance);

      const bakedDoc = { ...baseBaked(), theme: { ...baseBaked().theme, appearance } };
      const bakedResult = parseBakedDashboard(bakedDoc);
      expect(bakedResult.ok).toBe(true);
      if (bakedResult.ok) expect(bakedResult.value.theme.appearance).toBe(appearance);
    }

    const withoutAppearance = parseDashboard(baseDashboard());
    expect(withoutAppearance.ok).toBe(true);
    if (withoutAppearance.ok) expect(withoutAppearance.value.theme.appearance).toBeUndefined();
  });
});

describe("round-trip: chart.altText is additive and top-level", () => {
  it("survives Dashboard and BakedDashboard validation while absent stays absent", () => {
    const dashDoc = {
      ...baseDashboard(),
      charts: [{ ...baseDashboard().charts[0], altText: "月別推移の主な傾向です。" }],
    };
    const dashResult = parseDashboard(dashDoc);
    expect(dashResult.ok).toBe(true);
    if (dashResult.ok) expect(dashResult.value.charts[0]?.altText).toBe("月別推移の主な傾向です。");

    const bakedDoc = {
      ...baseBaked(),
      charts: [{ ...baseBaked().charts[0], altText: "月別推移の主な傾向です。" }],
    };
    const bakedResult = parseBakedDashboard(bakedDoc);
    expect(bakedResult.ok).toBe(true);
    if (bakedResult.ok)
      expect(bakedResult.value.charts[0]?.altText).toBe("月別推移の主な傾向です。");

    const withoutAltText = parseDashboard(baseDashboard());
    expect(withoutAltText.ok).toBe(true);
    if (withoutAltText.ok) expect(withoutAltText.value.charts[0]?.altText).toBeUndefined();
  });
});

describe("round-trip: unknown fields survive validation (additive-only, S4/B4)", () => {
  it("an arbitrary unknown top-level field is preserved after a successful parse", () => {
    fc.assert(
      fc.property(unknownKey(new Set(Object.keys(baseDashboard()))), unknownValue, (key, value) => {
        const doc: Record<string, unknown> = { ...baseDashboard(), [key]: value };
        const result = parseDashboard(doc);
        expect(result.ok).toBe(true);
        if (result.ok) expect((result.value as Record<string, unknown>)[key]).toEqual(value);
      }),
    );
  });

  it("V-110: an arbitrary unknown field nested in meta is preserved after a successful parse", () => {
    fc.assert(
      // Excludes every schema-typed meta key, not just the ones the fixture
      // sets: a generated "description" with a non-string value would make a
      // CORRECT implementation fail this property (issue #72). The last three
      // are issue #124's additions — `updatedAt` in particular is
      // `format: "date"`, so a generated integer there rejects the document.
      fc.property(
        unknownKey(
          new Set(["title", "description", "locale", "updatedAt", "sourceNote", "summary"]),
        ),
        unknownValue,
        (key, value) => {
          const doc = { ...baseDashboard(), meta: { title: "x", locale: "ja", [key]: value } };
          const result = parseDashboard(doc);
          expect(result.ok).toBe(true);
          if (result.ok) expect((result.value.meta as Record<string, unknown>)[key]).toEqual(value);
        },
      ),
    );
  });

  it("an arbitrary unknown field nested in a source is preserved after a successful parse", () => {
    fc.assert(
      fc.property(
        unknownKey(new Set(["id", "kind", "format", "ref", "typeOverrides"])),
        unknownValue,
        (key, value) => {
          const base = baseDashboard();
          const doc = { ...base, sources: [{ ...base.sources[0], [key]: value }] };
          const result = parseDashboard(doc);
          expect(result.ok).toBe(true);
          if (result.ok)
            expect((result.value.sources[0] as Record<string, unknown>)[key]).toEqual(value);
        },
      ),
    );
  });

  // issue 11b, Codex review R1 (P2): existing coverage above proves an
  // unknown field survives on the SOURCE object itself -- this proves the
  // SAME additive guarantee holds one level down, inside a `typeOverrides`
  // ENTRY (`SafeObject({column, category})`, dashboard.ts). A future
  // hyakkei version adding e.g. a per-column date-format field must not
  // have it silently stripped when an older version opens and re-saves.
  it("an arbitrary unknown field nested in a typeOverrides entry is preserved after a successful parse", () => {
    fc.assert(
      fc.property(unknownKey(new Set(["column", "category"])), unknownValue, (key, value) => {
        const base = baseDashboard();
        const doc = {
          ...base,
          sources: [
            {
              ...base.sources[0],
              typeOverrides: [{ column: "x", category: "text", [key]: value }],
            },
          ],
        };
        const result = parseDashboard(doc);
        expect(result.ok).toBe(true);
        if (result.ok) {
          const entry = (result.value.sources[0] as { typeOverrides?: Record<string, unknown>[] })
            .typeOverrides?.[0];
          expect(entry?.[key]).toEqual(value);
        }
      }),
    );
  });

  it("an arbitrary unknown field nested in a query is preserved after a successful parse", () => {
    fc.assert(
      fc.property(
        unknownKey(new Set(["id", "source", "sql", "builderState"])),
        unknownValue,
        (key, value) => {
          const base = baseDashboard();
          const doc = { ...base, queries: [{ ...base.queries[0], [key]: value }] };
          const result = parseDashboard(doc);
          expect(result.ok).toBe(true);
          if (result.ok)
            expect((result.value.queries[0] as Record<string, unknown>)[key]).toEqual(value);
        },
      ),
    );
  });

  // issue 11c: same additive guarantee one level down inside a
  // `builderState.filters`/`measures` entry, mirroring the existing
  // typeOverrides-entry property above.
  it("an arbitrary unknown field nested in a builderState filter entry is preserved after a successful parse", () => {
    fc.assert(
      fc.property(
        unknownKey(new Set(["column", "operator", "value"])),
        unknownValue,
        (key, value) => {
          const base = baseDashboard();
          const doc = {
            ...base,
            queries: [
              {
                ...base.queries[0],
                builderState: {
                  filters: [{ column: "x", operator: "eq", value: "y", [key]: value }],
                  groupBy: [],
                  measures: [],
                },
              },
            ],
          };
          const result = parseDashboard(doc);
          expect(result.ok).toBe(true);
          if (result.ok) {
            const entry = (
              result.value.queries[0] as { builderState?: { filters: Record<string, unknown>[] } }
            ).builderState?.filters[0];
            expect(entry?.[key]).toEqual(value);
          }
        },
      ),
    );
  });

  it("an arbitrary unknown field nested in a builderState measure entry is preserved after a successful parse", () => {
    fc.assert(
      fc.property(unknownKey(new Set(["column", "aggregate"])), unknownValue, (key, value) => {
        const base = baseDashboard();
        const doc = {
          ...base,
          queries: [
            {
              ...base.queries[0],
              builderState: {
                filters: [],
                groupBy: [],
                measures: [{ column: "x", aggregate: "count", [key]: value }],
              },
            },
          ],
        };
        const result = parseDashboard(doc);
        expect(result.ok).toBe(true);
        if (result.ok) {
          const entry = (
            result.value.queries[0] as { builderState?: { measures: Record<string, unknown>[] } }
          ).builderState?.measures[0];
          expect(entry?.[key]).toEqual(value);
        }
      }),
    );
  });

  // Codex test-adversarial review finding: the two tests above only cover an
  // unknown field nested INSIDE a filter/measure entry -- `builderState`
  // itself is a THIRD, independent `SafeObject` (sibling to `filters`/
  // `groupBy`/`measures`, not one of their entries), previously unpinned for
  // the same additive guarantee.
  it("an arbitrary unknown field on builderState itself (alongside filters/groupBy/measures) is preserved after a successful parse", () => {
    fc.assert(
      fc.property(
        unknownKey(new Set(["filters", "groupBy", "measures"])),
        unknownValue,
        (key, value) => {
          const base = baseDashboard();
          const doc = {
            ...base,
            queries: [
              {
                ...base.queries[0],
                builderState: { filters: [], groupBy: [], measures: [], [key]: value },
              },
            ],
          };
          const result = parseDashboard(doc);
          expect(result.ok).toBe(true);
          if (result.ok) {
            const builderState = (
              result.value.queries[0] as { builderState?: Record<string, unknown> }
            ).builderState;
            expect(builderState?.[key]).toEqual(value);
          }
        },
      ),
    );
  });

  it("an arbitrary unknown field nested in a chart is preserved after a successful parse", () => {
    fc.assert(
      fc.property(
        // "sql" is chart-level ForbidFields — a generated collision would
        // correctly be rejected, failing the property (issue #72).
        unknownKey(new Set(["id", "type", "query", "sql", "encoding", "options"])),
        unknownValue,
        (key, value) => {
          const base = baseDashboard();
          const doc = { ...base, charts: [{ ...base.charts[0], [key]: value }] };
          const result = parseDashboard(doc);
          expect(result.ok).toBe(true);
          if (result.ok)
            expect((result.value.charts[0] as Record<string, unknown>)[key]).toEqual(value);
        },
      ),
    );
  });

  it("an arbitrary unknown field nested in a layout item is preserved after a successful parse", () => {
    fc.assert(
      fc.property(
        unknownKey(new Set(["chart", "x", "y", "w", "h"])),
        unknownValue,
        (key, value) => {
          const base = baseDashboard();
          const doc = {
            ...base,
            layout: { ...base.layout, items: [{ ...base.layout.items[0], [key]: value }] },
          };
          const result = parseDashboard(doc);
          expect(result.ok).toBe(true);
          if (result.ok)
            expect((result.value.layout.items[0] as Record<string, unknown>)[key]).toEqual(value);
        },
      ),
    );
  });

  // issue #15/F7 (/plan Phase 5 Codex review, lead-reported coverage gap):
  // the property above pins `layout.items[i]`; `layout` ITSELF -- a
  // sibling SafeObject to `grid`/`items`, not one of `items`' entries --
  // was previously unpinned for the same additive guarantee.
  it("an arbitrary unknown field on layout itself (alongside grid/items) is preserved after a successful parse", () => {
    fc.assert(
      fc.property(unknownKey(new Set(["grid", "items"])), unknownValue, (key, value) => {
        const base = baseDashboard();
        const doc = { ...base, layout: { ...base.layout, [key]: value } };
        const result = parseDashboard(doc);
        expect(result.ok).toBe(true);
        if (result.ok) expect((result.value.layout as Record<string, unknown>)[key]).toEqual(value);
      }),
    );
  });

  // issue #15/F7: existing coverage above proves an unknown field survives
  // on the SOURCE object itself -- this proves the same guarantee one level
  // down, inside `Source.ref` (a nested SafeObject `fileSource()`
  // constructs per-format, dashboard.ts).
  it("an arbitrary unknown field nested in a source's ref is preserved after a successful parse", () => {
    fc.assert(
      fc.property(unknownKey(new Set(["name", "sheet"])), unknownValue, (key, value) => {
        const base = baseDashboard();
        const doc = {
          ...base,
          sources: [{ ...base.sources[0], ref: { ...base.sources[0]!.ref, [key]: value } }],
        };
        const result = parseDashboard(doc);
        expect(result.ok).toBe(true);
        if (result.ok) {
          const ref = (result.value.sources[0] as { ref: Record<string, unknown> }).ref;
          expect(ref[key]).toEqual(value);
        }
      }),
    );
  });

  // issue #15/F7: `theme` is a top-level SafeObject sibling to `meta` — the
  // same additive guarantee `meta`'s own property above pins, one field
  // over.
  it("an arbitrary unknown field nested in theme is preserved after a successful parse", () => {
    fc.assert(
      fc.property(
        unknownKey(new Set(["tokens", "palette", "appearance"])),
        unknownValue,
        (key, value) => {
          const base = baseDashboard();
          const doc = { ...base, theme: { ...base.theme, [key]: value } };
          const result = parseDashboard(doc);
          expect(result.ok).toBe(true);
          if (result.ok)
            expect((result.value.theme as Record<string, unknown>)[key]).toEqual(value);
        },
      ),
    );
  });

  // issue #15/F7: `Chart.encoding` (SafeObject, common.ts's `chartVariant()`)
  // is additive like every other nested object here -- distinct from
  // `Chart.options` immediately below, which is NOT.
  it("an arbitrary unknown field nested in a chart's encoding is preserved after a successful parse", () => {
    fc.assert(
      fc.property(unknownKey(new Set(["x", "y"])), unknownValue, (key, value) => {
        const base = baseDashboard();
        const doc = {
          ...base,
          charts: [{ ...base.charts[0], encoding: { ...base.charts[0]!.encoding, [key]: value } }],
        };
        const result = parseDashboard(doc);
        expect(result.ok).toBe(true);
        if (result.ok) {
          const encoding = (result.value.charts[0] as { encoding: Record<string, unknown> })
            .encoding;
          expect(encoding[key]).toEqual(value);
        }
      }),
    );
  });

  // issue #15/F7: the deliberate exception to this whole describe block's
  // guarantee -- `ChartOptions` (common.ts) sets `additionalProperties:
  // false` at every nesting level as a closed security allowlist against
  // ECharts formatter-style XSS, not a forward-compat surface. Pinned here
  // as a REJECTION (not preservation) so a future change that accidentally
  // widens `ChartOptions` back to additive is caught by this same describe
  // block, not silently.
  it("an unknown field in chart.options is rejected -- ChartOptions is a closed allowlist, not additive", () => {
    const base = baseDashboard();
    const doc = {
      ...base,
      charts: [{ ...base.charts[0], options: { ...base.charts[0]!.options, unknownField: "x" } }],
    };
    const result = parseDashboard(doc);
    expect(result.ok).toBe(false);
  });

  it("BakedDashboard: an arbitrary unknown top-level field is preserved after a successful parse", () => {
    fc.assert(
      // "sources"/"queries" are top-level ForbidFields on BakedDashboard —
      // schema-known constrained keys, so they must be excluded even though
      // the fixture never sets them (issue #72).
      fc.property(
        unknownKey(new Set([...Object.keys(baseBaked()), "sources", "queries"])),
        unknownValue,
        (key, value) => {
          const doc: Record<string, unknown> = { ...baseBaked(), [key]: value };
          const result = parseBakedDashboard(doc);
          expect(result.ok).toBe(true);
          if (result.ok) expect((result.value as Record<string, unknown>)[key]).toEqual(value);
        },
      ),
    );
  });

  it("V-110b: BakedDashboard: an arbitrary unknown field nested in meta is preserved after a successful parse", () => {
    fc.assert(
      fc.property(
        // "description"/"locale" are schema-typed optional BaseMeta keys
        // (issue #72) — see the authoring-meta property above. "updatedAt"/
        // "sourceNote"/"summary" are issue #124's, mirrored onto BakedMeta.
        unknownKey(
          new Set([
            "title",
            "description",
            "locale",
            "updatedAt",
            "sourceNote",
            "summary",
            "generatedAt",
            "sourceDataAsOf",
            "hyakkeiVersion",
            "guidebookVersion",
          ]),
        ),
        unknownValue,
        (key, value) => {
          const base = baseBaked();
          const doc = { ...base, meta: { ...base.meta, [key]: value } };
          const result = parseBakedDashboard(doc);
          expect(result.ok).toBe(true);
          if (result.ok) expect((result.value.meta as Record<string, unknown>)[key]).toEqual(value);
        },
      ),
    );
  });

  it("BakedDashboard: an arbitrary unknown field nested in a chart is preserved after a successful parse", () => {
    fc.assert(
      fc.property(
        // "query"/"sql" are BakedChart ForbidFields — schema-known constrained
        // keys a generated collision would correctly get rejected on (issue #72).
        unknownKey(new Set(["id", "type", "query", "sql", "encoding", "options", "rows"])),
        unknownValue,
        (key, value) => {
          const base = baseBaked();
          const doc = { ...base, charts: [{ ...base.charts[0], [key]: value }] };
          const result = parseBakedDashboard(doc);
          expect(result.ok).toBe(true);
          if (result.ok)
            expect((result.value.charts[0] as Record<string, unknown>)[key]).toEqual(value);
        },
      ),
    );
  });

  it("BakedDashboard: an arbitrary unknown field nested in a layout item is preserved after a successful parse", () => {
    fc.assert(
      fc.property(
        unknownKey(new Set(["chart", "x", "y", "w", "h"])),
        unknownValue,
        (key, value) => {
          const base = baseBaked();
          const doc = {
            ...base,
            layout: { ...base.layout, items: [{ ...base.layout.items[0], [key]: value }] },
          };
          const result = parseBakedDashboard(doc);
          expect(result.ok).toBe(true);
          if (result.ok)
            expect((result.value.layout.items[0] as Record<string, unknown>)[key]).toEqual(value);
        },
      ),
    );
  });
});
