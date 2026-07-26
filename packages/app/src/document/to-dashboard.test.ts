import fc from "fast-check";
import { Dashboard, parseDashboard, Query, validateDashboardReferences } from "@hyakkei/schema";
import { describe, expect, it } from "vitest";
import type { WorkspaceSource } from "../App.js";
import type { WorkspaceQuery } from "../intake/types.js";
import { assertNoRuntimeKeys, RuntimeKeyLeakError } from "./assert-no-runtime-keys.js";
import { toDashboard } from "./to-dashboard.js";

function emptyBuilderState() {
  return { filters: [], groupBy: [], measures: [] };
}

function source(overrides: Partial<WorkspaceSource> = {}): WorkspaceSource {
  return {
    sourceLabel: "a.csv",
    sample: {
      table: { id: "s1", columns: [{ name: "a", type: "VARCHAR", category: "text" }], rowCount: 1 },
      rows: [{ a: "x" }],
      spec: { id: "s1", kind: "file", format: "csv", ref: { name: "a.csv" } },
    },
    typeOverrides: [],
    validation: new Map(),
    previewRows: null,
    previewPending: false,
    ...overrides,
  };
}

function query(overrides: Partial<WorkspaceQuery> = {}): WorkspaceQuery {
  return {
    id: "q1",
    sourceTableId: "s1",
    builderState: emptyBuilderState(),
    sql: "SELECT * FROM s1",
    previewRows: [{ a: "x" }],
    previewColumns: ["a"],
    diagnostics: null,
    previewPending: false,
    ...overrides,
  };
}

function minimalInput() {
  return {
    meta: { title: "月次KPI" },
    theme: {
      tokens: "@digital-go-jp/design-tokens@2.0.1" as const,
      palette: "guidebook-blue" as const,
    },
    sources: [source()],
    queries: [query()],
    charts: [
      { id: "c1", type: "bar" as const, query: "q1", encoding: { x: "a", y: "b" }, options: {} },
    ],
    layout: { grid: "guidebook-12col" as const, items: [{ chart: "c1", x: 0, y: 0, w: 6, h: 4 }] },
  };
}

