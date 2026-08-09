import { describe, expect, it } from "vitest";
import type { Dashboard } from "@hyakkei/schema";
import { buildExportFolder, buildSingleFileDashboardHtml } from "./export-dashboard.js";

const DASHBOARD: Dashboard = {
  version: 1,
  meta: { title: "危険な </script><script>alert(1)</script>" },
  theme: { tokens: "@digital-go-jp/design-tokens@2.0.1", palette: "guidebook-blue" },
  sources: [],
  queries: [],
  charts: [],
  layout: { grid: "guidebook-12col", items: [] },
};

describe("dashboard export", () => {
  it("produces a single HTML document with an escaped embedded payload", () => {
    const html = buildSingleFileDashboardHtml(DASHBOARD);
    expect(html).toContain("<!doctype html>");
    expect(html).toContain("hyakkei-export-payload");
    expect(html).not.toContain("</script><script>alert(1)");
    expect(html).not.toMatch(/(?:src|href)=['"]https?:/i);
  });

  it("provides deterministic folder descriptors without network dependencies", () => {
    const files = buildExportFolder(DASHBOARD);
    expect(Object.keys(files)).toEqual(["index.html", "dashboard.json"]);
    expect(files["index.html"]).toContain("hyakkei-export-payload");
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
      })),
    };
    const started = performance.now();
    const html = buildSingleFileDashboardHtml(large);
    expect(html.length).toBeLessThan(1_000_000);
    expect(performance.now() - started).toBeLessThan(200);
  });
});
