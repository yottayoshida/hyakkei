/**
 * The fail-closed gate against T1 (issue #15/F7 Security review, DREAD
 * 8.6): `WorkspaceSource.sample` and its siblings carry REAL row data (a
 * Japanese-municipality context, so plausibly PII) that must never reach a
 * saved `dashboard.json` -- ADR-0002/PRD F7's whole claim is "this file
 * never embeds pre-computed data." `toDashboard` (`to-dashboard.ts`) is
 * built entirely from named field assignment specifically so this class of
 * leak requires an active mistake, not an omission -- this function is the
 * second, independent check that catches that mistake before a `Blob` is
 * ever created.
 *
 * Applies to `toDashboard`'s PROJECTION OUTPUT ONLY (orchestrator
 * adjudication 1, `/plan` Phase 6): once PR-2b's merge-base mechanism
 * exists, a document re-saved after being opened may legitimately carry a
 * preserved unknown field the ORIGINAL author's file already had on disk
 * (e.g. one literally named "rows") -- that residue was never editor
 * runtime state, so re-emitting it creates no new leak, and ADR-0002
 * requires preserving it. Never call this on a document AFTER that merge.
 *
 * Key names only, deliberately never values (shape enumeration A12): a
 * column name is free-form data (`common.ts`'s `NonEmptyString`), so a
 * legitimately-named column "rows" or "sample" reaching `Chart.encoding.x`
 * etc. as a VALUE must not trip this. What must trip it is one of these
 * names appearing as an object KEY anywhere in the tree.
 */
const RUNTIME_ONLY_KEYS = new Set([
  // WorkspaceSource (App.tsx)
  "sourceLabel",
  "sample",
  "validation",
  "previewRows",
  "previewPending",
  // IntakeSample (intake/types.ts)
  "table",
  "rows",
  // PreviewRow (intake/types.ts)
  "values",
  "castFailed",
  // ColumnValidationState (intake/types.ts) -- `samples` carries real
  // {original, parsed} cell values; `validation` above is a `Map` and
  // vanishes under `JSON.stringify` (shape enumeration A13), so this leaf
  // is the one that actually needs catching once a `Map` slips through.
  "samples",
  "nonNullCount",
  "uncastableCount",
  "advisory",
  // WorkspaceQuery (intake/types.ts)
  "sourceTableId",
  "previewColumns",
  "diagnostics",
]);

export class RuntimeKeyLeakError extends Error {
  constructor(
    public readonly path: string,
    public readonly key: string,
  ) {
    super(
      `assertNoRuntimeKeys: runtime-only key "${key}" found at ${path} -- refusing to save (editor state would leak into dashboard.json)`,
    );
    this.name = "RuntimeKeyLeakError";
  }
}

/**
 * Whether `value` is one of the runtime types/shapes `JSON.stringify`
 * silently mangles rather than rejects (shape enumeration A13, Codex Round
 * 1 P1): `Map`/`Set` become `{}`, a non-finite `number` (`NaN`/`Infinity`)
 * becomes `null`, a `function`/`bigint`/`symbol` is either dropped or
 * throws depending on position. A plain object/array/finite-number/string/
 * boolean/null survives serialization byte-for-byte; anything else does
 * not. This check catches the whole runtime-type class without enumerating
 * class names, so a `WeakMap`/custom class future code introduces is
 * caught the same way `Map`/`Set` are today.
 */
function isPlainSerializable(value: unknown): boolean {
  if (value === null) return true;
  const t = typeof value;
  if (t === "string" || t === "boolean") return true;
  if (t === "number") return Number.isFinite(value);
  if (t !== "object") return false; // function, bigint, symbol
  if (Array.isArray(value)) return true;
  const proto: unknown = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

function describeRejected(value: unknown): string {
  if (typeof value === "number") return `<non-finite number: ${value}>`;
  return `<${Object.prototype.toString.call(value)}>`;
}

/**
 * Walks `value` depth-first. Called at the TOP with a `Dashboard`, which is
 * never itself `undefined` -- the `undefined` allowance below exists only
 * for an OWN-PROPERTY value found one or more levels down (shape
 * enumeration R6: `Chart.encoding.size` after a scatter type-switch,
 * `Chart.options.title` after clearing a title both legitimately survive
 * as `undefined`-valued own properties in the projection, and
 * `JSON.stringify` drops them regardless).
 *
 * An `undefined` ARRAY ELEMENT is different and is NOT allowed (Codex
 * Round 1 P1): `JSON.stringify` turns it into `null`, not into nothing --
 * silently changing what a saved document says, not just omitting a key.
 * `toDashboard`'s own array-producing code (`.map()` over `sources`/
 * `queries`) cannot produce one, and `charts`/`layout` are passed through
 * by reference (not rebuilt) -- this exists as a structural backstop
 * against a future array-producing change that could.
 *
 * Every value, not just objects (Codex Round 1 P1): the previous version
 * returned early for any non-object `value`, so `isPlainSerializable`
 * never actually ran on a `function`/`bigint`/`symbol`/non-finite `number`
 * reached as a nested value -- the type check existed but nothing could
 * reach it.
 */
export function assertNoRuntimeKeys(value: unknown, path = "$"): void {
  if (value === undefined) return;
  if (!isPlainSerializable(value)) {
    throw new RuntimeKeyLeakError(path, describeRejected(value));
  }
  if (Array.isArray(value)) {
    value.forEach((item, i) => {
      const itemPath = `${path}[${i}]`;
      if (item === undefined) {
        throw new RuntimeKeyLeakError(itemPath, "<undefined array element>");
      }
      assertNoRuntimeKeys(item, itemPath);
    });
    return;
  }
  if (value !== null && typeof value === "object") {
    for (const key of Object.keys(value)) {
      if (RUNTIME_ONLY_KEYS.has(key)) throw new RuntimeKeyLeakError(path, key);
      assertNoRuntimeKeys((value as Record<string, unknown>)[key], `${path}.${key}`);
    }
  }
}
