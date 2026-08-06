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

  it("every canonical chart carries substantive alternative text", () => {
    for (const chart of sample.doc.charts) {
      expect(chart.altText?.trim().length, `${sample.id}/${chart.id} altText`).toBeGreaterThan(0);
      expect(chart.altText).not.toBe(chart.options.title);
    }
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

// issue #124: the samples now carry the guidebook's Do-side meta fields, and
// they are the reference every MCP/agent caller copies (this directory's own
// framing). A summary that merely restates `description` would satisfy the
// schema, satisfy the footer, and teach the wrong thing -- p56 asks for
// 主要な指標や傾向を文章と数値で, which means actual figures from this
// dashboard's own data.
describe("golden samples carry substantive guidebook meta (issue #124)", () => {
  it.each(GOLDEN_SAMPLES)(
    "V-117: $id states an updated date, a source note and a summary",
    (sample) => {
      const { meta } = sample.doc;
      expect(meta.updatedAt, "updatedAt").toBeDefined();
      expect(meta.sourceNote, "sourceNote").toBeDefined();
      expect(meta.summary, "summary").toBeDefined();
    },
  );

  it.each(GOLDEN_SAMPLES)("$id's summary is not a restatement of description", (sample) => {
    const { summary, description } = sample.doc.meta;
    expect(summary).not.toBe(description);
    // A length floor rather than a similarity metric: the failure being
    // guarded against is a one-line paraphrase, and `description` is already
    // that line. Not a "count of characters is quality" claim -- just enough
    // to make the paraphrase shape fail.
    expect(summary!.length).toBeGreaterThan(description!.length);
  });

  it.each(GOLDEN_SAMPLES)("$id's summary quotes figures that exist in its own rows", (sample) => {
    // The substance check. Every number in the summary must appear in the
    // sample's resolved rows, so a plausible-sounding summary invented
    // without reading the data fails here rather than shipping as the
    // reference other people copy.
    const rowNumbers = new Set<string>();
    for (const rows of Object.values(sample.rowsByQuery)) {
      for (const row of rows) {
        for (const value of Object.values(row)) {
          if (typeof value === "number") rowNumbers.add(String(value));
        }
      }
    }
    // Calendar references are dropped before extracting figures: a month
    // appears in the rows as part of a string ("令和8年4月"), not as a number,
    // so "4月" would otherwise read as an uncited figure.
    const quoted =
      (sample.doc.meta.summary ?? "")
        .replace(/,/g, "")
        .replace(/(令和|平成)?\d+\s*(年度|年|月|日)/g, "")
        .match(/\d+(?:\.\d+)?/g) ?? [];
    expect(quoted.length, "summary quotes no figures at all").toBeGreaterThan(2);
    for (const n of quoted) {
      expect(rowNumbers, `summary cites ${n}, which is in no row of ${sample.id}`).toContain(n);
    }
  });

  it.each(GOLDEN_SAMPLES)("$id's meta values do not repeat their own footer label", (sample) => {
    // The footer renders 「出典: {sourceNote}」, so a note that opens with 出典:
    // shows as 「出典: 出典: …」. Caught by looking at the rendered page, not by
    // any assertion — the tests read each field on its own, where the value is
    // correct in isolation. Pinned here because the next person writing a
    // sample has the same instinct to make the field self-describing.
    const { sourceNote, updatedAt, summary } = sample.doc.meta;
    for (const [field, value] of Object.entries({ sourceNote, updatedAt, summary })) {
      if (value === undefined) continue;
      for (const label of ["出典", "更新日", "データ時点", "作成", "作成ツール"]) {
        expect(value.startsWith(`${label}:`), `${field} starts with the "${label}" label`).toBe(
          false,
        );
        expect(value.startsWith(`${label}：`), `${field} starts with the "${label}" label`).toBe(
          false,
        );
      }
    }
  });

  it.each(GOLDEN_SAMPLES)(
    "$id's declared update date precedes the bake that froze it",
    (sample) => {
      // The footer draws 更新日 (the author's claim about the upstream data) next
      // to データ時点 and 作成 (what bake() recorded). ADR-0019 keeps them as
      // separate fields precisely because they mean different things — which
      // makes an ordering they cannot have the sharpest way to teach the wrong
      // thing. Data updated after the artifact was generated is not a late
      // number, it is an impossible one.
      //
      // Caught in review: all three samples shipped an `updatedAt` months AFTER
      // `GOLDEN_BAKE_META.generatedAt`, and every other assertion here passed.
      const { updatedAt } = sample.doc.meta;
      if (updatedAt === undefined) return;
      expect(updatedAt <= GOLDEN_BAKE_META.sourceDataAsOf, `${updatedAt} vs sourceDataAsOf`).toBe(
        true,
      );
      expect(
        updatedAt <= GOLDEN_BAKE_META.generatedAt.slice(0, 10),
        `${updatedAt} vs generatedAt`,
      ).toBe(true);
    },
  );

  it.each(GOLDEN_SAMPLES)("$id's summary does not call a non-maximum the maximum", (sample) => {
    // A numeral-membership check cannot see this class: every figure in the
    // claim can be real while the claim about them is false. Caught in review
    // — `regional` named the second-largest population as the largest and
    // omitted the largest entirely, with all four figures present in the rows.
    const summary = (sample.doc.meta.summary ?? "").replace(/,/g, "");
    if (!/最大|最多|最も多い/.test(summary)) return;

    // Whole numeric tokens, not substrings: `includes("10")` matches inside
    // 「210,000」 and inside a date, which reports figures the summary never
    // cited. (Seen on the first run of this test — it failed on `markerSize`
    // 10 found inside the population figure 210000.)
    const cited = new Set(summary.match(/\d+(?:\.\d+)?/g) ?? []);

    for (const [queryId, rows] of Object.entries(sample.rowsByQuery)) {
      const columns = new Set(rows.flatMap((row) => Object.keys(row)));
      for (const column of columns) {
        const values = rows
          .map((row) => row[column])
          .filter((v): v is number => typeof v === "number");
        if (values.length < 2) continue;
        const quoted = values.filter((v) => cited.has(String(v)));
        if (quoted.length === 0) continue;
        const max = Math.max(...values);
        expect(
          Math.max(...quoted),
          `${sample.id}: the summary claims a maximum from ${queryId}.${column} but never mentions ${max}`,
        ).toBe(max);
      }
    }
  });

  it.each(GOLDEN_SAMPLES)("$id's source note names the file it came from", (sample) => {
    // Ties the citation to something checkable: the guidebook (p41) asks for
    // データのソース, and the sample's own `sources[].ref` is the only source
    // fact this repo actually holds.
    const names = sample.doc.sources.map((s) => (s.kind === "file" ? s.ref.name : s.ref.url));
    expect(names.some((name) => sample.doc.meta.sourceNote!.includes(name))).toBe(true);
  });
});
