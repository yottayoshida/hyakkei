import { buildExportFolder } from "@hyakkei/export";
import type { BakedDashboard } from "@hyakkei/schema";

const ARCHIVE_PATHS = ["index.html", "renderer.js", "dashboard.json"] as const;

function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.rel = "noopener";
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

/** Builds the only supported portable archive layout, loading JSZip on demand. */
export async function buildExportFolderZip(dashboard: BakedDashboard): Promise<Blob> {
  const files = buildExportFolder(dashboard);
  const { default: JSZip } = await import("jszip");
  const zip = new JSZip();
  for (const path of ARCHIVE_PATHS) {
    zip.file(path, files[path]!);
  }
  return zip.generateAsync({ type: "blob" });
}

export async function downloadExportFolder(
  dashboard: BakedDashboard,
  filename: string,
): Promise<void> {
  downloadBlob(await buildExportFolderZip(dashboard), filename);
}

export { ARCHIVE_PATHS };