describe("toDashboard", () => {
  it("projects a minimal editor state into a schema-valid Dashboard", () => {
    const result = toDashboard(minimalInput());
    const parsed = parseDashboard(result);
    expect(parsed.ok).toBe(true);
    expect(validateDashboardReferences(result)).toEqual([]);
  });

  it("omits typeOverrides on a source when the editor array is empty (yotta decision, shape enumeration R2)", () => {
    const result = toDashboard(minimalInput());
    expect(result.sources[0]).not.toHaveProperty("typeOverrides");
  });

  it("includes typeOverrides on a source when the editor array is non-empty", () => {
    const input = minimalInput();
    input.sources = [source({ typeOverrides: [{ column: "a", category: "text" }] })];
    const result = toDashboard(input);
    expect(result.sources[0]).toHaveProperty("typeOverrides", [{ column: "a", category: "text" }]);
  });

  it("projects a WorkspaceQuery's schema-known fields only (sourceTableId -> source)", () => {
    const result = toDashboard(minimalInput());
    expect(result.queries[0]).toEqual({
      id: "q1",
      source: "s1",
      sql: "SELECT * FROM s1",
      builderState: emptyBuilderState(),
    });
  });

  it("passes charts/layout through verbatim (identity, no re-literal)", () => {
    const input = minimalInput();
    const result = toDashboard(input);
    expect(result.charts).toBe(input.charts);
    expect(result.layout).toBe(input.layout);
  });

  it("passes meta/theme through as given", () => {
    const input = minimalInput();
    const result = toDashboard(input);
    expect(result.meta).toEqual({ title: "月次KPI" });
    expect(result.theme).toEqual({
      tokens: "@digital-go-jp/design-tokens@2.0.1",
      palette: "guidebook-blue",
    });
  });

  // issue #15/F7, V-005 (canary): the single most important property this
  // module exists for -- a real cell value must never reach the output,
  // regardless of how deeply the runtime state nests it.
  it("canary: a real cell value from sample.rows never reaches the projected document", () => {
    const CANARY = "PII-CANARY-\u{1F600}-42";
    const input = minimalInput();
    input.sources = [
      source({
        sample: {
          table: input.sources[0]!.sample.table,
          rows: [{ 氏名: CANARY }],
          spec: input.sources[0]!.sample.spec,
        },
      }),
    ];
    const result = toDashboard(input);
    expect(JSON.stringify(result)).not.toContain(CANARY);
  });

  // V-004 layer 1 (key-set coverage): if `Dashboard`'s own schema gains a
  // top-level field, this fails with a diff naming exactly which key is
  // missing -- not a passing test that silently stopped covering it.
  it("emits exactly Dashboard's known top-level keys -- no more, no fewer", () => {
    const result = toDashboard(minimalInput());
    expect(Object.keys(result).sort()).toEqual(Object.keys(Dashboard.properties).sort());
  });

  it("emits exactly Query's known keys per query -- no more, no fewer", () => {
    const result = toDashboard(minimalInput());
    expect(Object.keys(result.queries[0]!).sort()).toEqual(Object.keys(Query.properties).sort());
  });

  // fast-check property (V-006 replacement, Codex ② finding: this PR alone
  // cannot exercise fromDashboard(toDashboard(x)) round-tripping -- that
  // requires PR-2b's fromDashboard, tracked as V-049 there. What PR-1 CAN
  // pin: for arbitrary titles/sql, the projection always produces a
  // document that either parses successfully or is schema-invalid for a
  // reason unrelated to the projection itself (never throws, never
  // produces a document `assertNoRuntimeKeys` would reject).
  it("projects arbitrary meta.title/query.sql text without ever leaking a runtime key", () => {
    fc.assert(
      fc.property(fc.string(), fc.string({ minLength: 1 }), (title, sql) => {
        const input = minimalInput();
        input.meta = { title };
        input.queries = [query({ sql })];
        // Must not throw (assertNoRuntimeKeys would throw on a leak, not a
        // schema-invalid document -- an empty title/sql is schema-invalid,
        // not a leak, so this call must still succeed).
        const result = toDashboard(input);
        expect(result.meta.title).toBe(title);
        expect(result.queries[0]!.sql).toBe(sql);
      }),
    );
  });

  // issue #15/F7, Phase 6.5 audit (note 2): the property above only pins
  // "never throws" -- Codex ②'s actual revised V-006 ("projects into a
  // document that PASSES parseDashboard + validateDashboardReferences")
  // needs a non-empty-after-trim generator, since an empty/whitespace-only
  // title IS meant to fail schema validation (that's `canSave`'s job to
  // block before this point is ever reached).
  it("V-006 (Codex ② revision): arbitrary non-empty title/sql always projects into a document that passes parseDashboard + validateDashboardReferences", () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 1 }).filter((s) => s.trim() !== ""),
        fc.string({ minLength: 1 }),
        (title, sql) => {
          const input = minimalInput();
          input.meta = { title };
          input.queries = [query({ sql })];
          const result = toDashboard(input);
          expect(parseDashboard(result).ok).toBe(true);
          expect(validateDashboardReferences(result)).toEqual([]);
        },
      ),
    );
  });

  // issue #15/F7, Codex test-adversarial review: `toDashboard` deliberately
  // does NOT enforce `NonEmptyString` (empty title/sql) -- that's the
  // schema's job, not a second divergent rule set here (own doc comment).
  // This proves the other half of that contract: a document `toDashboard`
  // happily produces for an empty title/sql is actually rejected by
  // `parseDashboard`, so nothing downstream could mistake "toDashboard
  // didn't throw" for "this document is safe to save" -- `canSave` is the
  // thing standing between the two, and this is what it's protecting
  // against.
  it("an empty title/sql projects without throwing, but the result fails parseDashboard (toDashboard is not the validator)", () => {
    const emptyTitleInput = minimalInput();
    emptyTitleInput.meta = { title: "" };
    expect(parseDashboard(toDashboard(emptyTitleInput)).ok).toBe(false);

    const emptySqlInput = minimalInput();
    emptySqlInput.queries = [query({ sql: "" })];
    expect(parseDashboard(toDashboard(emptySqlInput)).ok).toBe(false);
  });

  // issue #15/F7, Codex test-adversarial review: the canary above hand-
  // builds a leaking document; this one simulates the ACTUAL regression
  // `to-dashboard.ts`'s own doc comment names as the risk -- someone
  // rewriting `projectSource`/`projectQuery` back to `{...source}`/
  // `{...query}`. Constructs a REAL `WorkspaceSource`/`WorkspaceQuery` (the
  // same shape `App.tsx` actually holds, runtime fields included) and
  // spreads each directly into a projected-shaped document, independent of
  // `toDashboard` itself -- proving `assertNoRuntimeKeys` alone would catch
  // that regression even if `toDashboard`'s own discipline lapsed.
  it("regression canary: spreading a real WorkspaceSource/WorkspaceQuery whole (the mistake toDashboard exists to prevent) is caught by assertNoRuntimeKeys", () => {
    const realSource = source({ typeOverrides: [{ column: "a", category: "text" }] });
    expect(() => assertNoRuntimeKeys({ sources: [{ ...realSource }] })).toThrow(
      RuntimeKeyLeakError,
    );

    const realQuery = query();
    expect(() => assertNoRuntimeKeys({ queries: [{ ...realQuery }] })).toThrow(RuntimeKeyLeakError);
  });
});
