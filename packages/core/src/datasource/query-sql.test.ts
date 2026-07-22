import { describe, expect, it } from "vitest";
import type { BuilderState, FilterCondition, FilterOperator, Measure } from "@hyakkei/schema";
import type { ColumnCategory } from "./column-types.js";
import { buildQueryDiagnosticsSql, buildQueryPreviewSql, buildQuerySql } from "./query-sql.js";
import type { ColumnMeta } from "./types.js";

function columnMeta(overrides: Partial<ColumnMeta>[] = []): ColumnMeta[] {
  const defaults: ColumnMeta[] = [
    { name: "name", type: "Utf8", category: "text" },
    { name: "amount", type: "Utf8", category: "text" },
    { name: "created_at", type: "Date32<DAY>", category: "date" },
    { name: "tags", type: "List<Utf8>", category: "other" },
  ];
  return overrides.length > 0 ? (overrides as ColumnMeta[]) : defaults;
}

function emptyState(): BuilderState {
  return { filters: [], groupBy: [], measures: [] };
}

function filter(column: string, operator: FilterOperator, value?: string): FilterCondition {
  return value === undefined ? { column, operator } : { column, operator, value };
}

function measure(column: string, aggregate: Measure["aggregate"]): Measure {
  return { column, aggregate };
}

const noOverrides = new Map<string, ColumnCategory>();

describe("buildQuerySql: degenerate/empty builderState shapes", () => {
  it("all three arrays empty compiles to SELECT * FROM t (shape enumeration R1/G1)", () => {
    const sql = buildQuerySql("t1", emptyState(), columnMeta(), noOverrides);
    expect(sql).toBe('SELECT * FROM "t1"');
  });

  it("measures with zero groupBy emits a single-row total, with NO GROUP BY clause", () => {
    const state: BuilderState = {
      filters: [],
      groupBy: [],
      measures: [measure("amount", "count")],
    };
    const sql = buildQuerySql("t1", state, columnMeta(), noOverrides);
    expect(sql).not.toContain("GROUP BY");
    expect(sql).toContain('COUNT("amount")');
  });

  it("groupBy with zero measures re-selects just the groupBy columns, no aggregate", () => {
    const state: BuilderState = { filters: [], groupBy: ["name"], measures: [] };
    const sql = buildQuerySql("t1", state, columnMeta(), noOverrides);
    expect(sql).toContain('GROUP BY "name"');
    expect(sql).toContain('SELECT "name" AS "name" FROM');
  });

  it("filters-only (no groupBy/measures) applies WHERE but still selects *", () => {
    const state: BuilderState = { filters: [filter("name", "eq", "x")], groupBy: [], measures: [] };
    const sql = buildQuerySql("t1", state, columnMeta(), noOverrides);
    expect(sql).toContain("SELECT * FROM");
    expect(sql).toContain("WHERE");
  });

  it("groupBy + measures together is the canonical pivot shape", () => {
    const state: BuilderState = {
      filters: [],
      groupBy: ["name"],
      measures: [measure("amount", "count")],
    };
    const sql = buildQuerySql("t1", state, columnMeta(), noOverrides);
    expect(sql).toBe(
      'SELECT "name" AS "name", COUNT("amount") AS "count_amount" FROM "t1" GROUP BY "name"',
    );
  });
});

