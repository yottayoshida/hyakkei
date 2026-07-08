import Ajv, { type ErrorObject, type ValidateFunction } from "ajv";
import addFormats from "ajv-formats";
import { BakedDashboard, type BakedDashboard as BakedDashboardT } from "./baked.js";
import { CURRENT_VERSION, GRID_WIDTHS, type Grid, type LayoutItem } from "./common.js";
import { Dashboard, type Dashboard as DashboardT } from "./dashboard.js";

// removeAdditional defaults to false, which is required for additive-only
// forward-compat: unknown fields must survive validation unmodified, not be
// silently stripped (shape enumeration S4/B4 — this is the load-bearing flag).
const ajv = new Ajv({ allErrors: true });
addFormats(ajv);

const validateDashboardSchema: ValidateFunction<DashboardT> = ajv.compile(Dashboard);
const validateBakedDashboardSchema: ValidateFunction<BakedDashboardT> = ajv.compile(BakedDashboard);

export type ParseResult<T> =
  { ok: true; value: T } | { ok: false; reason: string; errors?: ErrorObject[] };

function checkVersion(doc: unknown): string | undefined {
  if (typeof doc !== "object" || doc === null || !("version" in doc)) {
    return "missing required field 'version'";
  }
  const version = (doc as { version: unknown }).version;
  if (version !== CURRENT_VERSION) {
    return `unsupported schema version ${JSON.stringify(version)} — this build of hyakkei only reads version ${CURRENT_VERSION}; open this file with a newer hyakkei, or re-save it as version ${CURRENT_VERSION}`;
  }
  return undefined;
}

/**
 * Version is checked before running the full JSON Schema validator so an
 * unknown major version gets one specific, actionable message (shape
 * enumeration S5/DA-13) instead of being buried in a generic Ajv error dump.
 */
export function parseDashboard(doc: unknown): ParseResult<DashboardT> {
  const versionError = checkVersion(doc);
  if (versionError) return { ok: false, reason: versionError };
  if (!validateDashboardSchema(doc)) {
    return {
      ok: false,
      reason: "schema validation failed",
      errors: validateDashboardSchema.errors ?? [],
    };
  }
  return { ok: true, value: doc as DashboardT };
}

export function parseBakedDashboard(doc: unknown): ParseResult<BakedDashboardT> {
  const versionError = checkVersion(doc);
  if (versionError) return { ok: false, reason: versionError };
  if (!validateBakedDashboardSchema(doc)) {
    return {
      ok: false,
      reason: "schema validation failed",
      errors: validateBakedDashboardSchema.errors ?? [],
    };
  }
  return { ok: true, value: doc as BakedDashboardT };
}

export type ReferenceIssue = {
  kind: "dangling" | "duplicate" | "overlap" | "out-of-bounds" | "reserved-word";
  message: string;
};

/**
 * DuckDB reserved keywords — snapshotted from `duckdb/src/parser/peg/
 * keyword_map.cpp`'s `reserved_keyword_map` (main branch, checked
 * 2026-07-08). DuckDB's core engine version is independent of the
 * `@duckdb/duckdb-wasm` npm package version this project pins (1.32.0 is the
 * npm package's own version number, not a core-engine release) — re-sync
 * this list against a DuckDB *engine* upgrade, not an `@duckdb/duckdb-wasm`
 * bump. `SqlIdentifier`'s pattern (common.ts) cannot express keyword
 * membership — every letter of a keyword is itself a valid identifier
 * character — so this list exists purely to give an author a clear rejection
 * reason at authoring time. It is defense-in-depth, not the primary defense:
 * generated SQL always double-quotes identifiers (`CREATE TABLE "<id>"`),
 * which makes a reserved word syntactically safe regardless of this list —
 * DuckDB's own `KeywordHelper::RequiresQuotes` follows the same
 * quote-when-needed principle rather than reject-when-keyword.
 */
