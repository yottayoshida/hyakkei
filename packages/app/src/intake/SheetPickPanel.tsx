import { useEffect, useRef } from "react";

export type SheetPickPanelProps = {
  sourceLabel: string;
  sheets: string[];
  onChoose: (sheet: string) => void;
  onCancel: () => void;
};

/**
 * Only reached for an xlsx workbook with more than one sheet — `IntakeApp`
 * skips straight to registering the single sheet otherwise (Hick's Law:
 * no point offering a 1-option choice). `sheets` may include hidden sheets
 * indistinguishable from visible ones (XL-B7, a known A2 follow-up:
 * `SourceShape` does not carry hidden-sheet state) — not fixed here, since
 * doing so would mean reopening A2's already-merged `SourceShape` contract
 * for a PR-B-only UI concern.
 *
 * `role="group"` + a moved-to-on-mount focus (UX review): every OTHER
 * pausing/terminal panel (`ReadingPanel`/`ErrorPanel`/`BlockedPanel`) is a
 * `role="status"`/`"alert"` live region a screen reader announces the
 * instant it mounts, but this is the one panel where user input is
 * actually REQUIRED to make any further progress — without an explicit
 * focus move, a keyboard/screen-reader user who just heard "reading" go
 * silent has no cue that a required choice is now on screen.
 */
export function SheetPickPanel({ sourceLabel, sheets, onChoose, onCancel }: SheetPickPanelProps) {
  const firstSheetButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    firstSheetButtonRef.current?.focus();
  }, []);

  return (
    <div role="group" aria-label="シートの選択" style={{ marginTop: 16 }}>
      <p>「{sourceLabel}」には複数のシートがあります。取り込むシートを選んでください。</p>
      <ul style={{ listStyle: "none", padding: 0 }}>
        {sheets.map((sheet, index) => (
          // Index, not `sheet` itself (/code-review): a maliciously
          // constructed workbook (this project's own established
          // adversarial-input posture, e.g. XL-B7's hidden-sheet gap
          // above) is not guaranteed to have unique sheet names -- ExcelJS
          // does not itself enforce it -- and a duplicate-name key would
          // let React misattribute DOM state between two visually distinct
          // buttons. `sheets` is a fixed snapshot for this panel's whole
          // lifetime (never reordered/filtered in place), so index-as-key
          // is safe here.
          <li key={index} style={{ marginBottom: 4 }}>
            <button
              ref={index === 0 ? firstSheetButtonRef : undefined}
              type="button"
              onClick={() => onChoose(sheet)}
              style={{ width: "100%", textAlign: "left", padding: 8, minHeight: 44 }}
            >
              {sheet}
            </button>
          </li>
        ))}
      </ul>
      <button type="button" onClick={onCancel} style={{ minHeight: 44 }}>
        中止
      </button>
    </div>
  );
}
