import type { AggregateFn, BuilderState, FilterCondition, FilterOperator, Measure } from "@hyakkei/schema";
import { castTargetFor, uniqueRawAlias, type ColumnCategory } from "./column-types.js";
import { quoteIdentifier, quoteStringLiteral } from "./identifier.js";
import type { ColumnMeta } from "./types.js";

/**
 * The light-shaping GUI's SQL resolver (issue 11c): compiles a
 * `Query.builderState` (filters/groupBy/measures, all user-selected via the
 * GUI, never free-text SQL) into a complete, self-contained SQL string for
 * `Query.sql` -- self-contained because `baked.ts`'s bake contract executes
 * `Query.sql` verbatim with no side-channel parameters, so a prepared-
 * statement placeholder cannot be persisted here (ADR-0012).
 *
 * The same closed-enum + fail-fast-throw discipline `castTargetFor`
 * (column-types.ts) already established for the CAST *type* position is
 * mirrored here for two new positions this PR introduces: the filter
 * *operator* (`operatorSqlFor`) and the aggregate *function name*
 * (`aggregateFnFor`). Filter *values* and the aggregate/groupBy *column
 * references* go through `quoteStringLiteral`/`quoteIdentifier`
 * respectively -- never a template-literal interpolation of the raw value.
 */

const OPERATOR_SQL: Record<FilterOperator, string> = {
  eq: "=",
  ne: "<>",
  lt: "<",
  lte: "<=",
  gt: ">",
  gte: ">=",
  contains: "LIKE",
  not_contains: "NOT LIKE",
  is_null: "IS NULL",
  is_not_null: "IS NOT NULL",
};

/** `castTargetFor`-shaped: closed lookup, `Object.hasOwn`, throws before any SQL is built. */
function operatorSqlFor(operator: FilterOperator): string {
  if (!Object.hasOwn(OPERATOR_SQL, operator)) {
    throw new RangeError(`unknown filter operator: ${JSON.stringify(operator)}`);
  }
  return OPERATOR_SQL[operator];
}

const AGGREGATE_SQL: Record<AggregateFn, string> = { sum: "SUM", count: "COUNT", avg: "AVG" };

/** `castTargetFor`-shaped: closed lookup, `Object.hasOwn`, throws before any SQL is built. */
function aggregateFnFor(aggregate: AggregateFn): string {
  if (!Object.hasOwn(AGGREGATE_SQL, aggregate)) {
    throw new RangeError(`unknown aggregate function: ${JSON.stringify(aggregate)}`);
  }
  return AGGREGATE_SQL[aggregate];
}

/**
 * The category a column is actually treated as for this query: an active
 * `Source.typeOverrides` entry wins, otherwise the auto-detected category
 * from the live registered table. `undefined` means the column doesn't
 * exist in the live table at all (a dangling `builderState` reference --
 * shape enumeration A3, hand-edited dashboard.json or a source re-registered
 * with different columns) -- every caller below treats this the same as
 * `"other"`: silently drop the filter/groupBy/measure entry rather than
 * emit a reference to a nonexistent column, which would be a binder error
 * that kills the ENTIRE query, not just the one bad entry.
 */
function effectiveCategory(
  column: string,
  columnMeta: ColumnMeta[],
  overrides: ReadonlyMap<string, ColumnCategory>,
): ColumnCategory | "other" | undefined {
  const override = overrides.get(column);
  if (override) return override;
  return columnMeta.find((c) => c.name === column)?.category;
}

/**
 * Override columns only get the `TRY_CAST` wrap -- a column with no active
 * override keeps its native reference, since its native Arrow/DuckDB type is
 * already correct (issue 11b's apply model: the base table is never
 * mutated, only override columns are re-cast on read). This is the RR-2
 * resolution ADR-0011 explicitly left for this PR: WHERE/GROUP BY/aggregate
 * argument positions all go through this SAME function, so an override
 * applies consistently everywhere a column is referenced in one query --
 * never just one position.
 */
