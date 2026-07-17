import type { NetworkBlockedReason } from "@hyakkei/core/datasource";
import { useState, type FormEvent } from "react";
import { loadDataLayer } from "../data-layer.js";

export type UrlPanelProps = {
  disabled: boolean;
  onUrlAccepted: (url: string) => void;
  onUrlBlocked: (url: string, reason: NetworkBlockedReason | undefined, message: string) => void;
  /** `loadDataLayer()` itself rejected (e.g. a chunk fetch failed) — distinct from `onUrlBlocked`, which only fires once the layer loaded and classification ran. `generation` is `beginAttempt()`'s return value, threaded back unchanged — see `IntakeApp.beginUrlAttempt`'s doc comment for why this exists (Codex R2). */
  onLoadFailed: (url: string, err: unknown, generation: number) => void;
  /** Call synchronously at the very start of a submit, before the async preflight. See `IntakeApp.beginUrlAttempt`. */
  beginAttempt: () => number;
};

/**
 * D10: "URL欄+接続ボタン（open時自動fetch禁止）" — no fetch on paste/change,
 * only on explicit submit — plus a UI preflight (D10, egress-policy.ts's
 * own `classifyUrlTarget` doc comment) that runs BEFORE any network call:
 * a disallowed URL never reaches `EgressPolicy.fetchBytes()` at all, which
 * is what makes "zero network requests to a third-party origin" (V-085) a
 * structural property of this panel, not just an outcome of the fetch
 * itself failing closed. Reusing `classifyUrlTarget` (rather than
 * re-deriving scheme/origin/credential rules here) is the mirror-seam
 * discipline this project applies elsewhere (V-094): one decision, one
 * implementation, two call sites.
 *
 * `classifyUrlTarget` itself now lives behind `loadDataLayer()`'s dynamic
 * import (issue #54: this panel must not statically pull the data layer
 * into intake's entry chunk) — `handleSubmit` stays `async`, but critically
 * still calls `onUrlBlocked` (never `onUrlAccepted`/`IntakeApp.startUrl`)
 * BEFORE this component ever lets a blocked URL reach the network. This is
 * load-bearing for e2e/intake-harness.spec.ts's "読み込み中 never appears
 * for a blocked URL" assertion — moving classification into `IntakeApp`'s
 * own `startUrl` instead (which dispatches `SUBMIT`/"reading" first) would
 * break it, since a blocked URL would then flash through "reading" before
 * landing on "blocked". Idle-time warming (`scheduleIdleWarm`,
 * `IntakeApp`) typically makes this `await` resolve instantly by the time
 * a user finishes typing a URL and submits.
 *
 * `submitting` (Codex R1 P1): the async `loadDataLayer()` await opened a
 * window, absent when this handler was synchronous, where a double-click
 * could fire two concurrent `handleSubmit` calls for the same URL — the
 * second one's `source.inspect()`/`register()` side effect in
 * `IntakeApp.startUrl` is not abortable (same non-abortable-work caveat
 * `runRegistration`'s own doc comment already documents for a different
 * mechanism). Disabling the button/input for the duration of this handler
 * closes that window the same way `ReadingPanel`'s later "reading" phase
 * already disables re-submission once `IntakeApp` takes over.
 */
export function UrlPanel({
  disabled,
  onUrlAccepted,
  onUrlBlocked,
  onLoadFailed,
  beginAttempt,
}: UrlPanelProps) {
  const [value, setValue] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const url = value.trim();
    if (!url || submitting) return;

    // Captured before the async preflight -- see `IntakeApp.beginUrlAttempt`
    // for why this can't just be a phase check instead (Codex R2).
    const generation = beginAttempt();
    setSubmitting(true);
    try {
      const { datasource } = await loadDataLayer();
      setSubmitting(false);
      const classification = datasource.classifyUrlTarget(url, window.location.origin);
      if (classification.kind === "blocked") {
        onUrlBlocked(url, classification.reason, classification.message);
        return;
      }
      onUrlAccepted(url);
    } catch (err) {
      // Codex R1 P1: previously silent -- `loadDataLayer()` rejecting here
      // (unlike every other call site, which already funnels this through
      // `toIntakeError`) left the user staring at an unresponsive button
      // with no feedback at all. `onLoadFailed` routes this through
      // `IntakeApp`'s normal error UX instead.
      setSubmitting(false);
      onLoadFailed(url, err, generation);
    }
  }

  return (
    <form onSubmit={handleSubmit} style={{ display: "flex", gap: 8, marginTop: 16 }}>
      <input
        type="url"
        placeholder="https://... のURLを入力"
        value={value}
        disabled={disabled || submitting}
        onChange={(event) => setValue(event.target.value)}
        aria-label="データのURL"
        style={{ flex: 1, padding: 8 }}
      />
      <button
        type="submit"
        disabled={disabled || submitting || value.trim() === ""}
        style={{ minHeight: 44, padding: "0 16px" }}
      >
        {/* UX review Minor-1: on a cold/slow connection, `loadDataLayer()`'s
            preflight await can take past the point a static "接続" label on
            a disabled button reads as frozen, not busy (ReadingPanel.tsx's
            own doc comment makes the same Doherty-threshold argument for
            the same reason). Idle warming (this component's own doc
            comment) makes this label typically invisible in practice. */}
        {submitting ? "接続中…" : "接続"}
      </button>
    </form>
  );
}