const DUCKDB_RESERVED_WORDS = new Set([
  "all",
  "analyse",
  "analyze",
  "and",
  "any",
  "array",
  "as",
  "asc",
  "asymmetric",
  "both",
  "case",
  "cast",
  "check",
  "collate",
  "column",
  "constraint",
  "create",
  "default",
  "deferrable",
  "desc",
  "describe",
  "distinct",
  "do",
  "else",
  "end",
  "except",
  "false",
  "fetch",
  "for",
  "foreign",
  "from",
  "group",
  "having",
  "in",
  "initially",
  "intersect",
  "into",
  "lambda",
  "lateral",
  "leading",
  "limit",
  "not",
  "null",
  "offset",
  "on",
  "only",
  "or",
  "order",
  "pivot",
  "pivot_longer",
  "pivot_wider",
  "placing",
  "primary",
  "qualify",
  "references",
  "returning",
  "select",
  "show",
  "some",
  "summarize",
  "symmetric",
  "table",
  "then",
  "to",
  "trailing",
  "true",
  "union",
  "unique",
  "unpivot",
  "using",
  "variadic",
  "when",
  "where",
  "window",
  "with",
]);

/**
 * Only applied to `Source.id` — not `Query.id`/`Chart.id` (never become a
 * table name) and not `Query.source` either, despite `Query.source` sharing
 * `Source.id`'s `SqlIdentifier` type: `Query.source` introduces no reserved-
 * word risk `Source.id` doesn't already cover. If a `Query.source` value
 * matches a declared `Source.id`, that source was already checked when it
 * was declared. If it doesn't match any declared source, that's a dangling
 * reference (a different, already-reported issue) — a reserved-word FK
 * value that resolves to nothing is not, on its own, a new SQL-identifier
 * hazard. Case-insensitive because DuckDB identifier lookups are always
 * case-insensitive, quoted or not (confirmed against DuckDB's own docs —
 * "DuckDB also treats quoted identifiers as case-insensitive"), so
 * `select`/`Select`/`SELECT` are equally unsafe as an unquoted identifier.
 */
function checkReservedWord(id: string, label: string, issues: ReferenceIssue[]): void {
  if (DUCKDB_RESERVED_WORDS.has(id.toLowerCase())) {
    issues.push({
      kind: "reserved-word",
      message: `${label} id '${id}' is a SQL reserved word; choose a different id`,
    });
  }
}

/** What every `collectIds` caller actually needs — "does this id refer to something declared?" — without exposing how (or whether) the lookup key was folded. */
type IdLookup = { has(id: string): boolean };

/**
 * Records each item's id, pushing a "duplicate" issue for repeats (naming
 * *which* earlier id it collides with — see below). `caseInsensitive` folds
 * the comparison key to lowercase — for `Source.id`, where DuckDB's
 * case-insensitive identifier lookup means `Apps` and `apps` would silently
 * clobber the same table despite passing an exact-match check (shape
 * enumeration SI-B4). `Query`/`Chart` ids have no such consequence and keep
 * exact-match-only comparison.
 *
 * Returns an `IdLookup`, not a raw `Set`, so folding is applied *inside*
 * `.has()` and every caller passes the id as-authored — no caller can get
 * the fold wrong or forget it. An earlier version returned the folded `Set`
 * directly: it fixed SI-B4's duplicate-detection case but left every
 * *caller* responsible for re-deriving the same fold before its own
 * `.has()` call, so `Source.id: "Apps"` / `Query.source: "apps"` (a valid
 * reference; DuckDB resolves both to the same table) was flagged as a
 * false-positive dangling reference until the one caller that existed at
 * the time was patched by hand — a fix that only holds until the next new
 * caller forgets it too. Folding once, behind the returned lookup's own
 * `.has()`, removes the caller's chance to get it wrong at all.
 */
function collectIds<T>(
  items: T[],
  getId: (item: T) => string,
  label: string,
  issues: ReferenceIssue[],
  options?: { caseInsensitive?: boolean },
): IdLookup {
  const fold = options?.caseInsensitive ? (id: string) => id.toLowerCase() : (id: string) => id;
  const declared = new Map<string, string>(); // folded key -> first-declared original id
  for (const item of items) {
    const id = getId(item);
    const key = fold(id);
    const original = declared.get(key);
    if (original !== undefined) {
      issues.push({
        kind: "duplicate",
        message: `duplicate ${label} id '${id}' (already declared as '${original}')`,
      });
    } else {
      declared.set(key, id);
    }
  }
  return { has: (id: string) => declared.has(fold(id)) };
}

