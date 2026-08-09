export {
  buildExportFolder,
  buildSingleFileDashboardHtml,
  EXPORT_RENDERER_JS,
} from "./html-builder.js";
export {
  SINGLE_FILE_EXPORT_MAX_BYTES,
  planDashboardExport,
  type DashboardExportPlan,
} from "./package-plan.js";

export const EXPORT_PACKAGE_VERSION = 1 as const;
