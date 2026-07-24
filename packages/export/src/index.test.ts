import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { EXPORT_PACKAGE_VERSION } from "./index.js";

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
