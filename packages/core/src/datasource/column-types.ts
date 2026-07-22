import { DataType } from "apache-arrow";
import { quoteIdentifier } from "./identifier.js";

/**
 * The user-facing semantic category a column's Arrow type is bucketed into
 * (issue 11b). Deliberately 3 values, not a wider enum mirroring DuckDB's
 * own type system: PRD F2 asks for "column types" as a light-touch concept a
 * non-technical user can act on ("this is a date"), not a SQL type picker.
 * Time/Interval/List/Struct/etc. fall through to "other" (see
 * `arrowTypeCategory`) rather than being force-fit into one of these three.
 */
export type ColumnCategory = "text" | "number" | "date";

/**
 * Closed lookup, never a template-literal interpolation of `category` itself
 * (shape enumeration §5, Security/Codex review): `CAST(col AS <type>)`'s
 * type position cannot be escaped the way an identifier or string literal
 * can be (quoting a type keyword, e.g. `CAST(x AS "DOUBLE")`, is not the
 * same SQL and often just breaks) — the only way to keep a category value
 * (user-selected, or read back from a shared dashboard.json) from ever
 * reaching that position unsanitized is to never let it touch the SQL text
 * directly at all. Every call site must go through `castTargetFor` below,
 * never index this map directly.
 */
export const CAST_TARGET: Record<ColumnCategory, string> = {
  text: "VARCHAR",
  number: "DOUBLE",
  date: "DATE",
};

/**
 * Codex review R1 (P0): indexing `CAST_TARGET` directly degrades to
 * `undefined` for an out-of-union `category` (a bug upstream, or a value
 * smuggled in via `as ColumnCategory`) -- every builder below was silently
 * emitting `CAST(x AS undefined)` and letting DuckDB's own parser reject it
 * at query time instead of failing fast at the point the unsafe value was
 * about to touch SQL text at all. `Object.hasOwn` (not just an `in`/index
 * check) additionally forecloses prototype-chain lookups (`"toString"`,
 * `"constructor"`, etc. all exist on `Object.prototype` and would otherwise
 * resolve to a function reference, not `undefined`, defeating this guard).
 *
 * Exported (issue 11c): `query-sql.ts`'s filter/aggregate SQL resolver
 * reuses this exact function to apply the same TRY_CAST discipline at
 * WHERE/GROUP BY/aggregate-argument positions for an overridden column —
 * ADR-0011's "Builder responsibility split" explicitly named this as the
 * one piece of CAST logic this PR was meant to reuse.
 */
export function castTargetFor(category: ColumnCategory): string {
  if (!Object.hasOwn(CAST_TARGET, category)) {
    throw new RangeError(`unknown column category: ${JSON.stringify(category)}`);
  }
  return CAST_TARGET[category];
}

/**
 * Arrow `typeId`-based classification (`DataType.is*` static guards), not a
 * `type.toString()` string parse: the display string (`Int64`, `Date32<DAY>`,
 * `Decimal[10e+0]`, ...) is apache-arrow's own formatting, used elsewhere in
 * this codebase (`register-path.ts`) for *display* only, never for
 * branching — the typed guards are the stable, versioned API surface.
 * Dictionary-encoded columns (confirmed via PoC to be the common case for
 * any string/text column read back from a DuckDB Arrow result) are unwrapped
 * recursively before classifying.
 *
 * Binary/Time/Interval/List/Struct/Union/Map/FixedSize* all fall through to
 * "other": none of them fit "text/number/date" without a lossy or
 * misleading cast target, so overriding them is simply not offered rather
 * than offering a cast that would silently do the wrong thing.
 */
export function arrowTypeCategory(type: DataType): ColumnCategory | "other" {
  if (DataType.isDictionary(type)) return arrowTypeCategory(type.dictionary);
  if (DataType.isInt(type) || DataType.isFloat(type) || DataType.isDecimal(type)) return "number";
  if (DataType.isDate(type) || DataType.isTimestamp(type)) return "date";
  if (
    DataType.isUtf8(type) ||
    DataType.isLargeUtf8(type) ||
    DataType.isBool(type) ||
    DataType.isNull(type)
  ) {
    return "text";
  }
  return "other";
}

