import type { Dashboard } from "@hyakkei/schema";
import { serializeDashboard } from "./serialize.js";

const PAYLOAD_ID = "hyakkei-export-payload";

function escapeJsonForHtml(value: Dashboard): string {
  return JSON.stringify(value)
    .replaceAll("<", "\\u003c")
    .replaceAll(">", "\\u003e")
    .replaceAll("&", "\\u0026");
}

/** Builds a browser-complete, zero-network HTML viewer. */
export function buildSingleFileDashboardHtml(dashboard: Dashboard): string {
  const payload = escapeJsonForHtml(dashboard);
  return `<!doctype html>
<html lang="ja"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Hyakkei</title>
<style>body{font-family:system-ui,sans-serif;margin:2rem;color:#172033}main{max-width:72rem;margin:auto}.notice{padding:.75rem;background:#eef4ff;border-radius:.5rem}table{border-collapse:collapse;width:100%}th,td{border:1px solid #d6dbe5;padding:.5rem;text-align:left}</style></head>
<body><main id="app"><p class="notice">ダッシュボードを読み込んでいます。</p></main>
<script type="application/json" id="${PAYLOAD_ID}">${payload}</script>
<script>(function(){"use strict";const data=JSON.parse(document.getElementById("${PAYLOAD_ID}").textContent||"{}");const app=document.getElementById("app");app.textContent="";const h=document.createElement("h1");h.textContent=data.meta&&data.meta.title||"ダッシュボード";app.append(h);(data.charts||[]).forEach(function(chart){const section=document.createElement("section");const title=document.createElement("h2");title.textContent=chart.options&&chart.options.title||chart.type||"グラフ";section.append(title);const note=document.createElement("p");note.textContent="この配布用ビューでは、保存されたグラフ設定を表示しています。";section.append(note);app.append(section);});if(!(data.charts||[]).length){const p=document.createElement("p");p.textContent="グラフはありません。";app.append(p);}}());</script></body></html>`;
}

export function buildExportFolder(dashboard: Dashboard): Record<string, string> {
  return {
    "index.html": buildSingleFileDashboardHtml(dashboard),
    "dashboard.json": serializeDashboard(dashboard),
  };
}

export function downloadSingleFileDashboard(dashboard: Dashboard, filename: string): void {
  const blob = new Blob([buildSingleFileDashboardHtml(dashboard)], { type: "text/html" });
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