function typedColumnRef(
  column: string,
  overrides: ReadonlyMap<string, ColumnCategory>,
): string {
  const quotedColumn = quoteIdentifier(column);
  const override = overrides.get(column);
  if (!override) return quotedColumn;
  return `TRY_CAST(${quotedColumn} AS ${castTargetFor(override)})`;
}

/**
 * Number/date filter values are wrapped the same way the column side is
 * (Codex plan review finding): `TRY_CAST(quoteStringLiteral(value) AS
 * castTargetFor(category))`, not a bare VARCHAR literal compared against a
 * TRY_CAST'd column via DuckDB's own implicit coercion. This also makes an
 * unparseable filter value (a typo, not a data problem) `NULL` rather than
 * a binder error -- `buildQueryDiagnosticsSql` surfaces this distinctly
 * (shape enumeration G3) so it doesn't read as "0 legitimately matching
 * rows."
 */
function typedValueLiteral(value: string, category: ColumnCategory): string {
  if (category === "text") return quoteStringLiteral(value);
  return `TRY_CAST(${quoteStringLiteral(value)} AS ${castTargetFor(category)})`;
}

/**
 * `contains`/`not_contains` compile to `LIKE`/`NOT LIKE`, which treats `%`
 * and `_` in the VALUE as wildcards, not literal characters -- a value like
 * `"50%"` (a real government-data shape: percentages) would otherwise match
 * far more than the user typed (shape enumeration G6, confirmed via a real
 * DuckDB-WASM run: `LIKE '%50%%'` with no escaping matched both an exact
 * `"50%"` row and an unrelated `"50 percent off"` row). Every `contains`/
 * `not_contains` value is escaped here and paired with an explicit `ESCAPE
 * '\'` clause at the call site -- never emitted without one.
 */
function likePatternLiteral(value: string): string {
  const escaped = value.replaceAll("\\", "\\\\").replaceAll("%", "\\%").replaceAll("_", "\\_");
  return quoteStringLiteral(`%${escaped}%`);
}

/**
 * One filter condition's SQL fragment, or `undefined` if this condition
 * cannot be safely compiled right now and must be silently dropped from
 * the WHERE clause (never emitted as a reference that would binder-error
 * the whole query):
 * - the column is dangling or `"other"`-categoried (A3/G5's generalization
 *   -- "other" columns were never override-eligible in the UI either, so
 *   builderState treats them as universally unusable, not just for
 *   sum/avg)
 * - the condition is genuinely incomplete: `value` is `undefined` for an
 *   operator that needs one (UI's own "an incomplete condition doesn't
 *   affect the query yet" design -- distinct from `value: ""`, which IS a
 *   complete, meaningful "match a blank cell" condition, shape enumeration
 *   G4)
 */
function filterConditionSql(
  condition: FilterCondition,
  columnMeta: ColumnMeta[],
  overrides: ReadonlyMap<string, ColumnCategory>,
): string | undefined {
  // Validated FIRST, unconditionally -- BEFORE the dangling/"other"-column
  // early-return below (Codex review R1 P0): an out-of-union `operator`
  // must throw regardless of whether this condition ends up being dropped
  // from the WHERE clause, matching `castTargetFor`'s own "fail fast at the
  // point an unsafe value is even touched" discipline rather than only
  // failing fast when the entry happens to also be otherwise usable.
  const op = operatorSqlFor(condition.operator);
  const category = effectiveCategory(condition.column, columnMeta, overrides);
  if (category === undefined || category === "other") return undefined;
  const ref = typedColumnRef(condition.column, overrides);
  if (condition.operator === "is_null" || condition.operator === "is_not_null") {
    return `${ref} ${op}`;
  }
  if (condition.value === undefined) return undefined;
  // A VALUE-comparing "text"-category column always gets an explicit
  // `TRY_CAST(col AS VARCHAR)`, even with no active override (QA Phase 8
  // finding, confirmed via live DuckDB-WASM): `typedColumnRef`'s no-override
  // path assumes the native type is already comparable as-is, true for a
  // genuine Utf8/LargeUtf8 column but NOT for a native BOOLEAN/NULL column
  // -- `arrowTypeCategory` buckets both into "text" for DISPLAY purposes
  // only (issue 11b: no boolean category in this app's 3-category
  // taxonomy), but comparing a raw BOOLEAN column against a string literal
  // throws (`"flag" = ''` -> `Conversion Error: Could not convert string
  // '' to BOOL`; `"flag" LIKE ...` -> a `like_escape` Binder Error) rather
  // than gracefully evaluating false. `is_null`/`is_not_null` above don't
  // need this -- nullity checks work identically regardless of type.
  const comparisonRef =
    category === "text" ? `TRY_CAST(${quoteIdentifier(condition.column)} AS VARCHAR)` : ref;
  if (condition.operator === "contains" || condition.operator === "not_contains") {
    return `${comparisonRef} ${op} ${likePatternLiteral(condition.value)} ESCAPE '\\'`;
  }
  return `${comparisonRef} ${op} ${typedValueLiteral(condition.value, category)}`;
}