/**
 * The one-time validation query a column-type override runs (issue 11b):
 * counts non-null values and, among those, how many fail `TRY_CAST` to the
 * override's target type. Deliberately `COUNT(...) FILTER (WHERE ...)`, not
 * `SUM(CASE WHEN ... THEN 1 ELSE 0 END)` (PoC finding, 2026-07-22): DuckDB's
 * `SUM` over a `CASE`-derived 0/1 defaults to `HUGEINT` (128-bit), which
 * apache-arrow does not surface as a plain JS number through this
 * codebase's `rowToPlainObject` — it arrives as a multi-limb object.
 * `COUNT(...)` is a plain integer-typed aggregate and round-trips cleanly.
 *
 * `tableId`/`column` are always identifiers, quoted via `quoteIdentifier`
 * regardless of what the caller passes (both are data — a DuckDB-generated
 * table id, and a CSV/xlsx column name, which may legally contain `"`,
 * whitespace, or `__proto__` — never a `SqlIdentifier`-restricted value).
 * `category`'s target keyword comes only from `castTargetFor`.
 */
export function buildCastValidationSql(
  tableId: string,
  column: string,
  category: ColumnCategory,
): string {
  const quotedTable = quoteIdentifier(tableId);
  const quotedColumn = quoteIdentifier(column);
  const target = castTargetFor(category);
  return `SELECT
    COUNT(${quotedColumn}) AS non_null_count,
    COUNT(${quotedColumn}) FILTER (WHERE TRY_CAST(${quotedColumn} AS ${target}) IS NULL) AS uncastable_count
    FROM ${quotedTable}`;
}

/**
 * A handful of `{original, parsed}` pairs for an override before it's fully
 * trusted (issue 11b, V-001): `TRY_CAST` succeeding is not the same as
 * parsing what the user meant — `TRY_CAST('2024/03/04' AS DATE)` can
 * succeed while silently picking the wrong day/month order, a mistake a
 * pure success/failure count can never surface. Showing a few concrete
 * before/after values lets a user visually confirm the interpretation;
 * this does not close the misinterpretation risk (a plausible-but-wrong
 * date still looks fine here), only makes it inspectable rather than
 * invisible. Only non-null originals are sampled — a null row has nothing
 * to confirm.
 */
export function buildCastSampleSql(
  tableId: string,
  column: string,
  category: ColumnCategory,
  limit: number,
): string {
  const quotedTable = quoteIdentifier(tableId);
  const quotedColumn = quoteIdentifier(column);
  const target = castTargetFor(category);
  return `SELECT
    ${quotedColumn} AS original,
    TRY_CAST(${quotedColumn} AS ${target}) AS parsed
    FROM ${quotedTable}
    WHERE ${quotedColumn} IS NOT NULL
    LIMIT ${limit}`;
}

export type TypedPreviewResult = {
  sql: string;
  /**
   * Real column name -> the alias holding that SAME column's un-cast
   * original value, present only for overridden columns. `TRY_CAST`
   * returns `NULL` on failure, indistinguishable from a genuinely-null
   * cell in the typed result alone — the caller merges this back in so a
   * failed cast can still show the user what was actually in their file.
   */
  rawAliasFor: ReadonlyMap<string, string>;
};

/**
 * Codex review R1 (P1): an index-derived alias like `__hyakkei_raw_0__` is
 * NOT guaranteed collision-free -- column names are arbitrary data, and a
 * real column could legally be named exactly that. Generated against the
 * full set of real column names AND every alias already handed out in this
 * call, extending the candidate until it is provably unique among both.
 *
 * Exported (issue 11c): `query-sql.ts`'s measure-alias generation reuses
 * this same collision-avoidance algorithm — a real e2e run against actual
 * DuckDB-WASM confirmed an alias colliding with a real/groupBy column name
 * doesn't just silently drop a value, it corrupts the result row (a raw
 * typed-array fragment leaks through where a plain number was expected),
 * so this is not optional hardening there either.
 */
export function uniqueRawAlias(candidate: string, taken: ReadonlySet<string>): string {
  let alias = candidate;
  while (taken.has(alias)) alias += "_";
  return alias;
}

