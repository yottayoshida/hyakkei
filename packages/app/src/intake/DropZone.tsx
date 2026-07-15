import { useCallback, useRef, useState } from "react";

export type DropZoneProps = {
  disabled: boolean;
  onFileSelected: (file: File) => void;
};

/**
 * A single `role="button"` div is the entire accessible surface — the real
 * `<input type="file">` underneath is `aria-hidden` and never independently
 * focusable, so assistive tech sees one control, not a confusing pair. This
 * is also what makes the hidden input driveable from Playwright:
 * `page.setInputFiles()` works on a `display:none` input regardless of
 * visibility (unlike `page.click()`, which requires an actionable target),
 * so `e2e/intake-harness.spec.ts` targets it directly rather than
 * simulating real `dragenter`/`drop` `DataTransfer` events.
 */
export function DropZone({ disabled, onFileSelected }: DropZoneProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);

  const handleFiles = useCallback(
    (files: FileList | null) => {
      const file = files?.[0];
      if (file) onFileSelected(file);
    },
    [onFileSelected],
  );

  return (
    <div
      role="button"
      aria-label="ファイルを選択"
      tabIndex={disabled ? -1 : 0}
      aria-disabled={disabled}
      onClick={() => !disabled && inputRef.current?.click()}
      onKeyDown={(event) => {
        if (!disabled && (event.key === "Enter" || event.key === " ")) {
          event.preventDefault();
          inputRef.current?.click();
        }
      }}
      onDragOver={(event) => {
        event.preventDefault();
        if (!disabled) setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={(event) => {
        event.preventDefault();
        setDragging(false);
        if (!disabled) handleFiles(event.dataTransfer.files);
      }}
      style={{
        border: `2px dashed ${dragging ? "#1a56db" : "#9ca3af"}`,
        borderRadius: 8,
        padding: 32,
        textAlign: "center",
        cursor: disabled ? "default" : "pointer",
        opacity: disabled ? 0.5 : 1,
        background: dragging ? "#eff6ff" : "transparent",
      }}
    >
      <p style={{ margin: 0 }}>ファイルをドラッグ&ドロップ、またはクリックして選択</p>
      <p style={{ margin: "4px 0 0", fontSize: 12, color: "#6b7280" }}>
        CSV・Excel(.xlsx)・Parquet形式に対応
      </p>
      <input
        ref={inputRef}
        type="file"
        accept=".csv,.xlsx,.parquet"
        disabled={disabled}
        aria-hidden="true"
        tabIndex={-1}
        onChange={(event) => {
          handleFiles(event.target.files);
          // Reset so re-selecting the identical file still fires `onChange`.
          event.target.value = "";
        }}
        style={{ display: "none" }}
      />
    </div>
  );
}
