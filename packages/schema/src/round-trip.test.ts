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

  it("an arbitrary unknown field nested in meta is preserved after a successful parse", () => {
    fc.assert(
      fc.property(unknownKey(new Set(["title", "locale"])), unknownValue, (key, value) => {
        const doc = { ...baseDashboard(), meta: { title: "x", locale: "ja", [key]: value } };
        const result = parseDashboard(doc);
        expect(result.ok).toBe(true);
        if (result.ok) expect((result.value.meta as Record<string, unknown>)[key]).toEqual(value);
      }),
    );
  });

  it("an arbitrary unknown field nested in a source is preserved after a successful parse", () => {
    fc.assert(
      fc.property(
        unknownKey(new Set(["id", "kind", "format", "ref"])),
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

  it("an arbitrary unknown field nested in a chart is preserved after a successful parse", () => {
    fc.assert(
      fc.property(
        unknownKey(new Set(["id", "type", "query", "encoding", "options"])),
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

  it("BakedDashboard: an arbitrary unknown top-level field is preserved after a successful parse", () => {
    fc.assert(
      fc.property(unknownKey(new Set(Object.keys(baseBaked()))), unknownValue, (key, value) => {
        const doc: Record<string, unknown> = { ...baseBaked(), [key]: value };
        const result = parseBakedDashboard(doc);
        expect(result.ok).toBe(true);
        if (result.ok) expect((result.value as Record<string, unknown>)[key]).toEqual(value);
      }),
    );
  });

  it("BakedDashboard: an arbitrary unknown field nested in meta is preserved after a successful parse", () => {
    fc.assert(
      fc.property(
        unknownKey(new Set(["title", "generatedAt", "sourceDataAsOf", "hyakkeiVersion"])),
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
        unknownKey(new Set(["id", "type", "encoding", "options", "rows"])),
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