describe("buildQuerySql: filter operators", () => {
  it.each<[FilterOperator, string]>([
    ["eq", "="],
    ["ne", "<>"],
    ["lt", "<"],
    ["lte", "<="],
    ["gt", ">"],
    ["gte", ">="],
  ])(
    "compiles %s to SQL operator %s against a number-overridden column",
    (operator, expectedOp) => {
      const overrides = new Map<string, ColumnCategory>([["amount", "number"]]);
      const state: BuilderState = {
        filters: [filter("amount", operator, "100")],
        groupBy: [],
        measures: [],
      };
      const sql = buildQuerySql("t1", state, columnMeta(), overrides);
      expect(sql).toContain(`TRY_CAST("amount" AS DOUBLE) ${expectedOp} TRY_CAST('100' AS DOUBLE)`);
    },
  );

  it("is_null/is_not_null need no value and compile without a comparison literal", () => {
    const isNull = buildQuerySql(
      "t1",
      { filters: [filter("name", "is_null")], groupBy: [], measures: [] },
      columnMeta(),
      noOverrides,
    );
    expect(isNull).toContain('"name" IS NULL');
    const isNotNull = buildQuerySql(
      "t1",
      { filters: [filter("name", "is_not_null")], groupBy: [], measures: [] },
      columnMeta(),
      noOverrides,
    );
    expect(isNotNull).toContain('"name" IS NOT NULL');
  });

  it("throws before any SQL is built for an out-of-union operator (castTargetFor-shaped defense-in-depth)", () => {
    const malicious = "eq); DROP TABLE t1; --" as FilterOperator;
    const state: BuilderState = {
      filters: [filter("name", malicious, "x")],
      groupBy: [],
      measures: [],
    };
    expect(() => buildQuerySql("t1", state, columnMeta(), noOverrides)).toThrow(
      /unknown filter operator/,
    );
  });

  it("a category value shaped like an Object.prototype member also throws, not silently resolving to a function reference", () => {
    const malicious = "toString" as FilterOperator;
    const state: BuilderState = {
      filters: [filter("name", malicious, "x")],
      groupBy: [],
      measures: [],
    };
    expect(() => buildQuerySql("t1", state, columnMeta(), noOverrides)).toThrow(
      /unknown filter operator/,
    );
  });

  it("multiple filter conditions combine with AND only", () => {
    const state: BuilderState = {
      filters: [filter("name", "eq", "x"), filter("amount", "eq", "y")],
      groupBy: [],
      measures: [],
    };
    const sql = buildQuerySql("t1", state, columnMeta(), noOverrides);
    expect(sql).toContain(" AND ");
    expect(sql).not.toContain(" OR ");
  });
});

describe("buildQuerySql: value handling (shape enumeration G4)", () => {
  it("value: undefined for a value-requiring operator drops the condition entirely (incomplete, not yet applied)", () => {
    const state: BuilderState = { filters: [filter("name", "eq")], groupBy: [], measures: [] };
    const sql = buildQuerySql("t1", state, columnMeta(), noOverrides);
    expect(sql).not.toContain("WHERE");
  });

  it("value: '' (empty string) is a complete, meaningful condition -- distinct from undefined", () => {
    const state: BuilderState = { filters: [filter("name", "eq", "")], groupBy: [], measures: [] };
    const sql = buildQuerySql("t1", state, columnMeta(), noOverrides);
    expect(sql).toContain("WHERE");
    expect(sql).toContain("''");
  });
});

describe("buildQuerySql: contains/not_contains LIKE wildcard escaping (shape enumeration G6)", () => {
  it("escapes % and _ in the value and pairs LIKE with an explicit ESCAPE clause", () => {
    const state: BuilderState = {
      filters: [filter("name", "contains", "50%_off")],
      groupBy: [],
      measures: [],
    };
    const sql = buildQuerySql("t1", state, columnMeta(), noOverrides);
    expect(sql).toContain("LIKE '%50\\%\\_off%' ESCAPE '\\'");
  });

  it("not_contains compiles to NOT LIKE with the same escaping", () => {
    const state: BuilderState = {
      filters: [filter("name", "not_contains", "100%")],
      groupBy: [],
      measures: [],
    };
    const sql = buildQuerySql("t1", state, columnMeta(), noOverrides);
    expect(sql).toContain("NOT LIKE '%100\\%%' ESCAPE '\\'");
  });

  // Codex test-adversarial review finding: the two tests above only cover
  // %/_ individually -- a value containing BOTH a literal backslash and a
  // literal single quote exercises the composition of two independent
  // escaping passes (`likePatternLiteral`'s backslash-doubling, then
  // `quoteStringLiteral`'s quote-doubling): backslash-escaping must run
  // FIRST so the later quote-doubling pass never needs to (and doesn't)
  // touch the already-doubled backslashes.
  it("escapes a value containing both a literal backslash and a literal single quote, composing LIKE-escaping with SQL string-literal escaping", () => {
    const state: BuilderState = {
      filters: [filter("name", "contains", "a\\b'c")],
      groupBy: [],
      measures: [],
    };
    const sql = buildQuerySql("t1", state, columnMeta(), noOverrides);
    expect(sql).toContain("LIKE '%a\\\\b''c%' ESCAPE '\\'");
  });
});

