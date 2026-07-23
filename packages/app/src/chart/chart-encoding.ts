// Chart encoding reconciliation (issue #12, plan §type変更時のencoding再構築).
// Pure, framework-independent -- no React, no DuckDB.
import type { Row } from "@hyakkei/core/renderer";
import type { Chart, ChartOptions, ChartVariant } from "@hyakkei/schema";

/**
 * Chart-row LIMIT for live preview (plan §チャート行データ). A compile-time
 * integer constant -- never user-typed -- balancing usefulness against
 * ECharts SVG-renderer performance for scatter/table.
 */
export const CHART_ROW_LIMIT = 5000;

/**
 * Appends a numeric-only LIMIT clause (plan §チャート行データ, Codexレビュー②
 * Minor指摘): a dedicated helper, not `` `${sql} LIMIT ${n}` `` copy-pasted at
 * each call site, so the "numeric literal only, never user input" invariant
 * has exactly one place to hold. Assumes `sql` is GUI-generated (no trailing
 * semicolon, no existing LIMIT) -- see plan's scope-boundary note for F7.
 *
 * Enforces the invariant itself at runtime (Security review, Phase 8 Minor):
 * the only current call site passes the `CHART_ROW_LIMIT` constant, so this
 * guard is unreachable today -- but a helper whose own doc comment claims to
 * be the single place the invariant holds should not rely entirely on
 * callers never passing something else. Guards against the day `limit`
 * becomes caller-configurable and this stops being true by construction.
 */
export function appendLimit(sql: string, limit: number): string {
  if (!Number.isInteger(limit) || limit <= 0) {
    throw new RangeError(`appendLimit: limit must be a positive integer, got ${limit}`);
  }
  return `${sql} LIMIT ${limit}`;
}

/**
 * Whether a fetched row count means the query MAY have had more rows than
 * `CHART_ROW_LIMIT` (QA Phase 8, V-008) -- extracted as its own pure
 * function (not inlined at the one call site, `App.tsx`'s `refreshChartRows`)
 * so the boundary condition has a DuckDB-independent unit test, matching
 * this module's own "no React, no DuckDB" scope.
 */
export function isTruncated(rowCount: number): boolean {
  return rowCount >= CHART_ROW_LIMIT;
}

export type EncodingFieldDef = { key: string; label: string; optional?: boolean };

/**
 * One entry per `ChartVariant` field, in display order, with the plain
 * Japanese label the plan's UX design calls for (never raw x/y jargon).
 */
export const ENCODING_FIELDS: Record<ChartVariant["type"], EncodingFieldDef[]> = {
  bar: [
    { key: "x", label: "横軸" },
    { key: "y", label: "縦軸" },
  ],
  line: [
    { key: "x", label: "横軸" },
    { key: "y", label: "縦軸" },
  ],
  area: [
    { key: "x", label: "横軸" },
    { key: "y", label: "縦軸" },
  ],
  scatter: [
    { key: "x", label: "横軸の値" },
    { key: "y", label: "縦軸の値" },
    { key: "size", label: "点の大きさ", optional: true },
  ],
  pie: [
    { key: "category", label: "分類" },
    { key: "value", label: "値" },
  ],
  table: [{ key: "columns", label: "表示する列" }],
  stat: [{ key: "value", label: "表示する値" }],
};

type EncodingRecord = Record<string, string | string[] | undefined>;

function flattenColumns(encoding: EncodingRecord): string[] {
  return Object.values(encoding).flatMap((value) =>
    value === undefined ? [] : Array.isArray(value) ? value : [value],
  );
}

/**
 * Filters a query's `previewColumns` to names `reconcileEncoding` can
 * actually use (Codex Round 1 P2): `ChartVariant`'s encoding values are
 * `NonEmptyString` (`common.ts`) -- an empty-string Arrow field name (a
 * theoretical edge, but not one this resolver's own SQL generation rules
 * out at the type level) would otherwise pass previewColumns-membership
 * checks and reach `Chart.encoding` as an invalid value. Every consumer of
 * `previewColumns` for chart creation/reconciliation (`ChartBuilder.tsx`,
 * `App.tsx`'s `handleAddChart`) must call this, not use `query.previewColumns`
 * directly.
 */
