import {
  Bool,
  DateDay,
  Decimal,
  Dictionary,
  Float64,
  Int32,
  Int64,
  List,
  Null,
  TimestampMicrosecond,
  Utf8,
} from "apache-arrow";
import { describe, expect, it } from "vitest";
import {
  arrowTypeCategory,
  buildCastSampleSql,
  buildCastValidationSql,
  buildDateOffsetCheckSql,
  buildNumberPrecisionCheckSql,
  buildTypedPreviewSql,
  CAST_TARGET,
  type ColumnCategory,
} from "./column-types.js";

describe("arrowTypeCategory", () => {
  it("classifies integer/float/decimal Arrow types as number", () => {
    expect(arrowTypeCategory(new Int32())).toBe("number");
    expect(arrowTypeCategory(new Int64())).toBe("number");
    expect(arrowTypeCategory(new Float64())).toBe("number");
    expect(arrowTypeCategory(new Decimal(10, 2))).toBe("number");
  });

  it("classifies date/timestamp Arrow types as date", () => {
    expect(arrowTypeCategory(new DateDay())).toBe("date");
    expect(arrowTypeCategory(new TimestampMicrosecond())).toBe("date");
  });

  it("classifies utf8/bool/null Arrow types as text", () => {
    expect(arrowTypeCategory(new Utf8())).toBe("text");
    expect(arrowTypeCategory(new Bool())).toBe("text");
    expect(arrowTypeCategory(new Null())).toBe("text");
  });

  // PoC finding (2026-07-22): apache-arrow's own `tableFromArrays()`
  // dictionary-encodes plain string arrays by default -- Dictionary-wrapped
  // text is the COMMON case for a real query result's string columns, not a
  // theoretical edge case, so this recursion is load-bearing, not defensive.
  it("recurses through a Dictionary-encoded type to classify its inner value type", () => {
    expect(arrowTypeCategory(new Dictionary(new Utf8(), new Int32()))).toBe("text");
    expect(arrowTypeCategory(new Dictionary(new Int64(), new Int32()))).toBe("number");
  });

  it("classifies a non-scalar type (List/Struct/Binary/Time/Interval) as other -- no CAST_TARGET exists for these, so overriding is not offered rather than silently doing the wrong thing", () => {
    expect(arrowTypeCategory(new List(null as never))).toBe("other");
  });
});

describe("CAST_TARGET", () => {
  it("maps exactly the 3 user-facing categories to a fixed DuckDB type keyword", () => {
    expect(CAST_TARGET).toEqual({ text: "VARCHAR", number: "DOUBLE", date: "DATE" });
  });
});

describe("buildCastValidationSql", () => {
  it("quotes both the table id and the column, embeds only the CAST_TARGET keyword for the category", () => {
    const sql = buildCastValidationSql("t1", "amount", "number");
    expect(sql).toContain('"t1"');
    expect(sql).toContain('"amount"');
    expect(sql).toContain('TRY_CAST("amount" AS DOUBLE)');
    expect(sql).toContain("non_null_count");
    expect(sql).toContain("uncastable_count");
  });

  it("quotes an injection-shaped column name rather than embedding it raw (SEC-3/V-019)", () => {
    const sql = buildCastValidationSql("t1", 'a" ; DROP TABLE t1 --', "text");
    expect(sql).toContain('"a"" ; DROP TABLE t1 --"');
  });

  it("every valid category's SQL contains exactly its CAST_TARGET keyword", () => {
    for (const category of Object.keys(CAST_TARGET) as ColumnCategory[]) {
      const sql = buildCastValidationSql("t1", "col", category);
      expect(sql).toContain(`AS ${CAST_TARGET[category]}`);
    }
  });

  // SEC-1/SEC-2 (defense-in-depth), Codex review R1 (P0): the function's TS
  // signature already restricts `category` to the closed `ColumnCategory`
  // union, but this proves what happens if that were ever bypassed (a bug
  // upstream, or a value smuggled in via `as`) -- fails fast with a thrown
  // error BEFORE any SQL is built, rather than silently degrading to
  // `CAST(... AS undefined)` and letting DuckDB reject it at query time. A
  // malicious payload used as a category value therefore never reaches SQL
  // text in any form, including the string "undefined".
  it("a category value outside the closed union throws before any SQL is built, rather than degrading to 'AS undefined'", () => {
    const malicious = "INTEGER); DROP TABLE t1; --" as ColumnCategory;
    expect(() => buildCastValidationSql("t1", "col", malicious)).toThrow(/unknown column category/);
  });

  // Prototype-chain properties (`toString`, `constructor`, `hasOwnProperty`,
  // ...) all exist on `Object.prototype` -- an index/`in` check on
  // `CAST_TARGET` would resolve these to a function reference rather than
  // `undefined`, which could otherwise slip past a naive "is it undefined"
  // guard. `Object.hasOwn` closes that specific gap.
  it("a category value shaped like an Object.prototype member also throws, not silently resolving to a function reference", () => {
    const malicious = "toString" as ColumnCategory;
    expect(() => buildCastValidationSql("t1", "col", malicious)).toThrow(/unknown column category/);
  });
});