describe("buildQuerySql: TRY_CAST application (RR-2 resolution) at every position", () => {
  const overrides = new Map<string, ColumnCategory>([["amount", "number"]]);

  it("WHERE position: an overridden column's filter is TRY_CAST-wrapped", () => {
    const state: BuilderState = {
      filters: [filter("amount", "gt", "100")],
      groupBy: [],
      measures: [],
    };
    const sql = buildQuerySql("t1", state, columnMeta(), overrides);
    expect(sql).toContain('TRY_CAST("amount" AS DOUBLE)');
  });

  it("GROUP BY position: an overridden column used as a dimension is TRY_CAST-wrapped", () => {
    const state: BuilderState = { filters: [], groupBy: ["amount"], measures: [] };
    const sql = buildQuerySql("t1", state, columnMeta(), overrides);
    expect(sql).toContain('GROUP BY TRY_CAST("amount" AS DOUBLE)');
  });

  it("sum/avg measure argument: an overridden column is TRY_CAST-wrapped inside the aggregate", () => {
    const state: BuilderState = { filters: [], groupBy: [], measures: [measure("amount", "sum")] };
    const sql = buildQuerySql("t1", state, columnMeta(), overrides);
    expect(sql).toContain('SUM(TRY_CAST("amount" AS DOUBLE))');
  });

  it("a column with NO active override stays a bare reference (native type is already correct)", () => {
    const numericMeta = columnMeta([{ name: "amount", type: "Int64", category: "number" }]);
    const state: BuilderState = { filters: [], groupBy: [], measures: [measure("amount", "sum")] };
    const sql = buildQuerySql("t1", state, numericMeta, noOverrides);
    expect(sql).toContain('SUM("amount")');
    expect(sql).not.toContain("TRY_CAST");
  });

  // QA Phase 8 finding, confirmed via live DuckDB-WASM: a NATIVE
  // BOOLEAN/NULL column is auto-detected as `"text"` category
  // (`arrowTypeCategory`'s display-only bucketing, issue 11b) but is NOT
  // actually VARCHAR at the SQL level. A bare `"flag" = ''` throws
  // `Conversion Error: Could not convert string '' to BOOL`, and
  // `"flag" LIKE ...` throws a `like_escape` Binder Error -- both silently
  // swallowed by App.tsx's catch, leaving a STALE, unfiltered result
  // displayed as if the filter had been applied. A "text"-category filter
  // COMPARISON (not is_null/is_not_null, which needs no cast) always wraps
  // the column in `TRY_CAST(... AS VARCHAR)`, even with no active override
  // -- unlike every other category, where a no-override column stays bare.
  it("text-category filter COMPARISONS always TRY_CAST the column to VARCHAR, even with no active override (a native BOOLEAN/NULL column auto-detects as 'text' but isn't actually VARCHAR)", () => {
    const state: BuilderState = { filters: [filter("name", "eq", "x")], groupBy: [], measures: [] };
    const sql = buildQuerySql("t1", state, columnMeta(), noOverrides);
    expect(sql).toContain(`TRY_CAST("name" AS VARCHAR) = 'x'`);
  });

  it("text-category contains/not_contains ALSO TRY_CAST the column to VARCHAR, even with no active override", () => {
    const state: BuilderState = {
      filters: [filter("name", "contains", "x")],
      groupBy: [],
      measures: [],
    };
    const sql = buildQuerySql("t1", state, columnMeta(), noOverrides);
    expect(sql).toContain(`TRY_CAST("name" AS VARCHAR) LIKE`);
  });

  it("text-category is_null/is_not_null do NOT need a VARCHAR cast (nullity is type-independent)", () => {
    const state: BuilderState = { filters: [filter("name", "is_null")], groupBy: [], measures: [] };
    const sql = buildQuerySql("t1", state, columnMeta(), noOverrides);
    expect(sql).toContain('"name" IS NULL');
    expect(sql).not.toContain("TRY_CAST");
  });
});

describe("buildQuerySql: count bypasses typedColumnRef (Codex plan review finding)", () => {
  it("count on an overridden column counts the RAW column, not the TRY_CAST'd one", () => {
    const overrides = new Map<string, ColumnCategory>([["amount", "number"]]);
    const state: BuilderState = {
      filters: [],
      groupBy: [],
      measures: [measure("amount", "count")],
    };
    const sql = buildQuerySql("t1", state, columnMeta(), overrides);
    expect(sql).toContain('COUNT("amount")');
    expect(sql).not.toContain("TRY_CAST");
  });
});