export function usableColumns(previewColumns: string[]): string[] {
  return previewColumns.filter((column) => column.length > 0);
}

/**
 * Position-based smart default (plan §UI設計): the first `previewColumns`
 * entry reads as "the dimension", the last as "the measure" -- a v1
 * heuristic that needs no column-type introspection (category gating is
 * explicitly deferred, plan §スコープ外). A single-column query reuses that
 * one column for both slots (shape enumeration CS-13: this is the only
 * shape that keeps every chart type structurally valid with 1 column).
 */
function smartDefaultColumn(slot: 0 | 1, previewColumns: string[]): string {
  if (slot === 0) return previewColumns[0]!;
  return previewColumns.length > 1 ? previewColumns[previewColumns.length - 1]! : previewColumns[0]!;
}

/**
 * Rebuilds `encoding` fresh for `nextType` (plan §type変更時のencoding再構築):
 * never spreads/carries the previous type's encoding object forward. Reuses
 * previously-referenced COLUMN VALUES (not field names) as a best-effort
 * pool when they still exist in `previewColumns`, falling back to the
 * position-based smart default otherwise. Self-filters `previewColumns`
 * through `usableColumns` (code review, Angle Altitude: a single choke
 * point, so a caller cannot bypass the empty-string-column guard by simply
 * forgetting to call `usableColumns` itself first). Requires at least one
 * USABLE column (shape enumeration F3: the caller only invokes this once a
 * query has resolved) -- throws otherwise (Codex Round 1 P1: a caller
 * invoking this with zero columns, e.g. after a query error clears
 * `previewColumns`, would otherwise silently produce `NonEmptyString`
 * encoding fields holding `undefined`).
 */
export function reconcileEncoding(
  prevEncoding: EncodingRecord | undefined,
  nextType: ChartVariant["type"],
  rawPreviewColumns: string[],
): ChartVariant["encoding"] {
  const previewColumns = usableColumns(rawPreviewColumns);
  if (previewColumns.length === 0) {
    throw new RangeError("reconcileEncoding: previewColumns must be non-empty");
  }
  const carryOver = prevEncoding
    ? flattenColumns(prevEncoding).filter((column) => previewColumns.includes(column))
    : [];
  const pick = (slot: 0 | 1): string => carryOver[slot] ?? smartDefaultColumn(slot, previewColumns);

  switch (nextType) {
    case "bar":
    case "line":
    case "area":
      return { x: pick(0), y: pick(1) };
    case "scatter": {
      const size = carryOver[2];
      return { x: pick(0), y: pick(1), size: size && previewColumns.includes(size) ? size : undefined };
    }
    case "pie":
      return { category: pick(0), value: pick(1) };
    case "table":
      // `previewColumns` is already guaranteed non-empty here (the guard
      // above throws otherwise), so there is no fallback branch to write
      // (`/simplify` Simplification finding: the prior `? : [pick(0)]`
      // ternary's false branch could never execute).
      return { columns: [...previewColumns] };
    case "stat":
      return { value: pick(0) };
  }
}

/**
 * Clears type-dependent options on a type switch (plan §type変更時の
 * encoding再構築): `donut` only means anything for `type: "pie"` -- carrying
 * it past a switch away from pie would silently persist a meaningless flag
 * (schema itself wouldn't reject it, but it has no effect and would confuse
 * a later type-switch back to pie with a stale value the user never chose
 * this time).
 */
export function reconcileChartOptions(prevOptions: ChartOptions, nextType: ChartVariant["type"]): ChartOptions {
  if (nextType === "pie" || prevOptions.donut === undefined) return prevOptions;
  const { donut: _donut, ...rest } = prevOptions;
  return rest;
}

