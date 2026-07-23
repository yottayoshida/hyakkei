import { memo, useMemo, useRef, useState, type ChangeEvent } from "react";
import type { ColumnCategory, ColumnMeta } from "@hyakkei/core/datasource";
import type {
  AggregateFn,
  BuilderState,
  FilterCondition,
  FilterOperator,
  Measure,
} from "@hyakkei/schema";
import { usableColumns } from "../chart/chart-encoding.js";
import {
  AGGREGATE_LABEL,
  CATEGORY_LABEL,
  overrideMap,
  type ColumnOverride,
  type WorkspaceQuery,
} from "./types.js";

export type QueryBuilderProps = {
  query: WorkspaceQuery;
  sourceLabel: string;
  columnMeta: ColumnMeta[];
  typeOverrides: ColumnOverride[];
  onChange: (queryId: string, builderState: BuilderState) => void;
  onDelete: (queryId: string) => void;
  onAddChart: (queryId: string) => void;
};

/**
 * The column's category as this query actually sees it: an active override
 * wins over the auto-detected one -- same rule `query-sql.ts`'s resolver
 * applies. Kept as its own copy, not a shared import (/simplify Altitude
 * finding, issue 11c: this rule is duplicated core<->app): `query-sql.ts`'s
 * version lives in `packages/core/src/datasource`, which the app must never
 * statically import from (issue #54 bundle isolation -- that module pulls
 * in duckdb-wasm/exceljs/apache-arrow at load time, and this component
 * needs the rule SYNCHRONOUSLY during render, before the lazy
 * `loadDataLayer()` boundary could ever resolve). Accepted duplication, not
 * an oversight -- if this precedence rule ever changes, both copies need
 * updating together.
 */
function effectiveCategory(
  column: string,
  columnMeta: ColumnMeta[],
  overrides: ReadonlyMap<string, ColumnCategory>,
): ColumnCategory | "other" | undefined {
  return overrides.get(column) ?? columnMeta.find((c) => c.name === column)?.category;
}

/**
 * Comparison operators offered per category (Hick's Law: ≤5-8 per category,
 * never all 10 at once). `is_null`/`is_not_null` are offered for every
 * category -- distinguishing "blank" is meaningful regardless of type.
 * "other"-categoried columns never reach this lookup at all: they are
 * excluded from the filter/groupBy column list entirely (see
 * `filterableColumns` below), the same "never offered a choice that would
 * silently do nothing" rule issue #11b already applied to the type-override
 * `<select>`.
 */
const FILTER_OPERATORS: Record<
  "text" | "number" | "date",
  Array<{ value: FilterOperator; label: string }>
> = {
  text: [
    { value: "eq", label: "等しい" },
    { value: "contains", label: "含む" },
    { value: "not_contains", label: "含まない" },
    { value: "is_null", label: "空欄" },
    { value: "is_not_null", label: "空欄でない" },
  ],
  number: [
    { value: "eq", label: "等しい" },
    { value: "ne", label: "等しくない" },
    { value: "gt", label: "より大きい" },
    { value: "gte", label: "以上" },
    { value: "lt", label: "より小さい" },
    { value: "lte", label: "以下" },
    { value: "is_null", label: "空欄" },
    { value: "is_not_null", label: "空欄でない" },
  ],
  date: [
    { value: "eq", label: "等しい" },
    { value: "ne", label: "等しくない" },
    { value: "gt", label: "より後" },
    { value: "gte", label: "以降" },
    { value: "lt", label: "より前" },
    { value: "lte", label: "以前" },
    { value: "is_null", label: "空欄" },
    { value: "is_not_null", label: "空欄でない" },
  ],
};

function newFilter(column: string): FilterCondition {
  return { column, operator: "eq", value: "" };
}
function newMeasure(column: string): Measure {
  return { column, aggregate: "count" };
}

type FilterValueInputProps = {
  ariaLabel: string;
  value: string;
  onCommit: (value: string) => void;
};

/**
 * Local draft state, committed on blur/Enter, not on every keystroke -- the
 * plan's own explicit design decision for this one control, distinct from
 * every other control in this component (a `<select>`/add/remove is a
 * single discrete choice, correctly committed immediately). Without this, a
 * free-text value would trigger its own full preview+diagnostics DuckDB-WASM
 * round-trip per keystroke -- worse still under Japanese IME composition
 * (this app's primary input mode), where input events fire repeatedly per
 * character before the word is even complete (/simplify Efficiency
 * finding, issue 11c).
 */