describe("buildQuerySql: sum/avg category gate (shape enumeration G5)", () => {
  it("sum/avg on an 'other'-categoried column (never override-eligible) is silently dropped, not emitted", () => {
    const state: BuilderState = { filters: [], groupBy: [], measures: [measure("tags", "sum")] };
    const sql = buildQuerySql("t1", state, columnMeta(), noOverrides);
    expect(sql).not.toContain("tags");
    expect(sql).toBe('SELECT * FROM "t1"');
  });

  it("sum/avg on a date-categoried column (native or overridden) is silently dropped, not emitted", () => {
    const state: BuilderState = {
      filters: [],
      groupBy: [],
      measures: [measure("created_at", "avg")],
    };
    const sql = buildQuerySql("t1", state, columnMeta(), noOverrides);
    expect(sql).not.toContain("created_at");
  });

  it("count is still offered for a non-number column (Excel-parity: count doesn't need numeric validity)", () => {
    const state: BuilderState = { filters: [], groupBy: [], measures: [measure("tags", "count")] };
    const sql = buildQuerySql("t1", state, columnMeta(), noOverrides);
    expect(sql).toContain('COUNT("tags")');
  });
});

describe("buildQuerySql: dangling column references (shape enumeration A3)", () => {
  it("a filter referencing a nonexistent column is silently dropped, never emitted as a binder-crashing reference", () => {
    const state: BuilderState = {
      filters: [filter("ghost", "eq", "x")],
      groupBy: [],
      measures: [],
    };
    const sql = buildQuerySql("t1", state, columnMeta(), noOverrides);
    expect(sql).not.toContain("ghost");
    expect(sql).toBe('SELECT * FROM "t1"');
  });

  it("a groupBy referencing a nonexistent column is silently dropped", () => {
    const state: BuilderState = { filters: [], groupBy: ["ghost"], measures: [] };
    const sql = buildQuerySql("t1", state, columnMeta(), noOverrides);
    expect(sql).not.toContain("ghost");
  });

  it("a measure referencing a nonexistent column is silently dropped", () => {
    const state: BuilderState = { filters: [], groupBy: [], measures: [measure("ghost", "count")] };
    const sql = buildQuerySql("t1", state, columnMeta(), noOverrides);
    expect(sql).not.toContain("ghost");
  });

  // Codex review R1 (P0): a dangling column being silently dropped must not
  // become an excuse to skip validating the OTHER field on the same entry --
  // an out-of-union operator/aggregate throws regardless of whether the
  // entry would have been usable anyway.
  it("a filter with BOTH a dangling column AND an out-of-union operator still throws (fail-fast is not bypassed by the drop path)", () => {
    const malicious = "eq); DROP TABLE t1; --" as FilterOperator;
    const state: BuilderState = {
      filters: [filter("ghost", malicious, "x")],
      groupBy: [],
      measures: [],
    };
    expect(() => buildQuerySql("t1", state, columnMeta(), noOverrides)).toThrow(
      /unknown filter operator/,
    );
  });

  it("a measure with BOTH a dangling column AND an out-of-union aggregate still throws", () => {
    const malicious = "sum); DROP TABLE t1; --" as Measure["aggregate"];
    const state: BuilderState = {
      filters: [],
      groupBy: [],
      measures: [measure("ghost", malicious)],
    };
    expect(() => buildQuerySql("t1", state, columnMeta(), noOverrides)).toThrow(
      /unknown aggregate function/,
    );
  });

  it("a measure with BOTH an 'other'-categoried column AND an out-of-union aggregate still throws", () => {
    const malicious = "avg); DROP TABLE t1; --" as Measure["aggregate"];
    const state: BuilderState = {
      filters: [],
      groupBy: [],
      measures: [measure("tags", malicious)],
    };
    expect(() => buildQuerySql("t1", state, columnMeta(), noOverrides)).toThrow(
      /unknown aggregate function/,
    );
  });
});

describe("buildQuerySql: groupBy dedup (shape enumeration A9)", () => {
  it("a duplicate groupBy column is deduplicated, order-preserving", () => {
    const state: BuilderState = { filters: [], groupBy: ["name", "amount", "name"], measures: [] };
    const sql = buildQuerySql("t1", state, columnMeta(), noOverrides);
    expect(sql).toBe(
      'SELECT "name" AS "name", "amount" AS "amount" FROM "t1" GROUP BY "name", "amount"',
    );
  });
});

