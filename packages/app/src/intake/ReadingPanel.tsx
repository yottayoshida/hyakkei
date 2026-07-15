import { useEffect, useState } from "react";

export type ReadingPanelProps = {
  sourceLabel: string;
  onCancel: () => void;
};

const SPINNER_DELAY_MS = 400;
const SPINNER_FRAME_MS = 80;

/**
 * D10's "待ち時間3段": 0ms immediate filename/URL echo (`sourceLabel` is
 * already on screen the instant this component mounts, since `IntakeApp`
 * dispatches `SUBMIT` before starting any async work) -> spinner+cancel
 * appears only past `SPINNER_DELAY_MS` (flicker avoidance — a load that
 * finishes before the timer fires never shows a spinner, because this
 * component unmounts with the rest of the "reading" phase first).
 *
 * The plan's literal 2-phase (取得=決定的バイト進捗 / 解析=不定) progress
 * split is deliberately NOT implemented: neither `EgressPolicy.fetchBytes()`
 * nor `DataSource.register()` exposes a progress callback today (same API
 * gap as the missing `AbortSignal` — plan's own tracked follow-up), so a
 * UI-visible distinction between "fetching" and "parsing" here would be
 * fabricated, not observed.
 *
 * The spinner itself is a plain `setInterval` driving a `transform` value
 * through React's `style` prop (ordinary DOM property assignment), NOT a
 * CSS `@keyframes` rule (UX review: a load past ~400ms with only static
 * text reads as a frozen tab, exactly the moment this project's trust
 * story is most fragile). A `@keyframes` rule injected via a `<style>`
 * element would need `style-src 'unsafe-inline'`, which `EDITOR_CSP`
 * (csp.ts) does not grant — JS-driven `transform` updates are unaffected
 * since they're never parsed as a stylesheet.
 */
export function ReadingPanel({ sourceLabel, onCancel }: ReadingPanelProps) {
  const [showSpinner, setShowSpinner] = useState(false);
  const [angle, setAngle] = useState(0);

  useEffect(() => {
    const timer = setTimeout(() => setShowSpinner(true), SPINNER_DELAY_MS);
    return () => clearTimeout(timer);
  }, []);

  useEffect(() => {
    if (!showSpinner) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const timer = setInterval(() => setAngle((prev) => (prev + 30) % 360), SPINNER_FRAME_MS);
    return () => clearInterval(timer);
  }, [showSpinner]);

  return (
    <div role="status" style={{ marginTop: 16 }}>
      <p>
        {showSpinner && (
          <span
            aria-hidden="true"
            style={{
              display: "inline-block",
              width: 14,
              height: 14,
              marginRight: 8,
              verticalAlign: "middle",
              border: "2px solid #d1d5db",
              borderTopColor: "#1a56db",
              borderRadius: "50%",
              transform: `rotate(${angle}deg)`,
            }}
          />
        )}
        「{sourceLabel}」を読み込み中…
      </p>
      {showSpinner && (
        <button type="button" onClick={onCancel} style={{ minHeight: 44 }}>
          中止
        </button>
      )}
    </div>
  );
}
