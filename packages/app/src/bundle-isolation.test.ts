// /code-review (xhigh) finding: vite.config.ts's dual-entry split
// (index.html vs golden.html) and GoldenHarness.tsx's own comment both
// claim viewer-bundle isolation is now "a build-graph fact," but the only
// existing isolation test (packages/core/src/renderer/bundle-isolation.
// test.ts) esbuild-bundles `@hyakkei/core/renderer` in ISOLATION -- it never
// touches packages/app's actual Vite/Rollup build output, so nothing
// verified the claim at the level it was made about. This test reads the
// real `dist/` this package's own `build` script produces and checks it
// directly, the same "verify empirically, don't trust it by construction"
// principle core's own test file cites.
//
// Requires `packages/app/dist` to already exist (root `pnpm run test` runs
// `pnpm run build` first, per root package.json).
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const DIST_DIR = join(import.meta.dirname, "..", "dist");
// Identifier names like `GOLDEN_SAMPLES`/`goldenDashboardFromQuery` do NOT
// survive production minification (confirmed empirically: injecting a real
// `bake(GOLDEN_SAMPLES[0]...)` call into App.tsx changed the bundle's
// content hash and size, but left zero trace of those identifier strings --
// only unique golden-fixture STRING LITERALS, which minifiers never rename,
// reliably survive). "q-category" (a query id) and "建築確認"
// (a category label) exist only in packages/core/src/golden-fixtures/
// sample-dashboards.ts, never in this package's own SAMPLE_DASHBOARD.
const FORBIDDEN_MARKERS = ["duckdb", "exceljs", "AsyncDuckDB", "q-category", "建築確認"];

function scriptSrcsFromHtml(htmlPath: string): string[] {
  const html = readFileSync(htmlPath, "utf-8");
  return [...html.matchAll(/(?:src|href)="(\/assets\/[^"]+\.js)"/g)].map((m) => m[1]!);
}

function readAssets(srcs: string[]): string {
  return srcs
    .map((src) => readFileSync(join(DIST_DIR, src.replace(/^\//, "")), "utf-8"))
    .join("\n");
}

describe("packages/app real build output isolation (CI assert)", () => {
  it("index.html's own bundle (the real viewer) contains no golden-harness or duckdb/exceljs markers", () => {
    const srcs = scriptSrcsFromHtml(join(DIST_DIR, "index.html"));
    // Sentinel: a build that silently produced zero script references
    // would make every assertion below pass vacuously.
    expect(srcs.length, `index.html script/preload srcs: ${srcs.join(", ")}`).toBeGreaterThan(0);

    const bundleText = readAssets(srcs);
    const found = FORBIDDEN_MARKERS.filter((marker) => bundleText.includes(marker));
    expect(found, "forbidden markers found in index.html's bundle").toEqual([]);
  });

  it("golden.html has its own, separate entry chunk (the split is real, not collapsed back into one bundle)", () => {
    const indexSrcs = scriptSrcsFromHtml(join(DIST_DIR, "index.html"));
    const goldenSrcs = scriptSrcsFromHtml(join(DIST_DIR, "golden.html"));
    expect(
      goldenSrcs.length,
      `golden.html script/preload srcs: ${goldenSrcs.join(", ")}`,
    ).toBeGreaterThan(0);

    // golden.html's entry-specific chunk (not the shared renderer chunk
    // both pages load) must not be a src index.html also loads -- proving
    // the harness code isn't reachable from the real app's own entry point.
    const goldenOnlySrcs = goldenSrcs.filter((src) => !indexSrcs.includes(src));
    expect(goldenOnlySrcs.length, `golden.html srcs: ${goldenSrcs.join(", ")}`).toBeGreaterThan(0);

    const goldenOnlyText = readAssets(goldenOnlySrcs);
    expect(goldenOnlyText).toContain("golden");
  });
});
