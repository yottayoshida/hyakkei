import type { NetworkBlockedReason } from "@hyakkei/core/datasource";
import { describeError } from "./errorCopy.js";

export type BlockedPanelProps = {
  sourceLabel: string;
  reason: NetworkBlockedReason | undefined;
  onBack: () => void;
};

/**
 * D10: a disallowed URL is a normal branch, not a failure — "第三者URLは
 * fetch前のUIプリフライトで正常分岐としてescape hatch案内に落ちる（エラー
 * 経路に残さない）". Reuses `describeError("network-blocked", reason)` for
 * the copy text (one source of truth, same as `ErrorPanel` would show for
 * a post-fetch `network-blocked` `DataSourceError`) but renders it with
 * neutral/info chrome instead of `ErrorPanel`'s alarm styling — the
 * distinguishing fact here isn't the message, it's that this panel exists
 * only because `UrlPanel`'s preflight rejected the URL BEFORE any fetch
 * ran, not because one failed.
 */
export function BlockedPanel({ sourceLabel, reason, onBack }: BlockedPanelProps) {
  const copy = describeError("network-blocked", reason);
  return (
    <div
      role="status"
      style={{
        border: "1px solid #93c5fd",
        background: "#eff6ff",
        borderRadius: 8,
        padding: 16,
        marginTop: 16,
      }}
    >
      <p style={{ fontWeight: "bold", margin: 0 }}>{copy.title}</p>
      <p style={{ margin: "4px 0", color: "#6b7280", fontSize: 14 }}>{sourceLabel}</p>
      <p style={{ margin: "8px 0 0" }}>{copy.detail}</p>
      <button type="button" onClick={onBack} style={{ marginTop: 12, minHeight: 44 }}>
        戻る
      </button>
    </div>
  );
}