/**
 * Authoring-time preview query (issue 11b): re-selects a table with any
 * overridden columns cast to their target type, everything else untouched.
 * `LIMIT`-bounded, for the editor's own data-preview card — NOT the shape a
 * future 11c query resolver's own (potentially unbounded, multi-column)
 * queries should assume they can call verbatim; the CAST logic
 * (`castTargetFor`, `quoteIdentifier` discipline) is what's meant to be
 * reused, not this function's own call shape (see ADR-0011).
 *
 * Both the cast value AND the original raw value are selected for an
 * overridden column, in the SAME query — not a second, separately-issued
 * raw query merged client-side by row position, since DuckDB gives no
 * ordering guarantee across two independent `LIMIT`-bounded selects
 * without an `ORDER BY` key, so two calls could return different physical
 * rows.
 */
export function buildTypedPreviewSql(
  tableId: string,
  columns: string[],
  overrides: ReadonlyMap<string, ColumnCategory>,
  limit: number,
): TypedPreviewResult {
  const quotedTable = quoteIdentifier(tableId);
  const rawAliasFor = new Map<string, string>();
  // A single mutable Set, seeded once and grown with `.add()` as aliases are
  // handed out (/code-review Efficiency finding, confirmed): the prior
  // version rebuilt `new Set([...columnNames, ...rawAliasFor.values()])`
  // from scratch on EVERY column, making the whole function O(n^2) in the
  // column count. Correctness is unchanged -- `taken` still reflects every
  // real column name plus every alias assigned so far at the point each new
  // alias is chosen.
  const taken = new Set(columns);
  const selectList = columns
    .map((column, index) => {
      const quotedColumn = quoteIdentifier(column);
      const override = overrides.get(column);
      if (!override) return quotedColumn;
      const rawAlias = uniqueRawAlias(`__hyakkei_raw_${index}__`, taken);
      taken.add(rawAlias);
      rawAliasFor.set(column, rawAlias);
      return (
        `TRY_CAST(${quotedColumn} AS ${castTargetFor(override)}) AS ${quotedColumn}, ` +
        `${quotedColumn} AS ${quoteIdentifier(rawAlias)}`
      );
    })
    .join(", ");
  return { sql: `SELECT ${selectList} FROM ${quotedTable} LIMIT ${limit}`, rawAliasFor };
}

/**
 * category==="number"-only diagnostic (/code-review Angle D, confirmed):
 * `TRY_CAST(... AS DOUBLE)` succeeding is not the same as preserving the
 * exact value -- IEEE 754 double has only 53 bits of exact integer
 * precision (~9.007e15, 15-16 decimal digits); a longer all-digit value
 * (e.g. a 17-digit corporate/invoice id a user overrides to "number")
 * silently rounds, with `uncastable_count` staying 0 the whole time since
 * the cast did not fail, it just lied about the result. Detected via a
 * HUGEINT round-trip, gated to integer-SHAPED text only (QA finding,
 * 2026-07-22, via a live DuckDB-WASM run -- the doc comment's original
 * premise that `TRY_CAST(x AS HUGEINT)` only succeeds for "a pure,
 * non-fractional integer literal" was FALSE: DuckDB rounds a fractional
 * string to the nearest integer instead of rejecting it, and does so with a
 * DIFFERENT tie-breaking rule than the DOUBLE-cast path (round-half-away-
 * from-zero from text vs. round-half-to-even from a double) -- so an
 * ordinary decimal exactly at a `.5` tie, e.g. `'1200.5'`, produced `1201`
 * from one path and `1200` from the other and was flagged as "precision
 * lossy" despite losing nothing: DOUBLE represents `1200.5` exactly. The
 * leading `regexp_matches(..., '^-?[0-9]+$')` restricts the round-trip
 * comparison to values that are ALREADY bare integer literals in the
 * source text -- exactly the case (long ID-like digit strings) this
 * diagnostic exists for -- so an ordinary decimal amount never reaches the
 * HUGEINT comparison at all.
 *
 * Only the single COUNT crosses into JS (same shape already proven safe for
 * `buildCastValidationSql`'s counts) -- no risk of the HUGEINT/JS
 * serialization gap the `SUM(CASE...)` PoC finding hit earlier in this PR,
 * since no HUGEINT *value* itself is ever read back into JS here.
 *
 * `CAST(${quotedColumn} AS VARCHAR)`, not the bare column reference (PoC
 * finding, 2026-07-22, via a real e2e run): `column` is not always
 * VARCHAR -- a column the CSV sniffer already typed as DATE/TIMESTAMP (or
 * one already overridden away from its auto-detected category) has no
 * registered DIRECT cast to HUGEINT in DuckDB, which is a BINDER-time
 * error TRY_CAST does not suppress (unlike an ordinary runtime conversion
 * failure). Going through VARCHAR first keeps this well-defined for every
 * column this can ever actually be called on: for a genuinely textual
 * column it's a no-op identity cast (unchanged behavior); for an
 * already-native numeric/temporal column, DuckDB's own canonical
 * stringification either still round-trips exactly (no advisory) or
 * simply isn't integer-shaped at all (correctly not flagged), never a
 * crash.
 *
 * Residual, accepted gap (QA finding, documented in ADR-0011 RR-5 rather
 * than solved here): HUGEINT is 128-bit (~38 decimal digits) -- an
 * integer-shaped string LONGER than that casts to HUGEINT as NULL, so it is
 * never flagged even though it demonstrably loses precision as a DOUBLE.
 * Real government-data ids (postal codes, corporate/invoice numbers,
 * phone numbers) are all well under this ceiling; a fully unbounded check
 * would require comparing decimal strings directly rather than a numeric
 * round-trip, reintroducing exactly the formatting-difference false-
 * positive risk (leading zeros, sign, whitespace) this design avoided by
 * using a numeric comparison in the first place.
 */
