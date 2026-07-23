import type {
  ColumnCategory,
  DataSourceErrorKind,
  NetworkBlockedReason,
  RegisteredTable,
} from "@hyakkei/core/datasource";
import type { Row } from "@hyakkei/core/renderer";
import type { AggregateFn, BuilderState } from "@hyakkei/schema";

/**
 * `DataSourceErrorKind` (core) plus two app-only leaves for failures that
 * never reach `DataSource.inspect()/register()` at all: `data-layer-load`
 * (the dynamic-import chunk itself failed to fetch, issue #91) and
 * `legacy-xls` (rejected by `fileFormatFromName` before any DataSource is
 * even constructed, issue #42). Kept as a superset here, not added as a
 * leaf to the core union — `DataSourceErrorKind`'s own contract ("leaf
 * addition only, no reshape") is about errors `DataSource` implementations
 * throw; these two are app-layer classification, not core layer.
 */
export type AppErrorKind = DataSourceErrorKind | "data-layer-load" | "legacy-xls";

export type IntakeError = {
  kind: AppErrorKind;
  reason: NetworkBlockedReason | undefined;
  message: string;
};

export type IntakeSample = {
  table: RegisteredTable;
  rows: Record<string, unknown>[];
};

/**
 * The persisted shape (`Source.typeOverrides`, `@hyakkei/schema`) for one
 * column's manual type override (issue #11b). App.tsx keeps
 * `WorkspaceSource.typeOverrides` in this exact array shape (not a
 * column-name-keyed object) so a future save path (F7) can project it
 * verbatim, no separate runtime<->schema conversion to keep in sync.
 */
export type ColumnOverride = { column: string; category: ColumnCategory };

/**
 * Exhaustive `ColumnCategory` -> display-label lookup (/code-review
 * Simplification finding, issue #11b): a `Record<ColumnCategory, string>`
 * makes an un-updated call site a TS compile error the day `ColumnCategory`
 * itself ever grows, instead of a silent copy-paste bug. Shared here
 * (/simplify Reuse finding, issue 11c) rather than re-declared per
 * component: `RegisteredSummary.tsx` and `QueryBuilder.tsx` both need it,
 * and a 3rd independent copy would defeat the single-source-of-truth this
 * `Record` exists for in the first place.
 */
export const CATEGORY_LABEL: Record<ColumnCategory, string> = {
  text: "文字",
  number: "数値",
  date: "日付",
};

export function categoryLabel(category: ColumnCategory | "other" | undefined): string {
  return category === undefined || category === "other" ? "その他" : CATEGORY_LABEL[category];
}

/**
 * `ColumnOverride[]` -> `Map<column, category>`, the lookup shape every
 * consumer actually wants (/simplify Reuse finding, issue 11c): this exact
 * transform was independently re-written in `RegisteredSummary.tsx`,
 * `QueryBuilder.tsx`, and twice in `App.tsx` before being extracted here.
 */
export function overrideMap(typeOverrides: ColumnOverride[]): Map<string, ColumnCategory> {
  return new Map(typeOverrides.map((entry) => [entry.column, entry.category]));
}

/**
 * Shared here (moved from `QueryBuilder.tsx`, issue #12), same reasoning as
 * `CATEGORY_LABEL` above: `ChartBuilder.tsx` also needs it to build friendly
 * measure-alias labels for encoding `<select>`s (plan §UI設計).
 */
export const AGGREGATE_LABEL: Record<AggregateFn, string> = {
  sum: "合計",
  count: "個数",
  avg: "平均",
};

/**
 * A query's `previewColumns` entry is either a raw groupBy column name or a
 * measure alias (`${aggregate}_${column}`, `query-sql.ts`'s
 * `measureAliasBase`) -- this reverses that convention for display, so
 * `ChartBuilder.tsx`'s encoding pickers can show "合計(売上)" instead of the
 * raw `sum_amount` alias (plan §UI設計). Best-effort: a column-name
 * collision that forced `uniqueRawAlias` to suffix the alias falls back to
 * showing the raw name verbatim, same as any other unrecognized column.
 */
export function friendlyColumnLabel(column: string, query: WorkspaceQuery): string {
  const measure = query.builderState.measures.find((m) => `${m.aggregate}_${m.column}` === column);
  return measure ? `${AGGREGATE_LABEL[measure.aggregate]}(${measure.column})` : column;
}

/**
 * Per-query chart-row fetch state (issue #12, plan §チャート行データ). A
 * discriminated union, not `rows: Row[] | null` + a separate `pending`
 * boolean -- without a distinct `"pending"` state, a chart's first-ever
 * fetch and a query that resolved to zero rows are visually identical (a
 * blank preview), which shape enumeration flagged as a transient
 * "データがありません" flash on every newly-added chart (Doherty/UX gap).
 *
 * `truncated` (QA Phase 8, V-008) is `true` when `rows.length` hit
 * `CHART_ROW_LIMIT` exactly -- the query MAY have had more rows than that,
 * but this state alone can't distinguish "exactly the limit" from "more
 * than the limit" (the fetch only ever asks for `CHART_ROW_LIMIT` rows).
 * Treating a limit-hitting result as "possibly truncated" is the correct,
 * fail-closed reading: understating the risk (only warning when a row
 * count PROVABLY exceeds the limit) would need fetching `LIMIT + 1` rows
 * just to tell the difference, for a warning whose only job is "the number
 * you see may not be everything."
 */
