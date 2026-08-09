import type { BakedDashboard } from "@hyakkei/schema";
import { RENDERER_CODE, RENDERER_HASH } from "./generated/renderer-code.js";

export const PAYLOAD_ID = "hyakkei-export-payload";

function escapeJsonForHtml(value: BakedDashboard): string {
  return JSON.stringify(value)
    .replaceAll("<", "\\u003c")
    .replaceAll(">", "\\u003e")
    .replaceAll("&", "\\u0026");
}

/** The built IIFE uses the same normalizeBaked()+mount() renderer as the editor. */
export const EXPORT_RENDERER_JS = RENDERER_CODE;

function style(): string {
  return "body{font-family:system-ui,sans-serif;margin:2rem;color:#172033;background:#fff}main{max-width:72rem;margin:auto}.hyakkei-tile{min-width:0;min-height:0;overflow:auto;padding:1rem;border:1px solid #d6dbe5;border-radius:.5rem;background:#fff}.hyakkei-chart-canvas{min-height:12rem}.hyakkei-accessible-fallback{margin-top:.5rem}.hyakkei-accessible-data-table{border-collapse:collapse;width:100%;font-size:.9rem}.hyakkei-accessible-data-table th,.hyakkei-accessible-data-table td{border:1px solid #d6dbe5;padding:.4rem;text-align:left}";
}

function escapeText(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

function documentHtml(dashboard: BakedDashboard, externalRenderer: boolean): string {
  const payload = escapeJsonForHtml(dashboard);
  const script = externalRenderer
    ? '<script src="./renderer.js"></script>'
    : `<script>${EXPORT_RENDERER_JS}</script>`;
  // Keep the payload in both variants. The folder archive also carries the
  // pretty `dashboard.json` for inspection, but its index must remain
  // launchable from `file://` where fetch("./dashboard.json") is blocked by
  // the browser's origin policy.
  const payloadScript = `<script type="application/json" id="${PAYLOAD_ID}">${payload}</script>`;
  const title = escapeText(String(dashboard.meta.title));
  const policy = `default-src 'none'; style-src 'unsafe-inline'; script-src 'self' '${RENDERER_HASH}'; connect-src 'self'; img-src data:; object-src 'none'`;
  return `<!doctype html><html lang="ja"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="${policy}"><title>${title}</title><style>${style()}</style></head><body><main id="app"><h1>${title}</h1><div id="dashboard"></div></main>${payloadScript}${script}</body></html>`;
}

export function buildSingleFileDashboardHtml(dashboard: BakedDashboard): string {
  return documentHtml(dashboard, false);
}

export function buildExportFolder(dashboard: BakedDashboard): Record<string, string> {
  return {
    "index.html": documentHtml(dashboard, true),
    "renderer.js": `${EXPORT_RENDERER_JS}\n`,
    "dashboard.json": `${JSON.stringify(dashboard, null, 2)}\n`,
  };
}
