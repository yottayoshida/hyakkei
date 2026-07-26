import {
  formatParseFailure,
  parseDashboard,
  validateDashboardReferences,
  type Dashboard,
  type ReferenceIssue,
} from "@hyakkei/schema";

export type VerifyBeforeSaveFailure =
  { kind: "schema"; message: string } | { kind: "references"; issues: ReferenceIssue[] };

/**
 * V-020 (shape enumeration A8): the last net before a `Blob` is created --
 * `toDashboard` deliberately does not validate (its own doc comment), and
 * `assertNoRuntimeKeys` only catches editor-runtime-state LEAKS, not a
 * structurally-wrong document (a dangling reference, an out-of-bounds
 * layout item). `parseDashboard` is the schema check; `
 * validateDashboardReferences` catches the class of issue schema itself
 * structurally cannot express (cross-array id references, `x+w` bounds --
 * `validate.ts`'s own doc comment).
 *
 * Only `dangling` / `out-of-bounds` / `missing-column` are treated as
 * fatal here (shape enumeration A8's hard/advisory split, decided but
 * previously unwired): `reserved-word` and `duplicate` are surfaced as
 * advisory elsewhere in the editor, not blocked here, because the editor
 * has no code path that can PRODUCE either from ordinary use (a duplicate
 * `Source.id`/reserved-word id would mean `generateSourceId`'s own
 * collision-avoidance already failed, a separate bug this check cannot
 * fix by refusing to save).
 */
const FATAL_ISSUE_KINDS = new Set<ReferenceIssue["kind"]>([
  "dangling",
  "out-of-bounds",
  "missing-column",
]);

export function verifyBeforeSave(document: Dashboard): VerifyBeforeSaveFailure | null {
  const parsed = parseDashboard(document);
  if (!parsed.ok) return { kind: "schema", message: formatParseFailure(parsed) };
  const issues = validateDashboardReferences(document).filter((issue) =>
    FATAL_ISSUE_KINDS.has(issue.kind),
  );
  if (issues.length > 0) return { kind: "references", issues };
  return null;
}
