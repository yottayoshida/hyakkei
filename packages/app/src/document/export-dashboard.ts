import {
  buildExportFolder,
  buildSingleFileDashboardHtml,
  EXPORT_RENDERER_JS,
} from "@hyakkei/export";
import type { BakedDashboard } from "@hyakkei/schema";

export { buildExportFolder, buildSingleFileDashboardHtml, EXPORT_RENDERER_JS };

export function downloadSingleFileHtml(html: string, filename: string): void {
  const blob = new Blob([html], { type: "text/html" });
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

export function downloadSingleFileDashboard(dashboard: BakedDashboard, filename: string): void {
  downloadSingleFileHtml(buildSingleFileDashboardHtml(dashboard), filename);
}
