import { describe, expect, it } from "vitest";
import type { BakedDashboard } from "@hyakkei/schema";
import {
  buildExportFolder,
  buildSingleFileDashboardHtml,
  EXPORT_RENDERER_JS,
} from "./export-dashboard.js";

const DASHBOARD: BakedDashboard = {
  version: 1,
  meta: {
    title: "危険な </script><script>alert(1)</script>",
    generatedAt: "2026-08-09T00:00:00.000Z",
    sourceDataAsOf: "2026-08-09",
    hyakkeiVersion: "0.1.0",
  },
  theme: { tokens: "@digital-go-jp/design-tokens@2.0.1", palette: "guidebook-blue" },
  charts: [
    {
      id: "chart_1",
      type: "stat",
      encoding: { value: "value" },
      options: {},
      rows: [{ value: 1 }],
    },
  ],
  layout: { grid: "guidebook-12col", items: [] },
};

describe("dashboard export", () => {
  it("produces a single HTML document with an escaped embedded payload", () => {
    const html = buildSingleFileDashboardHtml(DASHBOARD);
    expect(html).toContain("<!doctype html>");
    expect(html).toContain("hyakkei-export-payload");
    expect(html).not.toContain("</script><script>alert(1)");
    expect(html).not.toMatch(/(?:src|href)=['"]https?:/i);
    expect(html).toContain("hyakkei-chart-canvas");
  });

  it("provides deterministic folder descriptors without network dependencies", () => {
    const files = buildExportFolder(DASHBOARD);
    expect(Object.keys(files)).toEqual(["index.html", "renderer.js", "dashboard.json"]);
    // The folder keeps dashboard.json for inspection, but also embeds the
    // payload so index.html remains launchable directly from file:// where
    // fetch("./dashboard.json") is blocked by the browser origin policy.
    expect(files["index.html"]).toContain("hyakkei-export-payload");
    expect(files["renderer.js"]).toContain("dashboard.json");
    expect(JSON.parse(files["dashboard.json"]!).meta.title).toContain("</script>");
  });

  it("keeps a large descriptor export bounded", () => {
    const large = {
      ...DASHBOARD,
      charts: Array.from({ length: 1000 }, (_, index) => ({
        id: `c${index}`,
        type: "stat" as const,
        encoding: { value: "value" },
        options: {},
        rows: [],
      })),
    };
    const started = performance.now();
    const html = buildSingleFileDashboardHtml(large);
    expect(html.length).toBeLessThan(
      EXPORT_RENDERER_JS.length + JSON.stringify(large).length + 20_000,
    );
    expect(performance.now() - started).toBeLessThan(200);
  });
});
