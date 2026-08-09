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
  const singleFileRef = useRef<HTMLButtonElement>(null);
  useEffect(() => singleFileRef.current?.focus(), []);
  const mib = (bytes / (1024 * 1024)).toFixed(1);
  return (
    <div
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
          <button ref={singleFileRef} type="button" onClick={onSingleFile}>
            単一HTMLで書き出す
          </button>
          <button type="button" onClick={onFolderZip}>
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