function measureAliasBase(measure: Measure): string {
  return `${measure.aggregate}_${measure.column}`;
}

/**
 * `count` deliberately bypasses `typedColumnRef` (Codex plan review
 * finding): Excel PivotTable's "個数" counts non-blank cells in the RAW
 * column, not "how many values successfully cast" -- `COUNT(TRY_CAST(...))`
 * would silently change meaning for an overridden column. `sum`/`avg` DO
 * need `typedColumnRef`'s TRY_CAST (numeric validity is the point), and are
 * only offered for an effective category of `"number"` -- shape enumeration
 * G5: an `"other"`-categoried column (never override-eligible) or a
 * date-overridden column both hit the same `SUM(VARCHAR)`-class binder
 * error a text-categoried column does, so the gate is "number, or nothing"
 * rather than "not date."
 *
 * Returns `undefined` for the same silently-drop-don't-binder-error reasons
 * as `filterConditionSql`.
 */
function measureExprFor(
  measure: Measure,
  columnMeta: ColumnMeta[],
  overrides: ReadonlyMap<string, ColumnCategory>,
): string | undefined {
  // Validated FIRST, unconditionally, same reasoning as `filterConditionSql`'s
  // own `operatorSqlFor` call above (Codex review R1 P0) -- an out-of-union
  // `aggregate` must throw even when the measure ends up dropped for a
  // dangling/non-number column, and even the `"count"` branch below (which
  // never interpolates this value into SQL text -- "COUNT" is a fixed
  // literal) still goes through this lookup so a corrupted `aggregate`
  // value can never silently reach either branch unchecked.
  const aggSql = aggregateFnFor(measure.aggregate);
  const category = effectiveCategory(measure.column, columnMeta, overrides);
  // Dangling (nonexistent) column: never usable by any aggregate. An
  // existing `"other"`-categoried column IS still usable, but ONLY by
  // count -- Excel-parity "個数" only checks non-null-ness, which needs no
  // type interpretation at all, unlike sum/avg's numeric-validity
  // requirement below.
  if (category === undefined) return undefined;
  if (measure.aggregate === "count") return `COUNT(${quoteIdentifier(measure.column)})`;
  if (category !== "number") return undefined;
  const ref = typedColumnRef(measure.column, overrides);
  // CAST(...AS DOUBLE) forces a JS-safe plain number (issue 11b's HUGEINT
  // PoC finding): DuckDB's own SUM(BIGINT) defaults to HUGEINT, which
  // `rowToPlainObject` cannot surface as a plain number.
  return `CAST(${aggSql}(${ref}) AS DOUBLE)`;
}

function dedupPreserveOrder(values: string[]): string[] {
  return [...new Set(values)];
}

