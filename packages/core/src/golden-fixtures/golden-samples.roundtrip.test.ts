// issue #6/#10 acceptance: "both schemas validate the 3 sample dashboards
// (authoring form) and their baked outputs" is only true if the SAME 3
// samples are carried through both validators AND bake() in one pass --
// packages/schema's own dashboard.test.ts (S1-S3) and baked.test.ts (B1-B3)
// are independently hand-written fixtures, never connected by bake(), so
// neither proves this. This file is the single test that does: for each of
// the 3 `GOLDEN_SAMPLES`, authoring validation -> bake() -> baked validation,
// plus fixture-quality guards the schema itself cannot express (SQL text is
// deliberately opaque to the schema, `validate.ts`'s own AA-5 comment).
import { describe, expect, it } from "vitest";
import {
  formatParseFailure,
  parseBakedDashboard,
  parseDashboard,
  validateBakedDashboardReferences,
  validateDashboardReferences,
} from "@hyakkei/schema";
import { bake } from "../bake/bake.js";
import { GOLDEN_BAKE_META, GOLDEN_SAMPLES } from "./sample-dashboards.js";

/**
 * Every sample query is a single-table `SELECT ... FROM <table>` (no join,
 * no subquery) -- a name-only lint, not a SQL parser. It exists to catch
 * exactly the class of bug issue #10 found: a query's `FROM` target silently
 * drifting away from its own declared `source` id (schema validation can't
 * see this; DuckDB SQL text is opaque by design, AA-5).
 *
 * Known, accepted limitation (Codex Phase 6-B test-adversarial review; scope
 * refined by /code-review): this is a regex, not a tokenizer. A `FROM` token
 * inside a string literal or `--` comment would confuse it (either matching
 * the wrong text or missing the real one). A SUBQUERY is a stronger case,
 * not just "confusing" -- `.exec()` returns the FIRST FROM it can match
 * left-to-right, so `SELECT * FROM (SELECT * FROM inner) AS t` silently
 * returns `inner` (the subquery's own table), not the outer query's target,
 * with no error at all. Every sample's SQL is authored by a maintainer and
 * reviewed in the same PR that changes it (not user/LLM input), and the
 * file-purpose comment above documents the single-table constraint this
 * lint enforces -- hardening it into a real SQL parser is out of this PR's
 * scope (plan: SQL grammar correctness is a manual-review + Codex-review
 * concern, not a static-check one).
 */
const FROM_TABLE = /\bFROM\s+([A-Za-z_][A-Za-z0-9_]*)\b/i;

function extractFromTable(sql: string): string {
  const match = FROM_TABLE.exec(sql);
  if (!match?.[1]) {
    throw new Error(`could not find a FROM table in query SQL: ${sql}`);
  }
  return match[1];
}

describe("extractFromTable", () => {
  // Direct unit tests for the lint helper itself (Codex Phase 6-B: the 3
  // real fixtures' SQL is uniformly simple, so mutating this regex could
  // otherwise pass every per-sample test unnoticed).
  it("extracts the table name from a simple single-table query", () => {
    expect(extractFromTable("SELECT a, b FROM my_table")).toBe("my_table");
  });

  it("extracts the table name regardless of trailing GROUP BY/ORDER BY clauses", () => {
    expect(extractFromTable("SELECT a, COUNT(*) FROM my_table GROUP BY a ORDER BY a")).toBe(
      "my_table",
    );
  });

  it("is case-insensitive on the FROM keyword", () => {
    expect(extractFromTable("select a from my_table")).toBe("my_table");
  });

  it("throws when no FROM clause is present", () => {
    expect(() => extractFromTable("SELECT 1")).toThrow(/could not find a FROM table/);
  });
});

// Codex Round 1 P1: `describe.each(GOLDEN_SAMPLES)` below validates whatever
// is currently IN the registry, not that the registry still holds the 3
// named canonical exemplars the PR thesis is about -- an entry silently
// dropped or duplicated would shrink coverage without failing anything.
// Pinned here, once, independent of the per-sample tests.
it("GOLDEN_SAMPLES is exactly the 3 canonical exemplars (applications, budget, regional)", () => {
  expect(GOLDEN_SAMPLES.map((s) => s.id).sort()).toEqual(["applications", "budget", "regional"]);
});

it("the 3 samples have distinct titles (guards against a duplicated/misdirected JSON import)", () => {
  // Codex Phase 6-B: the id-pin test above only proves the 3 `GoldenSample.id`
  // wrapper strings are distinct, not that each actually loaded its own
  // fixture -- e.g. `import regionalDoc from "./budget.json"` under the
  // `"regional"` id would still pass that test. Titles come from the JSON
  // content itself, so this proves 3 genuinely different documents loaded.
  const titles = GOLDEN_SAMPLES.map((s) => s.doc.meta.title);
  expect(new Set(titles).size).toBe(titles.length);
});

