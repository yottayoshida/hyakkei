import { describeError } from "./errorCopy.js";
import type { IntakeError } from "./types.js";

export type ErrorPanelProps = {
  sourceLabel: string;
  error: IntakeError;
  onRetry: () => void;
};

/**
 * `describeError`'s `tone` picks the chrome (`empty` renders info/blue,
 * every other kind renders error/red — D10: "「0件」と「失敗」の分離")
 * without this component needing its own copy of the kind→severity map.
 */
export function ErrorPanel({ sourceLabel, error, onRetry }: ErrorPanelProps) {
  const copy = describeError(error.kind, error.reason);
  const isInfo = copy.tone === "info";
  // issue #91: in-page retry cannot succeed for this kind (data-layer.ts's
  // module-map doc comment — a failed chunk fetch is cached as permanent
  // for the rest of the page) — offering "はじめからやり直す" here would be
  // actively misleading (implies retry might work). `location.reload()` is
  // called bare (no arguments, no data-derived URL) to foreclose an
  // open-redirect surface.
  //
  // No discard-confirmation gate (removed post-implementation-review,
  // see ADR-0010's correction note): a `data-layer-load` failure can only
  // ever occur while NO source is registered yet. `loadDataLayer()`
  // (data-layer.ts) memoizes permanently on success and is never
  // re-attempted after that — and the only way any source ever gets
  // registered is through a code path that already awaited it
  // successfully. So by the time a source could exist to lose, this
  // failure kind can no longer occur; a confirm gate here would guard a
  // combination that is architecturally unreachable, not a real risk.
  // `copy.family`, not `error.kind` (/simplify: 3 independent review angles
  // converged on this): `errorCopy.ts` introduced the `"infrastructure"`
  // family specifically so "reload vs. retry" is a family-level decision,
  // its own doc comment says so twice -- checking the literal `kind` here
  // instead bypasses that abstraction. Today the two checks agree (exactly
  // one kind is in this family), but a future infrastructure-family kind
  // would silently get the misleading "はじめからやり直す" retry button
  // unless this line were remembered and updated by hand alongside
  // `describeError`'s switch.
  const isDataLayerFailure = copy.family === "infrastructure";

  return (
    <div
      role={isInfo ? "status" : "alert"}
      style={{
        border: `1px solid ${isInfo ? "#93c5fd" : "#fca5a5"}`,
        background: isInfo ? "#eff6ff" : "#fef2f2",
        borderRadius: 8,
        padding: 16,
        marginTop: 16,
      }}
    >
      <p style={{ fontWeight: "bold", margin: 0 }}>{copy.title}</p>
      {sourceLabel && (
        <p style={{ margin: "4px 0", color: "#6b7280", fontSize: 14 }}>{sourceLabel}</p>
      )}
      <p style={{ margin: "8px 0 0" }}>{copy.detail}</p>
      {isDataLayerFailure ? (
        <button
          type="button"
          onClick={() => window.location.reload()}
          style={{ marginTop: 12, minHeight: 44 }}
        >
          ページを再読み込み
        </button>
      ) : (
        // "はじめからやり直す", not "もう一度試す" (UX review m3, Jakob's
        // Law): `onRetry` resets to the empty intake screen, not a retry of
        // the SAME file/URL — the previous label implied the latter and
        // did not match what actually happens.
        <button type="button" onClick={onRetry} style={{ marginTop: 12, minHeight: 44 }}>
          はじめからやり直す
        </button>
      )}
    </div>
  );
}
