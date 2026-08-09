import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  buildExportFolder,
  buildSingleFileDashboardHtml,
  EXPORT_PACKAGE_VERSION,
} from "./index.js";

const DASHBOARD = {
  version: 1 as const,
  meta: {
    title: "安全な </script>",
    generatedAt: "2026-08-09T00:00:00.000Z",
    sourceDataAsOf: "2026-08-09",
    hyakkeiVersion: "0.1.0",
  },
  theme: {
    tokens: "@digital-go-jp/design-tokens@2.0.1" as const,
    palette: "guidebook-blue" as const,
  },
  charts: [
    {
      id: "chart_1",
      type: "bar" as const,
      encoding: { x: "label", y: "value" },
      options: { title: "件数" },
      rows: [{ label: "A", value: 2 }],
    },
  ],
  layout: { grid: "guidebook-12col" as const, items: [] },
};

describe("export package scaffold", () => {
  it("resolves the core package dependency across the workspace boundary", () => {
    expect(EXPORT_PACKAGE_VERSION).toBe(1);
  });
});

/**
 * issue #14 (grid layout editor): the plan's original security mitigation
 * for "editor UI leaking into the exported static viewer" was to extend
 * `packages/app/src/bundle-isolation.test.ts` -- wrong target (independent
 * review, Major finding): that test compares two of `packages/app`'s OWN
 * Vite build outputs against each other (`index.html` vs `golden.html`),
 * not the actual shipped export artifact this package produces. This
 * asserts the real invariant instead: `@hyakkei/export` never depends on
 * `@hyakkei/app` at all, so the (B) edit overlay (`AuthoringDashboardPreview.
 * tsx`, app-only) has no path into an exported dashboard by construction --
 * not by a bundle-content scan, but by the dependency graph itself.
 */
describe("packages/export never depends on packages/app", () => {
  it("package.json declares no dependency (direct or dev) on @hyakkei/app", () => {
    const pkgPath = fileURLToPath(new URL("../package.json", import.meta.url));
    const pkg = JSON.parse(readFileSync(pkgPath, "utf-8")) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
      peerDependencies?: Record<string, string>;
    };
    const allDeps = {
      ...pkg.dependencies,
      ...pkg.devDependencies,
      ...pkg.peerDependencies,
    };
    expect(Object.keys(allDeps)).not.toContain("@hyakkei/app");
  });
});

describe("single-file packaging", () => {
  it("escapes embedded HTML terminators and emits a baked static viewer", () => {
    const html = buildSingleFileDashboardHtml(DASHBOARD);
    const payload = html.match(
      /<script type="application\/json" id="hyakkei-export-payload">([\s\S]*?)<\/script>/,
    )?.[1];
    expect(payload).toBeDefined();
    const baked = JSON.parse(payload!) as Record<string, unknown>;
    expect(html).not.toContain('</script>";alert');
    expect(html).toContain("hyakkei-tile");
    expect(html).toContain("hyakkei-chart-canvas");
    expect(baked).not.toHaveProperty("sources");
    expect(baked).not.toHaveProperty("queries");
    expect(JSON.stringify(baked)).not.toContain("SELECT");
    const folder = buildExportFolder(DASHBOARD);
    expect(Object.keys(folder)).toEqual(["index.html", "renderer.js", "dashboard.json"]);
    expect(folder["index.html"]).not.toContain("hyakkei-export-payload");
    expect(folder["renderer.js"]).toContain("dashboard.json");
  });
});