/**
 * Compiles a `builderState` into a complete, self-contained SQL string --
 * no `?` placeholders, safe to persist verbatim as `Query.sql` and to run
 * through a future bake step unchanged (`baked.ts`'s bake contract runs
 * `Query.sql` with no side-channel parameters).
 *
 * All three arrays being empty (or every entry being dropped as dangling)
 * compiles to a plain `SELECT * FROM <table>` -- the same "nothing
 * configured yet" state a freshly opened query builder starts from.
 * `groupBy` present with zero `measures` still emits without an aggregate
 * (just re-selects the distinct-by-nothing groupBy columns); zero
 * `groupBy` with 1+ `measures` emits with NO `GROUP BY` clause at all (a
 * single-row total, not a degenerate one-group aggregate) -- these are two
 * genuinely different, both-valid shapes, not the same case handled twice.
 */
export function buildQuerySql(
  tableId: string,
  builderState: BuilderState,
  columnMeta: ColumnMeta[],
  overrides: ReadonlyMap<string, ColumnCategory>,
): string {
  const quotedTable = quoteIdentifier(tableId);

  const whereClauses = builderState.filters
    .map((f) => filterConditionSql(f, columnMeta, overrides))
    .filter((clause): clause is string => clause !== undefined);

  // Order-preserving dedup (shape enumeration A9): a repeated groupBy column
  // is SQL-legal but redundant, and the redundant SELECT-list duplicate
  // would collide as a JS object key exactly like a measure alias collision
  // does (same underlying `rowToPlainObject` mechanism, confirmed via PoC).
  const validGroupBy = dedupPreserveOrder(
    builderState.groupBy.filter((col) => {
      const category = effectiveCategory(col, columnMeta, overrides);
      return category !== undefined && category !== "other";
    }),
  );

  // Measure alias collisions extend to REAL column names and groupBy
  // columns, not just other measure aliases (shape enumeration G2,
  // confirmed via a real DuckDB-WASM run: an alias colliding with a real
  // column silently corrupts the result row -- a raw typed-array fragment
  // leaks through where a plain number was expected -- rather than merely
  // dropping one value). `taken` seeds with every real column name and
  // every already-accepted groupBy column before any alias is generated.
  const taken = new Set<string>([...columnMeta.map((c) => c.name), ...validGroupBy]);
  const measureSelectList: string[] = [];
  for (const measure of builderState.measures) {
    const expr = measureExprFor(measure, columnMeta, overrides);
    if (expr === undefined) continue;
    const alias = uniqueRawAlias(measureAliasBase(measure), taken);
    taken.add(alias);
    measureSelectList.push(`${expr} AS ${quoteIdentifier(alias)}`);
  }

  // Each groupBy column goes through `typedColumnRef` (an override wraps it
  // in TRY_CAST) -- the SAME expression is repeated in both the SELECT list
  // (aliased back to the plain column name) and the GROUP BY clause itself,
  // rather than letting GROUP BY reference the SELECT-list alias: whether a
  // GROUP BY name resolves to an output alias or a same-named source column
  // is dialect/ambiguity-dependent, so repeating the exact expression is the
  // only form that is unambiguous regardless (this was the actual TRY_CAST-
  // application bug this PR's own unit tests caught: the first version only
  // wrapped WHERE/aggregate positions, silently leaving GROUP BY raw).
  const groupByExprList = validGroupBy.map((col) => typedColumnRef(col, overrides));
  const groupBySelectList = validGroupBy.map(
    (col, i) => `${groupByExprList[i]} AS ${quoteIdentifier(col)}`,
  );
  const selectList = [...groupBySelectList, ...measureSelectList];
  const selectClause = selectList.length > 0 ? selectList.join(", ") : "*";
  const whereClause = whereClauses.length > 0 ? ` WHERE ${whereClauses.join(" AND ")}` : "";
  // Explicit expression list, not `GROUP BY ALL` (Codex plan review
  // finding): this SQL is persisted and may be hand-read/audited later, and
  // an explicit list is unambiguous regardless of what else the SELECT
  // list ever grows to contain.
  const groupByClause = validGroupBy.length > 0 ? ` GROUP BY ${groupByExprList.join(", ")}` : "";

  return `SELECT ${selectClause} FROM ${quotedTable}${whereClause}${groupByClause}`;
}