describe.each(GOLDEN_SAMPLES)("golden sample '$id' round-trip", (sample) => {
  it("authoring form passes parseDashboard", () => {
    const result = parseDashboard(sample.doc);
    // formatParseFailure (not a hand-rolled JSON.stringify of the raw Ajv
    // errors, /code-review finding) so a real failure here reads the same
    // human-readable message goldenSample()'s own fail-fast throw produces.
    expect(result.ok, result.ok ? "" : formatParseFailure(result)).toBe(true);
  });

  it("authoring form has exactly the 7 schema keys (no rows/rowsByQuery leaked into the canonical exemplar)", () => {
    // QA (Phase 8): the authoring schema is additive (`removeAdditional:
    // false`, validate.ts), so `parseDashboard` alone would silently ACCEPT
    // a `rows`/`rowsByQuery` field copy-pasted in from a baked document --
    // exactly the mistake a future edit to these most-copied exemplars
    // (M4 gallery / issue #26 MCP contract) could make undetected.
    expect(Object.keys(sample.doc).sort()).toEqual([
      "charts",
      "layout",
      "meta",
      "queries",
      "sources",
      "theme",
      "version",
    ]);
  });

  it("authoring form has zero reference issues (dangling/duplicate/overlap/out-of-bounds/reserved-word)", () => {
    // The bug issue #10 found: every sample declared `sources: []` while its
    // queries referenced an undeclared source id -- 8 dangling issues total
    // across the 3 samples, invisible to golden-samples.test.ts because it
    // never calls this validator.
    expect(validateDashboardReferences(sample.doc)).toEqual([]);
  });

  it("every query's SQL FROM table matches that query's own declared source (fixture-lint, not a SQL parser)", () => {
    // Codex Phase 6-B: checking membership in the full `sources[]` set (not
    // the specific `query.source` each query declares) would pass a query
    // whose SQL silently points at a DIFFERENT declared source than the one
    // it's wired to -- a real drift class once a sample has 2+ sources.
    // None of today's 3 samples do, but the assertion should hold regardless.
    for (const query of sample.doc.queries) {
      const table = extractFromTable(query.sql);
      expect(
        table.toLowerCase(),
        `query '${query.id}' SQL references FROM '${table}', but its declared source is '${query.source}'`,
      ).toBe(query.source.toLowerCase());
    }
  });

  it("declares only file-kind sources (no url-kind seed samples)", () => {
    // Security requirement (Threat Model, /plan): a public seed sample with
    // a `url` source becomes an egress footprint once issue #7's PR-A2
    // (real DataSource.register()) lands. `file` sources never resolve over
    // the network -- this stays true even if a future gallery distributes
    // these documents in authoring form, not just baked.
    for (const source of sample.doc.sources) {
      expect(source.kind, `source '${source.id}' must be file-kind, not '${source.kind}'`).toBe(
        "file",
      );
    }
  });

  it("every chart is configured (has a query) and every query has matching rowsByQuery data", () => {
    // Codex Phase 6-B: a chart accidentally missing its `query` field is not
    // a schema error (`query` is optional, ADR-0005) -- `bake()` just drops
    // it and its layout item silently (bake.ts), so the "baked rows
    // non-empty" test below would never even see that chart. Pinning both
    // directions here (chart -> query, query -> rowsByQuery key) means a
    // future edit can't quietly lose a chart or leave stale/missing row data.
    for (const chart of sample.doc.charts) {
      expect(chart.query, `chart '${chart.id}' has no query configured`).toBeDefined();
    }
    const queryIds = sample.doc.queries.map((q) => q.id).sort();
    expect(Object.keys(sample.rowsByQuery).sort()).toEqual(queryIds);
  });

  // bake() is pure and deterministic (bake.ts's own doc comment), so the two
  // baked-output assertions below share one computed value instead of each
  // recomputing it (/simplify, efficiency finding).
  const baked = bake(sample.doc, sample.rowsByQuery, GOLDEN_BAKE_META);

  it("bakes into a schema-valid BakedDashboard with zero reference issues", () => {
    const result = parseBakedDashboard(baked);
    expect(result.ok, result.ok ? "" : formatParseFailure(result)).toBe(true);
    expect(validateBakedDashboardReferences(baked)).toEqual([]);
  });

  it("every configured chart's baked rows are non-empty", () => {
    // `lookupRows` (render-model.ts) returns `[]` on a query-id/rowsByQuery
    // key mismatch -- silently, not an error -- so a typo here would
    // otherwise only surface as an empty chart in a screenshot, not a test
    // failure. Every GOLDEN_SAMPLES chart is configured (all have `query`
    // set) and every query has non-empty rowsByQuery data, so 0 rows here
    // can only mean a key mismatch.
    for (const chart of baked.charts) {
      expect(chart.rows.length, `baked chart '${chart.id}' has 0 rows`).toBeGreaterThan(0);
    }
  });
});
