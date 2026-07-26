import type { BaseMeta } from "@hyakkei/schema";
import type { WorkspaceQuery } from "../intake/types.js";

export type SaveBlockReason = "empty-title" | "query-not-ready";

/**
 * Whether the editor's current state can be projected into a schema-valid
 * `dashboard.json` (issue #15/F7). Two conditions, both `NonEmptyString` in
 * the schema (`BaseMeta.title`, `Query.sql`) that `toDashboard` itself
 * deliberately does not enforce (its own doc comment: validation belongs to
 * the schema, not a second divergent rule set here) -- this is the
 * user-facing precondition check the save button's disabled state and copy
 * are driven from.
 *
 * `query.sql === ""` (V-016, corrected rationale -- shape enumeration
 * found the original "excluding it would dangle a chart" claim does not
 * hold: `handleAddChart` refuses to create a chart from a query whose
 * `previewColumns` never resolved, so a `sql === ""` query can never back
 * one). The real reason is narrower and still real: a query the user can
 * see on screen -- freshly added, or one whose last resolve attempt failed
 * (App.tsx's `refreshQueryPreview` catch path, shape enumeration A3) --
 * would otherwise vanish from the saved file with no indication why.
 *
 * `query.previewPending` (Codex Round 1, P0): `handleQueryBuilderChange`
 * (App.tsx) commits a NEW `builderState` synchronously, then calls
 * `refreshQueryPreview` to recompile `sql` to match it -- but that
 * recompile is async. Between those two moments, `previewPending` is
 * `true` and `sql` is still the PREVIOUS compile, mismatched against the
 * `builderState` now in state. `handleOverrideChange`'s cross-query sweep
 * (App.tsx) has the identical window for every query on the overridden
 * source. Without this check, a save during that window would write a
 * `dashboard.json` whose `Query.sql` doesn't match its own
 * `Query.builderState` -- silently violating the exact invariant
 * `dashboard.ts`'s own doc comment claims always holds ("the editor
 * recompiles both together on every builderState edit so they never
 * drift"). Once `refreshQueryPreview` settles, either `sql` matches the
 * current `builderState` (success) or `sql` is cleared to `""` (failure,
 * folding into the check above) -- `previewPending` is never left `true`
 * forever.
 */
export function canSave(input: {
  meta: BaseMeta;
  queries: WorkspaceQuery[];
}): SaveBlockReason | null {
  if (input.meta.title.trim() === "") return "empty-title";
  if (input.queries.some((q) => q.sql === "" || q.previewPending)) return "query-not-ready";
  return null;
}