/** The 8 visual type-picker tiles (plan §UI設計): donut maps to `type: "pie"` + `options.donut: true`, not a separate schema type. */
export type ChartTypeTile = "bar" | "line" | "area" | "scatter" | "pie" | "donut" | "table" | "stat";

export const CHART_TYPE_TILES: Array<{ key: ChartTypeTile; label: string; group: string }> = [
  { key: "bar", label: "棒グラフ", group: "比較" },
  { key: "line", label: "折れ線グラフ", group: "推移" },
  { key: "area", label: "面グラフ", group: "推移" },
  { key: "scatter", label: "散布図", group: "相関" },
  { key: "pie", label: "円グラフ", group: "割合" },
  { key: "donut", label: "ドーナツグラフ", group: "割合" },
  { key: "table", label: "表", group: "一覧" },
  { key: "stat", label: "単一の値", group: "単一の値" },
];

export function tileToVariant(tile: ChartTypeTile): { type: ChartVariant["type"]; donut: boolean } {
  return tile === "donut" ? { type: "pie", donut: true } : { type: tile, donut: false };
}

export function variantToTile(chart: Pick<Chart, "type" | "options">): ChartTypeTile {
  return chart.type === "pie" && chart.options.donut ? "donut" : chart.type;
}

/**
 * Which `ENCODING_FIELDS` keys a chart type feeds through a numeric axis
 * (plan §型不一致encodingの検知). `stat` is deliberately absent -- `dom/
 * stat.ts`'s `buildStatElement` renders `value` via `cellText` (plain text),
 * never `numericCell` (shape enumeration F1) -- and `table`'s `columns` is
 * never numeric-consuming by definition. `scatter` lists all three of its
 * fields (`build-options.ts` confirmed x/y/size are each independently
 * passed through `numericCell`), not just `y`.
 */
const NUMERIC_CHANNELS: Partial<Record<ChartVariant["type"], string[]>> = {
  bar: ["y"],
  line: ["y"],
  area: ["y"],
  scatter: ["x", "y", "size"],
  pie: ["value"],
};

function isNumericValue(value: Row[string] | undefined): boolean {
  return typeof value === "number" && Number.isFinite(value);
}

/**
 * Result-based type-mismatch detection (plan §型不一致encodingの検知): after
 * rendering, checks whether a chart type's OWN numeric-consuming channel(s)
 * are entirely non-numeric across every row -- not "any channel is null"
 * (which would false-positive on a legitimately-empty result or a single
 * bad axis in a multi-channel type). Returns the mismatched channel KEYS
 * (e.g. `["y"]`), empty when there are no rows yet (nothing to judge) or no
 * mismatch found.
 *
 * A channel whose column is ABSENT from every row's own keys is skipped
 * entirely, not flagged (code review, Angle A): that shape means the
 * column no longer exists in the query's current output (e.g. RR-6 -- an
 * elsewhere-made override change dropped it), which the renderer's own
 * pre-existing missing-column tile ("データに列が見つかりません") already
 * reports accurately. Flagging it here too would show a second, actively
 * WRONG message next to that one ("could not be recognized as numeric" for
 * a column that isn't non-numeric -- it simply isn't there).
 *
 * Takes `type`/`encoding` separately, not a whole `Chart` (code review
 * Round 3, Angle Efficiency): a caller memoizing this against React state
 * needs to depend on exactly the two fields that affect the result, not
 * the whole chart object -- which also changes on every title/options-only
 * edit and would otherwise defeat the memoization entirely.
 */
export function detectNumericMismatch(
  type: ChartVariant["type"],
  encoding: ChartVariant["encoding"],
  rows: Row[],
): string[] {
  if (rows.length === 0) return [];
  const channels = NUMERIC_CHANNELS[type];
  if (!channels) return [];
  const encodingRecord = encoding as Record<string, string | string[] | undefined>;
  return channels.filter((key) => {
    const column = encodingRecord[key];
    if (typeof column !== "string") return false;
    const columnExists = rows.some((row) => Object.hasOwn(row, column));
    return columnExists && rows.every((row) => !isNumericValue(row[column]));
  });
}