/** Preview-only: the persisted query plus a `LIMIT`, in its own function rather than string-concatenated ad hoc at each call site (Codex plan review finding). */
export function buildQueryPreviewSql(
  tableId: string,
  builderState: BuilderState,
  columnMeta: ColumnMeta[],
  overrides: ReadonlyMap<string, ColumnCategory>,
  limit: number,
): string {
  return `${buildQuerySql(tableId, builderState, columnMeta, overrides)} LIMIT ${limit}`;
}

/**
 * "No silently-vanishing rows" (this PR's own success metric) needs more
 * than the compiled query itself -- three distinct, independently
 * surfaceable causes of missing/excluded data, each its own named column
 * here rather than folded into one opaque total:
 *
 * - `matched_count` vs `total_count`: how many rows the WHERE clause
 *   actually keeps (a legitimately strict filter is not a bug).
 * - `filter<i>_value_invalid`: the filter's own typed VALUE didn't parse as
 *   that column's category (a typo, e.g. `> "abc"` on a number column) --
 *   distinct from the column DATA being uncastable, and from "0 rows
 *   matched because the filter is strict" (shape enumeration G3: without
 *   this, all three look identical -- an empty result).
 * - `<column>_excluded_count` per sum/avg measure: how many otherwise
 *   non-null rows failed `TRY_CAST` and were silently excluded from that
 *   aggregate (the aggregate equivalent of issue 11b's `uncastable_count`).
 */
export function buildQueryDiagnosticsSql(
  tableId: string,
  builderState: BuilderState,
  columnMeta: ColumnMeta[],
  overrides: ReadonlyMap<string, ColumnCategory>,
): string {
  const quotedTable = quoteIdentifier(tableId);

  const whereClauses = builderState.filters
    .map((f) => filterConditionSql(f, columnMeta, overrides))
    .filter((clause): clause is string => clause !== undefined);
  const filterPredicate = whereClauses.length > 0 ? whereClauses.join(" AND ") : "TRUE";

  const filterValueChecks = builderState.filters
    .map((filter, index) => {
      if (filter.value === undefined) return undefined;
      if (filter.operator === "contains" || filter.operator === "not_contains") return undefined;
      if (filter.operator === "is_null" || filter.operator === "is_not_null") return undefined;
      const category = effectiveCategory(filter.column, columnMeta, overrides);
      if (category === undefined || category === "other" || category === "text") return undefined;
      const alias = quoteIdentifier(`filter_${index}_value_invalid`);
      return `(${typedValueLiteral(filter.value, category)} IS NULL) AS ${alias}`;
    })
    .filter((c): c is string => c !== undefined);

  const measureChecks = builderState.measures
    .map((measure) => {
      if (measure.aggregate === "count") return undefined;
      const category = effectiveCategory(measure.column, columnMeta, overrides);
      if (category !== "number") return undefined;
      const typedRef = typedColumnRef(measure.column, overrides);
      const rawRef = quoteIdentifier(measure.column);
      const alias = quoteIdentifier(`${measure.column}_excluded_count`);
      // Scoped to `filterPredicate`, not the whole table (Codex review R1
      // P1): otherwise a WHERE-filtered-out row's own cast failure would
      // still count as "excluded from the aggregate," even though that row
      // was never going to contribute to it in the first place -- a
      // misleading count layered on top of the filter's own, already-correct
      // exclusion.
      return `COUNT(*) FILTER (WHERE (${filterPredicate}) AND ${typedRef} IS NULL AND ${rawRef} IS NOT NULL) AS ${alias}`;
    })
    .filter((c): c is string => c !== undefined);

  const selectList = [
    "COUNT(*) AS total_count",
    `COUNT(*) FILTER (WHERE ${filterPredicate}) AS matched_count`,
    ...filterValueChecks,
    ...measureChecks,
  ];
  return `SELECT ${selectList.join(", ")} FROM ${quotedTable}`;
}