export type ChartRowState =
  | { status: "pending" }
  | { status: "ready"; rows: Row[]; truncated: boolean }
  | { status: "error" };

/**
 * An orthogonal diagnostic on top of the pass/fail cast outcome (/code-review
 * Angle D, confirmed): a value can `TRY_CAST` successfully and STILL silently
 * lose information -- a long integer-like "number" override rounding past
 * DOUBLE's 53-bit exact range, or a "date" override discarding an explicit
 * UTC offset. Optional and orthogonal to `status` (a column can be "valid"
 * AND carry an advisory) because neither condition makes the cast itself
 * fail.
 */
export type ColumnValidationAdvisory =
  { kind: "precision-loss"; count: number } | { kind: "date-offset-discarded"; count: number };

/**
 * Per-column outcome of the TRY_CAST validation query an override change
 * triggers (issue #11b). `samples` is a few `{original, parsed}` pairs
 * shown regardless of outcome (V-001: a successful cast can still be a
 * silent misinterpretation, e.g. date field order -- a count alone can
 * never surface that, only inspection can).
 */
export type ColumnValidationState =
  | { status: "pending" }
  | {
      status: "valid";
      samples: Array<{ original: string; parsed: string | null }>;
      advisory?: ColumnValidationAdvisory;
    }
  | {
      status: "warning";
      nonNullCount: number;
      uncastableCount: number;
      samples: Array<{ original: string; parsed: string | null }>;
      advisory?: ColumnValidationAdvisory;
    }
  | { status: "failed" };

/**
 * One row of the editor's typed preview (issue #11b). `values` mirrors
 * `IntakeSample.rows`' shape exactly -- for an overridden column whose
 * `TRY_CAST` failed on this row, `values` holds the ORIGINAL raw value (not
 * `NULL`), and `castFailed` names that column so the UI can mark it
 * distinctly from a cell that was genuinely empty to begin with
 * (`buildTypedPreviewSql`'s own doc: a failed cast and a true null are
 * otherwise indistinguishable from the typed result alone).
 */
export type PreviewRow = { values: Record<string, unknown>; castFailed: Set<string> };

/**
 * "No silently-vanishing rows" diagnostics for one query (issue #11c),
 * mirroring `buildQueryDiagnosticsSql`'s (packages/core) three distinct
 * causes of missing/excluded data -- kept as three separate fields rather
 * than one opaque total so each can be surfaced with its own message.
 */
export type QueryDiagnostics = {
  totalCount: number;
  matchedCount: number;
  /** Indices into `builderState.filters` whose typed VALUE didn't parse as that column's category (a typo, not a data problem). */
  invalidFilterIndices: number[];
  /**
   * column name -> how many otherwise non-null rows failed TRY_CAST and were
   * silently excluded from that sum/avg measure. A `Map`, not a
   * column-name-keyed plain object (Codex review R1 P1): a column literally
   * named `__proto__` is schema-valid, but `obj["__proto__"] = n` silently
   * no-ops onto the inherited prototype accessor instead of creating a real
   * own property -- the exact class of bug `rowToPlainObject`'s
   * `Object.fromEntries` use elsewhere in this codebase already exists to
   * avoid.
   */
  measureExcludedCounts: Map<string, number>;
};

/**
 * The light-shaping GUI's per-query workspace state (issue #11c). A sibling
 * entity to `WorkspaceSource`, not nested inside it -- one source can have
 * several queries, and a query is the entity `#12`'s chart tiles will
 * reference by id (`Chart.query`, `@hyakkei/schema`). `builderState` is
 * always the query's exact schema-shaped `Query.builderState` -- no
 * separate runtime<->schema conversion, same discipline
 * `WorkspaceSource.typeOverrides` already established.
 *
 * `previewPending` here is unconditionally query-scoped -- there is no
 * column-scoped "pending" sub-state to reconcile the way #11b's
 * `previewPending` had to span a wider window than a single column's own
 * validation status, since a query's preview and diagnostics are always
 * fetched together in one round-trip, not two.
 */
export type WorkspaceQuery = {
  id: string;
  sourceTableId: string;
  builderState: BuilderState;
  /**
   * The exact, self-contained SQL `builderState` compiles to (Codex review
   * R1 P0) -- kept in lockstep with `builderState` on every refresh so this
   * runtime state genuinely mirrors what a persisted `Query.sql` +
   * `Query.builderState` pair would hold once F7 (save/open) exists, not
   * just a `builderState` with no corresponding "GUI emits SQL" output at
   * all (PRD F2 / ARCHITECTURE §4's own framing).
   */
  sql: string;
  previewRows: Record<string, unknown>[] | null;
  /**
   * The query result's OWN output column names (Codex review R1 P2), read
   * from the Arrow result schema -- present even when `previewRows` is
   * empty (a real Arrow result carries field names regardless of row
   * count). Falling back to the SOURCE table's columns for a zero-row
   * aggregate/grouped query would show the wrong header shape entirely
   * (raw source columns instead of the query's own group-by/measure-alias
   * columns).
   */
  previewColumns: string[];
  diagnostics: QueryDiagnostics | null;
  previewPending: boolean;
};