describe("buildQuerySql: measure alias collisions (shape enumeration G2, confirmed via live DuckDB-WASM PoC)", () => {
  it("a measure alias colliding with a REAL column name is uniquified", () => {
    const meta = columnMeta([
      { name: "amount", type: "Int64", category: "number" },
      { name: "count_amount", type: "Utf8", category: "text" },
    ]);
    const state: BuilderState = {
      filters: [],
      groupBy: [],
      measures: [measure("amount", "count")],
    };
    const sql = buildQuerySql("t1", state, meta, noOverrides);
    expect(sql).toContain('AS "count_amount_"');
  });

  it("a measure alias colliding with a groupBy column is uniquified", () => {
    const meta = columnMeta([
      { name: "amount", type: "Int64", category: "number" },
      { name: "count_amount", type: "Utf8", category: "text" },
    ]);
    const state: BuilderState = {
      filters: [],
      groupBy: ["count_amount"],
      measures: [measure("amount", "count")],
    };
    const sql = buildQuerySql("t1", state, meta, noOverrides);
    expect(sql).toContain('GROUP BY "count_amount"');
    expect(sql).toContain('AS "count_amount_"');
  });

  it("two measures whose default aliases collide with each other get distinct aliases", () => {
    const meta = columnMeta([{ name: "amount", type: "Int64", category: "number" }]);
    const state: BuilderState = {
      filters: [],
      groupBy: [],
      measures: [measure("amount", "count"), measure("amount", "count")],
    };
    const sql = buildQuerySql("t1", state, meta, noOverrides);
    const aliasMatches = [...sql.matchAll(/AS "(count_amount_?)"/g)].map((m) => m[1]);
    expect(new Set(aliasMatches).size).toBe(2);
  });

  it("different aggregates on the same column produce distinct, non-colliding aliases (sum_amount vs avg_amount)", () => {
    const meta = columnMeta([{ name: "amount", type: "Int64", category: "number" }]);
    const state: BuilderState = {
      filters: [],
      groupBy: [],
      measures: [measure("amount", "sum"), measure("amount", "avg")],
    };
    const sql = buildQuerySql("t1", state, meta, noOverrides);
    expect(sql).toContain('AS "sum_amount"');
    expect(sql).toContain('AS "avg_amount"');
  });
});

describe("buildQuerySql: identifier injection safety", () => {
  it("quotes an injection-shaped column name in a filter rather than embedding it raw", () => {
    const meta = columnMeta([{ name: 'a" ; DROP TABLE t1 --', type: "Utf8", category: "text" }]);
    const state: BuilderState = {
      filters: [filter('a" ; DROP TABLE t1 --', "eq", "x")],
      groupBy: [],
      measures: [],
    };
    const sql = buildQuerySql("t1", state, meta, noOverrides);
    expect(sql).toContain('"a"" ; DROP TABLE t1 --"');
  });

  it("quotes an injection-shaped filter value via quoteStringLiteral, never embedding it raw", () => {
    const state: BuilderState = {
      filters: [filter("name", "eq", "x'; DROP TABLE t1; --")],
      groupBy: [],
      measures: [],
    };
    const sql = buildQuerySql("t1", state, columnMeta(), noOverrides);
    expect(sql).toContain("'x''; DROP TABLE t1; --'");
  });

  it("quotes an injection-shaped tableId rather than embedding it raw", () => {
    const sql = buildQuerySql('t1" ; DROP TABLE t1 --', emptyState(), columnMeta(), noOverrides);
    expect(sql).toContain('"t1"" ; DROP TABLE t1 --"');
  });

  it("quotes an injection-shaped groupBy column name rather than embedding it raw", () => {
    const meta = columnMeta([{ name: 'g" ; DROP TABLE t1 --', type: "Utf8", category: "text" }]);
    const state: BuilderState = { filters: [], groupBy: ['g" ; DROP TABLE t1 --'], measures: [] };
    const sql = buildQuerySql("t1", state, meta, noOverrides);
    expect(sql).toContain('"g"" ; DROP TABLE t1 --"');
  });

  it("quotes an injection-shaped measure column name rather than embedding it raw", () => {
    const meta = columnMeta([{ name: 'm" ; DROP TABLE t1 --', type: "Int64", category: "number" }]);
    const state: BuilderState = {
      filters: [],
      groupBy: [],
      measures: [measure('m" ; DROP TABLE t1 --', "sum")],
    };
    const sql = buildQuerySql("t1", state, meta, noOverrides);
    expect(sql).toContain('"m"" ; DROP TABLE t1 --"');
  });
});

