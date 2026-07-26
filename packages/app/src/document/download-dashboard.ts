import type { Dashboard } from "@hyakkei/schema";
import { serializeDashboard } from "./serialize.js";

/**
 * `Blob` + `<a download>` + `URL.createObjectURL` (issue #15/F7, PoC-verified
 * under `EDITOR_CSP` across chromium/firefox/webkit -- `e2e/
 * save-download.spec.ts` -- zero CSP violations, `EDITOR_CSP` unchanged).
 * `showSaveFilePicker` was rejected (Chromium-only; Firefox has no plans to
 * implement it, Safari only offers OPFS, not a local-disk picker).
 *
 * `revokeObjectURL` is deferred via `setTimeout(...,0)`, not called
 * immediately after `click()`: an immediate revoke can race the browser's
 * own download-initiation step in some engines (Firefox specifically) and
 * fail the download. Must be a real user-gesture-triggered call (`click()`
 * runs synchronously inside it) -- never call this from an effect or a
 * timer; PR-1 does not implement autosave (ADR-0002 already rejects opaque
 * app-state persistence as an alternative design).
 */
export function downloadDashboard(dashboard: Dashboard, filename: string): void {
  const blob = new Blob([serializeDashboard(dashboard)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.rel = "noopener";
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}