/**
 * D10's 5 states (Empty/Reading/SheetPick/Preview+Registered統合/Error),
 * collapsed to the exact set the plan names — `inspect()` and `register()`
 * both render as "reading" (no separate "registering" phase: neither
 * `EgressPolicy.fetchBytes()` nor `DataSource.register()` exposes a
 * progress callback today, so a UI-visible distinction between the two
 * calls would be fabricated, not observed — plan's own "known follow-up"
 * scope boundary, same gap as the missing `AbortSignal`). "Preview" and
 * "Registered" are the same `registered` phase (D10's eager-register
 * decision: by the time this state exists, the table is already live and
 * queryable — there is nothing left to separately "confirm").
 */
export type IntakeState =
  | { phase: "empty"; note?: string }
  | {
      phase: "blocked";
      sourceLabel: string;
      reason: NetworkBlockedReason | undefined;
      message: string;
    }
  | { phase: "reading"; sourceLabel: string }
  | { phase: "sheet-pick"; sourceLabel: string; sheets: string[] }
  | { phase: "registered"; sourceLabel: string; sample: IntakeSample }
  | { phase: "error"; sourceLabel: string; error: IntakeError };

export type IntakeAction =
  | { type: "SUBMIT"; sourceLabel: string }
  | {
      type: "BLOCKED";
      sourceLabel: string;
      reason: NetworkBlockedReason | undefined;
      message: string;
    }
  | { type: "SHEETS_FOUND"; sheets: string[] }
  | { type: "SHEET_CHOSEN" }
  | { type: "REGISTERED"; sample: IntakeSample }
  | { type: "FAILED"; error: IntakeError }
  | { type: "CANCEL" }
  | { type: "RESET"; note?: string };

export const INITIAL_STATE: IntakeState = { phase: "empty" };

/**
 * Pure by construction (no DuckDB/network/timer access) — the caller
 * (`IntakeApp.tsx`) is solely responsible for deciding WHEN to dispatch
 * (including discarding a stale async result via its own generation
 * counter before ever calling `dispatch`); this function only decides
 * WHAT the next state is, given an action it trusts already happened.
 *
 * `BLOCKED`/`SHEETS_FOUND`/`SHEET_CHOSEN`/`REGISTERED`/`FAILED` all guard on
 * the current phase (return `state` unchanged otherwise) — the same
 * discard-stale-transition discipline the caller (`IntakeApp.tsx`'s
 * generation counter) applies to async results, applied here too as a
 * second line of defense (/code-review: `FAILED`/`BLOCKED` were the two
 * exceptions to this convention until now — an asymmetry independently
 * flagged from two different review angles). Every action here is only
 * ever meaningful arriving from ONE specific phase in `IntakeApp.tsx`'s
 * actual call sites (`BLOCKED` only from `UrlPanel`, itself only mounted
 * during "empty"; `FAILED` only from an async continuation started while
 * "reading"), so guarding all five is what makes the reducer's own
 * documentation of its stale-dispatch discipline actually match its code,
 * not a behavior change under correct operation.
 */
export function intakeReducer(state: IntakeState, action: IntakeAction): IntakeState {
  switch (action.type) {
    case "SUBMIT":
      return { phase: "reading", sourceLabel: action.sourceLabel };
    case "BLOCKED":
      if (state.phase !== "empty") return state;
      return {
        phase: "blocked",
        sourceLabel: action.sourceLabel,
        reason: action.reason,
        message: action.message,
      };
    case "SHEETS_FOUND":
      if (state.phase !== "reading") return state;
      return { phase: "sheet-pick", sourceLabel: state.sourceLabel, sheets: action.sheets };
    case "SHEET_CHOSEN":
      if (state.phase !== "sheet-pick") return state;
      return { phase: "reading", sourceLabel: state.sourceLabel };
    case "REGISTERED":
      if (state.phase !== "reading") return state;
      return { phase: "registered", sourceLabel: state.sourceLabel, sample: action.sample };
    case "FAILED":
      if (state.phase !== "reading") return state;
      return { phase: "error", sourceLabel: state.sourceLabel, error: action.error };
    case "CANCEL":
      return { phase: "empty", note: "読み込みを中止しました" };
    case "RESET":
      // `note` is optional and caller-supplied (UX review M-2): a plain
      // reset (error retry, blocked-URL back) carries none, but a
      // successful "確定" carries a completion note — without this, the
      // one moment a registration actually SUCCEEDED gave less feedback
      // than cancelling one, exactly the "登録できたが何も起きない"
      // dead-end D7 otherwise avoids.
      return { phase: "empty", note: action.note };
  }
}