describe("buildCastSampleSql", () => {
  it("selects original/parsed pairs, excluding null originals, bounded by limit", () => {
    const sql = buildCastSampleSql("t1", "amount", "date", 5);
    expect(sql).toContain("AS original");
    expect(sql).toContain('TRY_CAST("amount" AS DATE) AS parsed');
    expect(sql).toContain("IS NOT NULL");
    expect(sql).toContain("LIMIT 5");
  });

  // Codex review (Phase 6-B): `buildCastValidationSql`'s own throw-on-unknown-
  // category test does NOT exercise this sibling builder -- each of the 3
  // builders calls `castTargetFor` independently, so a regression that
  // bypasses it in only ONE of them (e.g. this one) would otherwise go
  // undetected.
  it("a category value outside the closed union throws before any SQL is built", () => {
    const malicious = "INTEGER); DROP TABLE t1; --" as ColumnCategory;
    expect(() => buildCastSampleSql("t1", "col", malicious, 5)).toThrow(/unknown column category/);
  });
});

describe("buildTypedPreviewSql", () => {
  it("selects a non-overridden column verbatim, with no raw-alias entry", () => {
    const { sql, rawAliasFor } = buildTypedPreviewSql("t1", ["name"], new Map(), 5);
    expect(sql).toBe('SELECT "name" FROM "t1" LIMIT 5');
    expect(rawAliasFor.size).toBe(0);
  });

  it("casts an overridden column AND selects its raw value under a distinct alias, in the same query", () => {
    const overrides = new Map<string, ColumnCategory>([["amount", "number"]]);
    const { sql, rawAliasFor } = buildTypedPreviewSql("t1", ["amount"], overrides, 5);
    expect(sql).toContain('TRY_CAST("amount" AS DOUBLE) AS "amount"');
    expect(rawAliasFor.get("amount")).toBeDefined();
    expect(sql).toContain(`AS "${rawAliasFor.get("amount")}"`);
  });

  it("gives each overridden column a distinct alias, even across multiple overrides", () => {
    const overrides = new Map<string, ColumnCategory>([
      ["a", "number"],
      ["b", "date"],
    ]);
    const { rawAliasFor } = buildTypedPreviewSql("t1", ["a", "b"], overrides, 5);
    const aliases = [...rawAliasFor.values()];
    expect(new Set(aliases).size).toBe(aliases.length);
  });

  // Codex review R1 (P1): column names are arbitrary data, so the
  // index-derived candidate alias (`__hyakkei_raw_0__`) is not automatically
  // collision-free -- a real column can legally be named exactly that.
  it("adjusts the alias when a real column is literally named the same as the index-derived candidate alias", () => {
    const overrides = new Map<string, ColumnCategory>([["amount", "number"]]);
    const { sql, rawAliasFor } = buildTypedPreviewSql(
      "t1",
      ["amount", "__hyakkei_raw_0__"],
      overrides,
      5,
    );
    const alias = rawAliasFor.get("amount");
    expect(alias).not.toBe("__hyakkei_raw_0__");
    // Both the real column and the (adjusted) alias appear as distinct,
    // correctly-quoted identifiers -- neither was silently dropped/merged.
    expect(sql).toContain('"__hyakkei_raw_0__"');
    expect(sql).toContain(`"${alias}"`);
  });

  it("preserves mixed overridden/non-overridden columns in the original order", () => {
    const overrides = new Map<string, ColumnCategory>([["amount", "number"]]);
    const { sql } = buildTypedPreviewSql("t1", ["name", "amount", "date"], overrides, 3);
    expect(sql.indexOf('"name"')).toBeLessThan(sql.indexOf("TRY_CAST"));
    expect(sql).toContain('"date"');
    expect(sql).toContain("LIMIT 3");
  });

  // Codex review (Phase 6-B): the single-collision test above only proves
  // `uniqueRawAlias` appends ONE underscore successfully -- this proves the
  // `while` loop actually loops (not just an `if`) when the FIRST adjusted
  // candidate ALSO collides with a real column.
  it("keeps adjusting the alias through a chain of real columns that each collide with the previous candidate", () => {
    const overrides = new Map<string, ColumnCategory>([["amount", "number"]]);
    const { sql, rawAliasFor } = buildTypedPreviewSql(
      "t1",
      ["amount", "__hyakkei_raw_0__", "__hyakkei_raw_0___"],
      overrides,
      5,
    );
    const alias = rawAliasFor.get("amount");
    expect(alias).not.toBe("__hyakkei_raw_0__");
    expect(alias).not.toBe("__hyakkei_raw_0___");
    expect(sql).toContain('"__hyakkei_raw_0__"');
    expect(sql).toContain('"__hyakkei_raw_0___"');
    expect(sql).toContain(`"${alias}"`);
  });

  // Codex review (Phase 6-B): same sibling-builder gap as
  // `buildCastSampleSql`'s equivalent test above.
  it("a category value outside the closed union throws before any SQL is built", () => {
    const malicious = "INTEGER); DROP TABLE t1; --" as ColumnCategory;
    const overrides = new Map<string, ColumnCategory>([["col", malicious]]);
    expect(() => buildTypedPreviewSql("t1", ["col"], overrides, 5)).toThrow(
      /unknown column category/,
    );
  });
});

