import { classifyUrlTarget, type NetworkBlockedReason } from "@hyakkei/core/datasource";
import { useState, type FormEvent } from "react";

export type UrlPanelProps = {
  disabled: boolean;
  onUrlAccepted: (url: string) => void;
  onUrlBlocked: (url: string, reason: NetworkBlockedReason | undefined, message: string) => void;
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
 */
export function UrlPanel({ disabled, onUrlAccepted, onUrlBlocked }: UrlPanelProps) {
  const [value, setValue] = useState("");

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const url = value.trim();
    if (!url) return;

    const classification = classifyUrlTarget(url, window.location.origin);
    if (classification.kind === "blocked") {
      onUrlBlocked(url, classification.reason, classification.message);
      return;
    }
    onUrlAccepted(url);
  }

  return (
    <form onSubmit={handleSubmit} style={{ display: "flex", gap: 8, marginTop: 16 }}>
      <input
        type="url"
        placeholder="https://... のURLを入力"
        value={value}
        disabled={disabled}
        onChange={(event) => setValue(event.target.value)}
        aria-label="データのURL"
        style={{ flex: 1, padding: 8 }}
      />
      <button
        type="submit"
        disabled={disabled || value.trim() === ""}
        style={{ minHeight: 44, padding: "0 16px" }}
      >
        接続
      </button>
    </form>
  );
}