/**
 * Checks JSON Schema structurally cannot express (shape enumeration AA-6/7/8):
 * cross-array id references, id uniqueness, and layout grid overlap. Without
 * these, a document that passes schema validation can still crash the
 * renderer — this is why the check ships alongside the schema, not deferred
 * to the renderer to discover ad hoc.
 */
export function validateDashboardReferences(doc: DashboardT): ReferenceIssue[] {
  const issues: ReferenceIssue[] = [];
  const sourceIds = collectIds(doc.sources, (s) => s.id, "source", issues, {
    caseInsensitive: true,
  });
  for (const s of doc.sources) checkReservedWord(s.id, "source", issues);

  const queryIds = collectIds(doc.queries, (q) => q.id, "query", issues);
  for (const q of doc.queries) {
    if (!sourceIds.has(q.source)) {
      issues.push({
        kind: "dangling",
        message: `query '${q.id}' references unknown source '${q.source}'`,
      });
    }
  }

  const chartIds = collectIds(doc.charts, (c) => c.id, "chart", issues);
  for (const c of doc.charts) {
    if (c.query !== undefined && !queryIds.has(c.query)) {
      issues.push({
        kind: "dangling",
        message: `chart '${c.id}' references unknown query '${c.query}'`,
      });
    }
  }

  issues.push(...validateLayoutReferences(doc.layout.grid, doc.layout.items, chartIds));
  return issues;
}

export function validateBakedDashboardReferences(doc: BakedDashboardT): ReferenceIssue[] {
  const issues: ReferenceIssue[] = [];
  const chartIds = collectIds(doc.charts, (c) => c.id, "chart", issues);
  issues.push(...validateLayoutReferences(doc.layout.grid, doc.layout.items, chartIds));
  return issues;
}

/**
 * `grid` is threaded through from the document (not hardcoded) so this reads
 * its width from `GRID_WIDTHS` (common.ts) — the one place `Grid`'s own
 * literals and their widths are paired. Adding a second `Grid` literal
 * without adding it to `GRID_WIDTHS` throws here immediately, rather than
 * silently checking every document against the wrong width.
 */
function validateLayoutReferences(
  grid: Grid,
  items: LayoutItem[],
  chartIds: IdLookup,
): ReferenceIssue[] {
  const issues: ReferenceIssue[] = [];
  const gridWidth = GRID_WIDTHS[grid];
  if (gridWidth === undefined)
    throw new Error(`no GRID_WIDTHS entry for grid '${grid}' (common.ts)`);
  for (const item of items) {
    if (!chartIds.has(item.chart)) {
      issues.push({
        kind: "dangling",
        message: `layout item references unknown chart '${item.chart}'`,
      });
    }
    // x's own schema bound only rules out a single item starting outside the
    // grid; it cannot express "x + w <= width" — that's a cross-field sum no
    // JSON Schema keyword captures, so it's checked here instead.
    if (item.x + item.w > gridWidth) {
      issues.push({
        kind: "out-of-bounds",
        message: `layout item '${item.chart}' (x=${item.x}, w=${item.w}) extends past the ${gridWidth}-column grid`,
      });
    }
  }
  for (let i = 0; i < items.length; i++) {
    for (let j = i + 1; j < items.length; j++) {
      const a = items[i];
      const b = items[j];
      if (a === undefined || b === undefined) continue; // unreachable given the loop bounds
      if (rectsOverlap(a, b)) {
        issues.push({
          kind: "overlap",
          message: `layout items '${a.chart}' and '${b.chart}' overlap`,
        });
      }
    }
  }
  return issues;
}

function rectsOverlap(a: LayoutItem, b: LayoutItem): boolean {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
}
