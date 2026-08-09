import type { BakedDashboard } from "@hyakkei/schema";
import { buildSingleFileDashboardHtml } from "./html-builder.js";

/** 20 MiB is the largest supported self-contained HTML export. */
export const SINGLE_FILE_EXPORT_MAX_BYTES = 20 * 1024 * 1024;

export type DashboardExportPlan = {
  html: string;
  bytes: number;
  exceedsSingleFileLimit: boolean;
};

/**
 * Builds once, then measures the actual UTF-8 payload. Character counts are
 * not byte counts for Japanese titles and data, so they must never gate the
 * export mode.
 */
export function planDashboardExport(
  dashboard: BakedDashboard,
  maxBytes = SINGLE_FILE_EXPORT_MAX_BYTES,
): DashboardExportPlan {
  const html = buildSingleFileDashboardHtml(dashboard);
  const bytes = new TextEncoder().encode(html).byteLength;
  return { html, bytes, exceedsSingleFileLimit: bytes > maxBytes };
}