export function buildNumberPrecisionCheckSql(tableId: string, column: string): string {
  const quotedTable = quoteIdentifier(tableId);
  const quotedColumn = quoteIdentifier(column);
  const text = `CAST(${quotedColumn} AS VARCHAR)`;
  return `SELECT
    COUNT(${quotedColumn}) FILTER (
      WHERE regexp_matches(${text}, '^-?[0-9]+$')
        AND TRY_CAST(${text} AS HUGEINT) IS NOT NULL
        AND TRY_CAST(TRY_CAST(${text} AS DOUBLE) AS HUGEINT) <> TRY_CAST(${text} AS HUGEINT)
    ) AS precision_lossy_count
    FROM ${quotedTable}`;
}

/**
 * category==="date"-only diagnostic (/code-review Angle D, confirmed):
 * `TRY_CAST(... AS DATE)` takes whatever calendar-date component is
 * literally written and discards any time-of-day AND any UTC offset
 * without normalizing to it first -- `'2024-03-04T01:00:00+09:00'` and the
 * same literal with `-09:00` both truncate to the same `2024-03-04`, even
 * though a UTC-normalized calendar day could genuinely differ near a
 * midnight boundary. Sibling risk to RR-1 (date field-order
 * misinterpretation, ADR-0011) but a distinct mechanism -- this one is
 * deterministic and detectable by a plain textual pattern match (an
 * explicit `Z`/offset suffix on the source string), not a floating
 * timezone-conversion judgment call of our own to get subtly wrong.
 *
 * `regexp_matches` requires a VARCHAR argument -- `CAST(${quotedColumn} AS
 * VARCHAR)` (same PoC finding as `buildNumberPrecisionCheckSql` above)
 * keeps this from throwing a binder error when `column` is already a
 * native DATE/TIMESTAMP column (no registered implicit cast to VARCHAR for
 * a scalar-function argument). For such a column, any offset was already
 * discarded at CSV-ingest time, before this override step ever runs --
 * DuckDB's own canonical re-serialization has no offset suffix left to
 * match, so this correctly reports 0 rather than crashing OR
 * false-flagging something this step cannot actually detect.
 */
export function buildDateOffsetCheckSql(tableId: string, column: string): string {
  const quotedTable = quoteIdentifier(tableId);
  const quotedColumn = quoteIdentifier(column);
  const text = `CAST(${quotedColumn} AS VARCHAR)`;
  return `SELECT
    COUNT(${quotedColumn}) FILTER (
      WHERE TRY_CAST(${quotedColumn} AS DATE) IS NOT NULL
        AND regexp_matches(${text}, '([zZ]|[+-][0-9]{2}:?[0-9]{2})$')
    ) AS offset_discarded_count
    FROM ${quotedTable}`;
}
