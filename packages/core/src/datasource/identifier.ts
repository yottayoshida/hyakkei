/**
 * The primary defense ADR-0007/`validate.ts` promise but never implemented
 * until this PR: "generated SQL always double-quotes identifiers
 * (`CREATE TABLE \"<id>\"`) — the DuckDB-native way to make a reserved word
 * syntactically safe (DuckDB's own `KeywordHelper::RequiresQuotes` follows
 * the same quote-when-needed principle)." `SqlIdentifier`'s ASCII pattern
 * (packages/schema/src/common.ts) rules out spaces/quotes/semicolons in an
 * *authored* `Source.id`, but this function is the actual generated-SQL
 * mechanism that makes the identifier safe regardless of that pattern
 * holding — the two are independent layers (schema-time rejection,
 * generation-time quoting), matching the reserved-word check's own
 * "defense-in-depth, not the primary defense" framing.
 *
 * Doubling an embedded `"` is standard SQL identifier-quoting escape
 * syntax DuckDB follows; `SqlIdentifier`'s pattern already forbids `"`
 * entirely, so this branch is unreachable for an authored `Source.id`, but
 * this function is also used to quote xlsx/CSV *column names* (data, not
 * `SqlIdentifier`-restricted — CS-9/V-082) where a literal `"` is legal
 * data.
 */
export function quoteIdentifier(id: string): string {
  return `"${id.replaceAll('"', '""')}"`;
}

/**
 * Standard SQL string-literal escaping (doubling an embedded `'`) for the
 * one place generated SQL text embeds a string *value* rather than an
 * identifier: `read_csv_auto('<virtual-file-name>')`/`read_parquet(...)`'s
 * path argument. `nextVirtualFileName()` (virtual-file.ts) already
 * guarantees a fixed, safe character set by construction — this value is
 * never user/author-influenced — so this function is defense-in-depth,
 * not the load-bearing control; it costs nothing to apply uniformly
 * rather than relying solely on "the caller only ever passes a value we
 * already know is safe."
 */
export function quoteStringLiteral(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}
