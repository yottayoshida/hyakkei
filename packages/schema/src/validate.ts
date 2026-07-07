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
  kind: "dangling" | "duplicate" | "overlap" | "out-of-bounds";
  message: string;
};

/** Records each item's id into `ids`, pushing a "duplicate" issue for repeats. */
function collectIds<T>(
  items: T[],
  getId: (item: T) => string,
  label: string,
  issues: ReferenceIssue[],
): Set<string> {
  const ids = new Set<string>();
  for (const item of items) {
    const id = getId(item);
    if (ids.has(id)) issues.push({ kind: "duplicate", message: `duplicate ${label} id '${id}'` });
    ids.add(id);
  }
  return ids;
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
  const sourceIds = collectIds(doc.sources, (s) => s.id, "source", issues);

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
  chartIds: Set<string>,
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
