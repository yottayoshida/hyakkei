import { describe, expect, it } from "vitest";
import type { WorkspaceQuery } from "../intake/types.js";
import { canSave } from "./can-save.js";

// `satisfies WorkspaceQuery` (Codex test-adversarial review): an untyped
// local fixture can silently drift from the real `WorkspaceQuery` shape
// (intake/types.ts) without any test failing -- this pins the fixture to
// the actual type, so a future field added there forces this fixture to
// be updated too, rather than testing a shape that no longer exists.
function query(sql: string) {
  return {
    id: "q1",
    sourceTableId: "s1",
    builderState: { filters: [], groupBy: [], measures: [] },
    sql,
    previewRows: null,
    previewColumns: [],
    diagnostics: null,
    previewPending: false,
    previewError: null,
  } satisfies WorkspaceQuery;
}

describe("canSave", () => {
  it("allows saving when title is non-empty and every query has a compiled sql", () => {
    expect(canSave({ meta: { title: "月次KPI" }, queries: [query("SELECT 1")] })).toBeNull();
  });

  it("allows saving with zero queries", () => {
    expect(canSave({ meta: { title: "月次KPI" }, queries: [] })).toBeNull();
  });

  // issue #15/F7, V-018: `.trim()` alone is sufficient (shape enumeration
  // A10 confirmed U+3000 IDEOGRAPHIC SPACE is ECMA-262 WhiteSpace) -- no
  // custom regex needed, and this test pins that fact so a future
  // "improvement" doesn't add one unnecessarily.
  it.each([
    ["", "empty"],
    [" ", "ASCII space"],
    ["　", "U+3000 ideographic space"],
    ["\n", "newline"],
  ])("blocks with reason empty-title when title is %s (%s)", (title) => {
    expect(canSave({ meta: { title }, queries: [] })).toBe("empty-title");
  });

  it("does not block on a title with meaningful surrounding whitespace", () => {
    expect(canSave({ meta: { title: " 月次KPI " }, queries: [] })).toBeNull();
  });

  // V-016 (corrected rationale): a query whose last compile never
  // succeeded -- either fresh (handleAddQuery bootstrap) or drifted
  // (refreshQueryPreview's catch path clearing sql) -- blocks save.
  it("blocks with reason query-not-ready when any query has sql === ''", () => {
    expect(canSave({ meta: { title: "x" }, queries: [query("SELECT 1"), query("")] })).toBe(
      "query-not-ready",
    );
  });

  it("checks title before queries when both conditions are violated", () => {
    expect(canSave({ meta: { title: "" }, queries: [query("")] })).toBe("empty-title");
  });

  // issue #15/F7, Codex Round 1 P0: a query mid-recompile (builderState
  // already changed, sql not yet caught up) has a non-empty, STALE sql --
  // the sql-emptiness check alone cannot catch this drift window.
  it("blocks with reason query-not-ready when a query is previewPending, even with a non-empty (stale) sql", () => {
    const pendingQuery = { ...query("SELECT 1"), previewPending: true };
    expect(canSave({ meta: { title: "x" }, queries: [pendingQuery] })).toBe("query-not-ready");
  });

  it("allows saving once previewPending clears back to false", () => {
    const settledQuery = { ...query("SELECT 1"), previewPending: false };
    expect(canSave({ meta: { title: "x" }, queries: [settledQuery] })).toBeNull();
  });
});