function FilterValueInput({ ariaLabel, value, onCommit }: FilterValueInputProps) {
  const [draft, setDraft] = useState(value);
  return (
    <input
      type="text"
      aria-label={ariaLabel}
      value={draft}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={() => onCommit(draft)}
      onKeyDown={(event) => {
        if (event.key !== "Enter") return;
        event.preventDefault();
        onCommit(draft);
      }}
      style={{ minHeight: 44 }}
    />
  );
}

/**
 * The light-shaping GUI's filter + group-by/aggregate builder (issue #11c).
 * A sibling card to its source's `RegisteredSummary` (not nested inside it)
 * -- a query is a first-class entity `#12`'s chart tiles will reference by
 * id, and one source can have several queries.
 *
 * Every discrete change (add/remove a row, change a `<select>`) calls
 * `onChange` with the FULL next `builderState` immediately -- the same
 * on-change-auto-refresh discipline issue #11b's type-override `<select>`
 * already established. A filter's free-text VALUE is the one exception
 * (`FilterValueInput` above): it stages a local draft, committed on
 * blur/Enter. There is no other separate "draft" staged state; every other
 * field of `query.builderState` is always the live, current selection.
 */
export const QueryBuilder = memo(function QueryBuilder({
  query,
  sourceLabel,
  columnMeta,
  typeOverrides,
  onChange,
  onDelete,
  onAddChart,
}: QueryBuilderProps) {
  // Memoized (/simplify Efficiency finding, issue 11c): every preview
  // refresh toggles `previewPending` true->false, forcing 2 re-renders per
  // edit, and both re-derived this Map + an O(columns^2) filter (each
  // element re-scanning `columnMeta` via `effectiveCategory`) from scratch
  // even though `columnMeta`/`typeOverrides` hadn't changed since the
  // previous render.
  const overrides = useMemo(() => overrideMap(typeOverrides), [typeOverrides]);
  const { builderState } = query;

  // "other"-categoried columns are excluded from filter/groupBy entirely --
  // the resolver silently drops any reference to one (never override-
  // eligible, same as the type-override `<select>`'s own disable rule), so
  // offering them here would be a choice that visibly does nothing.
  const filterableColumns = useMemo(
    () =>
      columnMeta.filter((c) => {
        const category = effectiveCategory(c.name, columnMeta, overrides);
        return category !== undefined && category !== "other";
      }),
    [columnMeta, overrides],
  );
  // Every column is offered as a measure -- "count" works even on an
  // "other"-categoried column (Excel-parity: counting non-blank cells needs
  // no type interpretation at all).
  const measurableColumns = columnMeta;

  const addFilterButtonRef = useRef<HTMLButtonElement>(null);
  const addGroupByButtonRef = useRef<HTMLButtonElement>(null);
  const addMeasureButtonRef = useRef<HTMLButtonElement>(null);
  const lastFilterColumnRef = useRef<HTMLSelectElement>(null);
  const lastGroupByColumnRef = useRef<HTMLSelectElement>(null);
  const lastMeasureColumnRef = useRef<HTMLSelectElement>(null);

  function addFilter() {
    const column = filterableColumns[0]?.name;
    if (!column) return;
    onChange(query.id, { ...builderState, filters: [...builderState.filters, newFilter(column)] });
    queueMicrotask(() => lastFilterColumnRef.current?.focus());
  }
  function updateFilter(index: number, next: FilterCondition) {
    onChange(query.id, {
      ...builderState,
      filters: builderState.filters.map((f, i) => (i === index ? next : f)),
    });
  }
  function removeFilter(index: number) {
    onChange(query.id, {
      ...builderState,
      filters: builderState.filters.filter((_, i) => i !== index),
    });
    queueMicrotask(() => addFilterButtonRef.current?.focus());
  }

  function addGroupBy() {
    const column = filterableColumns[0]?.name;
    if (!column) return;
    onChange(query.id, { ...builderState, groupBy: [...builderState.groupBy, column] });
    queueMicrotask(() => lastGroupByColumnRef.current?.focus());
  }
  function updateGroupBy(index: number, column: string) {
    onChange(query.id, {
      ...builderState,
      groupBy: builderState.groupBy.map((c, i) => (i === index ? column : c)),
    });
  }
  function removeGroupBy(index: number) {
    onChange(query.id, {
      ...builderState,
      groupBy: builderState.groupBy.filter((_, i) => i !== index),
    });
    queueMicrotask(() => addGroupByButtonRef.current?.focus());
  }

  function addMeasure() {
    const column = measurableColumns[0]?.name;
    if (!column) return;
    onChange(query.id, {
      ...builderState,
      measures: [...builderState.measures, newMeasure(column)],
    });
    queueMicrotask(() => lastMeasureColumnRef.current?.focus());
  }
  function updateMeasure(index: number, next: Measure) {
    onChange(query.id, {
      ...builderState,
      measures: builderState.measures.map((m, i) => (i === index ? next : m)),
    });
  }
  function removeMeasure(index: number) {
    onChange(query.id, {
      ...builderState,
      measures: builderState.measures.filter((_, i) => i !== index),
    });
    queueMicrotask(() => addMeasureButtonRef.current?.focus());
  }

  const diagnostics = query.diagnostics;
  const previewRows = query.previewRows ?? [];
  // `query.previewColumns` (Codex review R1 P2), not derived from
  // `previewRows[0]`'s keys: a real Arrow result carries its own field
  // names even with zero rows, so a grouped/filtered query that legitimately
  // matches nothing still shows ITS OWN output columns (group-by/measure
  // aliases), not the raw source table's -- the `columnMeta` fallback here
  // only ever applies before the very first refresh has resolved at all.
  const previewColumns =
    query.previewColumns.length > 0 ? query.previewColumns : columnMeta.map((c) => c.name);

  return (
    <div
      className="hyakkei-query-card"
      data-query-id={query.id}
      style={{ marginTop: 16, border: "1px solid #e5e7eb", borderRadius: 8, padding: 16 }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
        <p style={{ margin: 0 }}>「{sourceLabel}」の集計</p>
        <button
          type="button"
          onClick={() => onDelete(query.id)}
          aria-label={`「${sourceLabel}」の集計を削除`}
          style={{ minHeight: 44, padding: "0 12px", background: "transparent", flexShrink: 0 }}
        >
          削除
        </button>
      </div>

      <fieldset style={{ marginTop: 12, border: "1px solid #e5e7eb", borderRadius: 4, padding: 8 }}>
        <legend>絞り込み</legend>
        {builderState.filters.length > 0 && (
          <p style={{ margin: "0 0 4px", fontSize: 12, color: "#6b7280" }}>
            次のすべてに一致する行
          </p>
        )}
        {builderState.filters.map((filter, index) => {
          const category = effectiveCategory(filter.column, columnMeta, overrides);
          const operators = category && category !== "other" ? FILTER_OPERATORS[category] : [];
          const needsValue = filter.operator !== "is_null" && filter.operator !== "is_not_null";
          const invalid = diagnostics?.invalidFilterIndices.includes(index) ?? false;
          return (
            <div
              key={index}
              style={{ display: "flex", gap: 4, alignItems: "center", marginTop: 4 }}
            >
              {index > 0 && <span style={{ fontSize: 12, color: "#6b7280" }}>かつ</span>}
              <select
                ref={index === builderState.filters.length - 1 ? lastFilterColumnRef : undefined}
                aria-label={`条件${index + 1}: 列`}
                value={filter.column}
                onChange={(event: ChangeEvent<HTMLSelectElement>) => {
                  const column = event.target.value;
                  const nextCategory = effectiveCategory(column, columnMeta, overrides);
                  const validOperators =
                    nextCategory && nextCategory !== "other" ? FILTER_OPERATORS[nextCategory] : [];
                  const operatorStillValid = validOperators.some(
                    (op) => op.value === filter.operator,
                  );
                  updateFilter(index, {
                    ...filter,
                    column,
                    operator: operatorStillValid
                      ? filter.operator
                      : (validOperators[0]?.value ?? "eq"),
                  });
                }}
              >
                {filterableColumns.map((c) => (
                  <option key={c.name} value={c.name}>
                    {c.name}
                  </option>
                ))}
              </select>
              <select
                aria-label={`条件${index + 1}: 演算子`}
                value={filter.operator}
                onChange={(event: ChangeEvent<HTMLSelectElement>) =>
                  updateFilter(index, { ...filter, operator: event.target.value as FilterOperator })
                }
              >
                {operators.map((op) => (
                  <option key={op.value} value={op.value}>
                    {op.label}
                  </option>
                ))}
              </select>
              {needsValue && (
                // Keyed on column+operator, not just `index` (unlike this
                // row's other controls, which are fully controlled and so
                // don't need it): `FilterValueInput` holds UNCOMMITTED local
                // draft state that does not resync from the `value` prop
                // after mount, so removing an EARLIER row (shifting this
                // one's index down) must force a fresh mount rather than
                // silently keeping a previous row's stale, not-yet-committed
                // text under a reused component instance.
                <FilterValueInput
                  key={`${filter.column}-${filter.operator}`}
                  ariaLabel={`条件${index + 1}: 値`}
                  value={filter.value ?? ""}
                  onCommit={(value) => updateFilter(index, { ...filter, value })}
                />
              )}
              <button
                type="button"
                onClick={() => removeFilter(index)}
                aria-label={`条件${index + 1}を削除`}
                style={{ minHeight: 44, padding: "0 8px", background: "transparent" }}
              >
                削除
              </button>
              {invalid && (
                <span style={{ color: "#92400e" }} title="この値は列の種類として読み取れません">
                  ⚠
                </span>
              )}
            </div>
          );
        })}
        <button
          ref={addFilterButtonRef}
          type="button"
          onClick={addFilter}
          disabled={filterableColumns.length === 0}
          style={{ minHeight: 44, marginTop: 8, padding: "0 12px" }}
        >
          ＋ 条件を追加
        </button>
      </fieldset>

      <fieldset style={{ marginTop: 12, border: "1px solid #e5e7eb", borderRadius: 4, padding: 8 }}>
        <legend>集計</legend>
        <p style={{ margin: "0 0 4px", fontSize: 12, color: "#6b7280" }}>集計の単位（〜ごと）</p>
        {builderState.groupBy.map((column, index) => (
          <div key={index} style={{ display: "flex", gap: 4, alignItems: "center", marginTop: 4 }}>
            <select
              ref={index === builderState.groupBy.length - 1 ? lastGroupByColumnRef : undefined}
              aria-label={`集計の単位${index + 1}`}
              value={column}
              onChange={(event: ChangeEvent<HTMLSelectElement>) =>
                updateGroupBy(index, event.target.value)
              }
            >
              {filterableColumns.map((c) => (
                <option key={c.name} value={c.name}>
                  {c.name}
                </option>
              ))}
            </select>
            <button
              type="button"
              onClick={() => removeGroupBy(index)}
              aria-label={`集計の単位${index + 1}を削除`}
              style={{ minHeight: 44, padding: "0 8px", background: "transparent" }}
            >
              削除
            </button>
          </div>
        ))}
        <button
          ref={addGroupByButtonRef}
          type="button"
          onClick={addGroupBy}
          disabled={filterableColumns.length === 0}
          style={{ minHeight: 44, marginTop: 8, padding: "0 12px" }}
        >
          ＋ 単位を追加
        </button>

        <p style={{ margin: "12px 0 4px", fontSize: 12, color: "#6b7280" }}>集計する値</p>
        {builderState.measures.map((measure, index) => {
          const category = effectiveCategory(measure.column, columnMeta, overrides);
          // sum/avg require a number-effective column (issue #11c's own
          // category gate, generalized past "not date" -- see ADR-0012):
          // count is always offered regardless of category.
          const aggregateOptions: AggregateFn[] =
            category === "number" ? ["count", "sum", "avg"] : ["count"];
          // A measure whose column was overridden AWAY from `number`
          // elsewhere (the source card's own type-override `<select>`, not
          // this row) leaves `measure.aggregate` holding a value no longer
          // in `aggregateOptions` -- the resolver (`query-sql.ts`) already
          // drops this measure from the generated SQL entirely (same rule a
          // dangling column reference gets), but that silence alone doesn't
          // meet this PR's own success metric ("category<->演算子不整合を
          // runtimeで検出し警告"). This warning is the visible half of that
          // contract; `refreshQueryPreview`'s override-triggered sweep
          // (App.tsx) is the half that keeps the shown preview/diagnostics
          // numerically correct instead of stale.
          const aggregateMismatch = !aggregateOptions.includes(measure.aggregate);
          const excludedCount = diagnostics?.measureExcludedCounts.get(measure.column);
          // Two guard clauses, not a nested ternary-with-`&&` (/simplify
          // Simplification finding, issue 11c): the two warnings are
          // mutually exclusive (a mismatched measure was already dropped
          // entirely, so it has no per-row excluded count to report) and
          // reading this as one `? :` made that exclusivity harder to see
          // than the priority it actually is.
          let measureWarning: string | undefined;
          if (aggregateMismatch) {
            measureWarning = "⚠ 列の種類が変わったため、この集計は結果から除外されています";
          } else if (excludedCount !== undefined && excludedCount > 0) {
            measureWarning = `⚠ ${excludedCount}件は${CATEGORY_LABEL.number}として読み取れず除外`;
          }
          return (
            <div
              key={index}
              style={{ display: "flex", gap: 4, alignItems: "center", marginTop: 4 }}
            >
              <select
                ref={index === builderState.measures.length - 1 ? lastMeasureColumnRef : undefined}
                aria-label={`集計する値${index + 1}: 列`}
                value={measure.column}
                onChange={(event: ChangeEvent<HTMLSelectElement>) => {
                  const column = event.target.value;
                  const nextCategory = effectiveCategory(column, columnMeta, overrides);
                  updateMeasure(index, {
                    column,
                    aggregate: nextCategory === "number" ? measure.aggregate : "count",
                  });
                }}
              >
                {measurableColumns.map((c) => (
                  <option key={c.name} value={c.name}>
                    {c.name}
                  </option>
                ))}
              </select>
              <select
                aria-label={`集計する値${index + 1}: 集計方法`}
                value={measure.aggregate}
                onChange={(event: ChangeEvent<HTMLSelectElement>) =>
                  updateMeasure(index, { ...measure, aggregate: event.target.value as AggregateFn })
                }
              >
                {aggregateOptions.map((agg) => (
                  <option key={agg} value={agg}>
                    {AGGREGATE_LABEL[agg]}
                  </option>
                ))}
              </select>
              <button
                type="button"
                onClick={() => removeMeasure(index)}
                aria-label={`集計する値${index + 1}を削除`}
                style={{ minHeight: 44, padding: "0 8px", background: "transparent" }}
              >
                削除
              </button>
              {measureWarning && (
                <span style={{ color: "#92400e", fontSize: 12 }}>{measureWarning}</span>
              )}
            </div>
          );
        })}
        <button
          ref={addMeasureButtonRef}
          type="button"
          onClick={addMeasure}
          style={{ minHeight: 44, marginTop: 8, padding: "0 12px" }}
        >
          ＋ 値を追加
        </button>
      </fieldset>

      <div style={{ marginTop: 12, overflowX: "auto" }}>
        <table style={{ borderCollapse: "collapse", width: "100%" }}>
          <caption
            style={{ textAlign: "left", fontSize: 12, color: "#6b7280", padding: "0 0 4px" }}
          >
            「{sourceLabel}」の集計結果プレビュー
          </caption>
          <thead>
            <tr>
              {previewColumns.map((name) => (
                <th
                  key={name}
                  scope="col"
                  style={{ textAlign: "left", borderBottom: "1px solid #d1d5db", padding: 4 }}
                >
                  {name}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {previewRows.map((row, rowIndex) => (
              <tr key={rowIndex}>
                {previewColumns.map((name) => (
                  <td key={name} style={{ borderBottom: "1px solid #f3f4f6", padding: 4 }}>
                    {String(row[name] ?? "")}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div role="status" style={{ marginTop: 8, fontSize: 13 }}>
        {query.previewPending && <p style={{ margin: "4px 0" }}>計算中…</p>}
        {!query.previewPending && diagnostics && (
          <p style={{ margin: "4px 0" }}>
            該当 <strong>{diagnostics.matchedCount.toLocaleString("ja-JP")}</strong> 行
            {diagnostics.matchedCount !== diagnostics.totalCount &&
              `（全 ${diagnostics.totalCount.toLocaleString("ja-JP")} 行中）`}
            。<strong>元のファイルは変更されません。</strong>
          </p>
        )}
      </div>

      <div style={{ marginTop: 8 }}>
        <button
          type="button"
          onClick={() => onAddChart(query.id)}
          // Disabled until the query's OWN previewColumns resolve (shape
          // enumeration V-010): a chart created from an unresolved query
          // would have no real columns to build a valid encoding from.
          // `usableColumns` (code review, Angle C/Altitude -- 2 independent
          // convergent findings), not raw `previewColumns.length`: every
          // OTHER previewColumns consumer this PR added (`handleAddChart`,
          // `ChartBuilder.tsx`) already filters out empty-string column
          // names this way -- gating on the raw length here would let this
          // one button render enabled in that same edge case, only to have
          // `handleAddChart`'s own guard silently no-op the click.
          disabled={usableColumns(query.previewColumns).length === 0 || query.previewPending}
          aria-label={`「${sourceLabel}」の集計をグラフ化`}
          style={{
            minHeight: 44,
            padding: "0 16px",
            background: "#1a56db",
            color: "#fff",
            border: "none",
            borderRadius: 4,
          }}
        >
          グラフ化
        </button>
      </div>
    </div>
  );
});