describe("buildQueryPreviewSql", () => {
  it("appends LIMIT to the persisted query, in its own dedicated function", () => {
    const sql = buildQueryPreviewSql("t1", emptyState(), columnMeta(), noOverrides, 50);
    expect(sql).toBe('SELECT * FROM "t1" LIMIT 50');
  });
});

describe("buildQueryDiagnosticsSql", () => {
  it("always includes total_count and matched_count", () => {
    const sql = buildQueryDiagnosticsSql("t1", emptyState(), columnMeta(), noOverrides);
    expect(sql).toContain("COUNT(*) AS total_count");
    expect(sql).toContain("matched_count");
  });

  it("includes a filter-value-invalid check only for number/date filters with a comparison value (shape enumeration G3)", () => {
    const overrides = new Map<string, ColumnCategory>([["amount", "number"]]);
    const state: BuilderState = {
      filters: [filter("amount", "gt", "abc")],
      groupBy: [],
      measures: [],
    };
    const sql = buildQueryDiagnosticsSql("t1", state, columnMeta(), overrides);
    expect(sql).toContain('"filter_0_value_invalid"');
    expect(sql).toContain("IS NULL");
  });

  it("does not include a value-invalid check for a text filter (no typed-value parsing risk)", () => {
    const state: BuilderState = {
      filters: [filter("name", "eq", "abc")],
      groupBy: [],
      measures: [],
    };
    const sql = buildQueryDiagnosticsSql("t1", state, columnMeta(), noOverrides);
    expect(sql).not.toContain("value_invalid");
  });

  it("does not include a value-invalid check for is_null/is_not_null or contains/not_contains", () => {
    const overrides = new Map<string, ColumnCategory>([["amount", "number"]]);
    const state: BuilderState = {
      filters: [filter("amount", "is_null"), filter("name", "contains", "x")],
      groupBy: [],
      measures: [],
    };
    const sql = buildQueryDiagnosticsSql("t1", state, columnMeta(), overrides);
    expect(sql).not.toContain("value_invalid");
  });

  it("includes an excluded_count diagnostic for sum/avg measures, not for count", () => {
    const overrides = new Map<string, ColumnCategory>([["amount", "number"]]);
    const state: BuilderState = {
      filters: [],
      groupBy: [],
      measures: [measure("amount", "sum"), measure("amount", "count")],
    };
    const sql = buildQueryDiagnosticsSql("t1", state, columnMeta(), overrides);
    expect(sql).toContain('"amount_excluded_count"');
    expect(sql.match(/excluded_count/g)?.length).toBe(1);
  });

  // Codex review R1 (P1): the excluded-count check must only count rows
  // that WOULD have contributed to the aggregate in the first place -- a row
  // the WHERE clause already excludes must not ALSO be blamed on a cast
  // failure, which would double up two independent, already-correct
  // exclusion reasons into one misleading number.
  it("scopes the excluded_count check to rows the active WHERE filter would keep, not the whole table", () => {
    const overrides = new Map<string, ColumnCategory>([["amount", "number"]]);
    const state: BuilderState = {
      filters: [filter("name", "eq", "keep-me")],
      groupBy: [],
      measures: [measure("amount", "sum")],
    };
    const sql = buildQueryDiagnosticsSql("t1", state, columnMeta(), overrides);
    const match = sql.match(/COUNT\(\*\) FILTER \(WHERE (.+?)\) AS "amount_excluded_count"/);
    expect(match).not.toBeNull();
    expect(match?.[1]).toContain(`TRY_CAST("name" AS VARCHAR) = 'keep-me'`);
  });

  it("quotes an injection-shaped measure column name in the excluded_count alias rather than embedding it raw", () => {
    const meta = columnMeta([{ name: 'm" ; DROP TABLE t1 --', type: "Int64", category: "number" }]);
    const overrides = new Map<string, ColumnCategory>([]);
    const state: BuilderState = {
      filters: [],
      groupBy: [],
      measures: [measure('m" ; DROP TABLE t1 --', "sum")],
    };
    const sql = buildQueryDiagnosticsSql("t1", state, meta, overrides);
    expect(sql).toContain('"m"" ; DROP TABLE t1 --_excluded_count"');
  });
});