describe("buildNumberPrecisionCheckSql", () => {
  it("quotes both the table id and the column, and compares a HUGEINT round-trip through DOUBLE", () => {
    const sql = buildNumberPrecisionCheckSql("t1", "amount");
    expect(sql).toContain('"t1"');
    expect(sql).toContain('"amount"');
    expect(sql).toContain("precision_lossy_count");
  });

  // PoC finding (2026-07-22, via a real e2e run): a column DuckDB's own CSV
  // sniffer already typed as DATE/TIMESTAMP (or one overridden away from its
  // auto-detected category) has no registered direct cast to HUGEINT --
  // TRY_CAST(bare_column AS HUGEINT) threw a binder error, not a graceful
  // NULL, the first time this ran against real data. Every occurrence must
  // go through `CAST(... AS VARCHAR)` first, never the bare column.
  it("goes through CAST(... AS VARCHAR) before every HUGEINT/DOUBLE comparison, never casting the bare column directly", () => {
    const sql = buildNumberPrecisionCheckSql("t1", "amount");
    const text = 'CAST("amount" AS VARCHAR)';
    expect(sql).toContain(`TRY_CAST(${text} AS HUGEINT)`);
    expect(sql).toContain(`TRY_CAST(TRY_CAST(${text} AS DOUBLE) AS HUGEINT)`);
    expect(sql).not.toContain('TRY_CAST("amount" AS HUGEINT)');
    expect(sql).not.toContain('TRY_CAST("amount" AS DOUBLE)');
  });

  it("quotes an injection-shaped column name rather than embedding it raw", () => {
    const sql = buildNumberPrecisionCheckSql("t1", 'a" ; DROP TABLE t1 --');
    expect(sql).toContain('"a"" ; DROP TABLE t1 --"');
  });

  // QA finding (2026-07-22, via a live DuckDB-WASM run): `TRY_CAST('1200.5'
  // AS HUGEINT)` does not reject a fractional string -- it ROUNDS it, and
  // disagrees with the DOUBLE-cast path's own rounding at a `.5` tie
  // (round-half-away-from-zero vs. round-half-to-even), so an ordinary
  // decimal amount was incorrectly flagged as "precision lossy" despite
  // losing nothing. The `regexp_matches(..., '^-?[0-9]+$')` guard restricts
  // the round-trip comparison to bare integer literals only.
  it("gates the HUGEINT round-trip on the source text being integer-shaped, so an ordinary decimal never reaches the comparison", () => {
    const sql = buildNumberPrecisionCheckSql("t1", "amount");
    expect(sql).toContain("regexp_matches(CAST(\"amount\" AS VARCHAR), '^-?[0-9]+$')");
  });
});

describe("buildDateOffsetCheckSql", () => {
  it("quotes both the table id and the column, and matches an offset/Z suffix via regexp_matches", () => {
    const sql = buildDateOffsetCheckSql("t1", "created_at");
    expect(sql).toContain('"t1"');
    expect(sql).toContain('"created_at"');
    expect(sql).toContain("offset_discarded_count");
  });

  // Same PoC finding as `buildNumberPrecisionCheckSql` above: regexp_matches
  // requires a VARCHAR argument -- a bare native DATE/TIMESTAMP column threw
  // a binder error the first time this ran against real data.
  it("passes CAST(... AS VARCHAR) to regexp_matches, never the bare column", () => {
    const sql = buildDateOffsetCheckSql("t1", "created_at");
    expect(sql).toContain('regexp_matches(CAST("created_at" AS VARCHAR)');
    expect(sql).not.toContain('regexp_matches("created_at"');
    // The TRY_CAST(... AS DATE) freshness check still reads the bare column
    // (a real DATE/TIMESTAMP-cast, unlike regexp_matches, IS meant to reject
    // a non-date-shaped value here -- going through VARCHAR first would
    // widen what counts as castable).
    expect(sql).toContain('TRY_CAST("created_at" AS DATE)');
  });

  it("quotes an injection-shaped column name rather than embedding it raw", () => {
    const sql = buildDateOffsetCheckSql("t1", 'a" ; DROP TABLE t1 --');
    expect(sql).toContain('"a"" ; DROP TABLE t1 --"');
  });
});
