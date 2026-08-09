import { useEffect, useRef } from "react";

export type ExportSizeDialogProps = {
  bytes: number;
  onSingleFile: () => void;
  onFolderZip: () => void;
  onCancel: () => void;
};

export function ExportSizeDialog({
  bytes,
  onSingleFile,
  onFolderZip,
  onCancel,
}: ExportSizeDialogProps) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const folderZipRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    folderZipRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onCancel();
        return;
      }
      if (event.key !== "Tab") return;
      const focusable = dialogRef.current?.querySelectorAll<HTMLElement>(
        'button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
      );
      if (!focusable || focusable.length === 0) return;
      const first = focusable[0]!;
      const last = focusable[focusable.length - 1]!;
      if (!dialogRef.current?.contains(document.activeElement)) {
        event.preventDefault();
        first.focus();
      } else if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [onCancel]);
  const mib = (bytes / (1024 * 1024)).toFixed(1);
  return (
    <div
      ref={dialogRef}
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="export-size-dialog-title"
      aria-describedby="export-size-dialog-description"
      style={{ position: "fixed", inset: 0, display: "grid", placeItems: "center", padding: 16 }}
    >
      <div style={{ maxWidth: 520, padding: 20, background: "#fff", border: "1px solid #6b7280" }}>
        <h2 id="export-size-dialog-title">配布用HTMLのサイズが大きくなっています</h2>
        <p id="export-size-dialog-description">
          このダッシュボードは約{mib} MiBです。20 MiBを超えるため、配布方法を選んでください。
        </p>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <button type="button" onClick={onSingleFile}>
            単一HTMLで書き出す
          </button>
          <button ref={folderZipRef} type="button" onClick={onFolderZip}>
            フォルダーZIPで書き出す
          </button>
          <button type="button" onClick={onCancel}>
            キャンセル
          </button>
        </div>
      </div>
    </div>
  );
}
