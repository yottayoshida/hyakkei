import type { Dashboard } from "@hyakkei/schema";

/**
 * `toDashboard`'s output -> the exact bytes written to the downloaded file
 * (issue #15/F7). Separated from `downloadDashboard` (a DOM-touching
 * function `URL.createObjectURL` doesn't exist for under jsdom, empirically
 * confirmed QA-side) so this pure string transform stays unit-testable
 * without a browser. 2-space indent + trailing newline: ADR-0002's
 * Git-diffability claim (P3 developers review `dashboard.json` in Git) and
 * this workspace's own formatting convention both want it.
 */
export function serializeDashboard(document: Dashboard): string {
  return `${JSON.stringify(document, null, 2)}\n`;
}
