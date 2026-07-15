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
      {/* "はじめからやり直す", not "もう一度試す" (UX review m3, Jakob's
          Law): `onRetry` resets to the empty intake screen, not a retry of
          the SAME file/URL — the previous label implied the latter and
          did not match what actually happens. */}
      <button type="button" onClick={onRetry} style={{ marginTop: 12, minHeight: 44 }}>
        はじめからやり直す
      </button>
    </div>
  );
}
