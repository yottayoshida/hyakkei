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
// "iconv" (PR-B, D7): `iconv-lite` is xlsx/csv's encoding-fallback
// dependency, reachable only through `@hyakkei/core`'s datasource surface —
// the same isolation boundary duckdb/exceljs already sit behind.
const FORBIDDEN_MARKERS = ["duckdb", "exceljs", "iconv", "AsyncDuckDB", "q-category", "建築確認"];

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

  // D7's reverse assertion: the isolation claim above only proves
  // duckdb/exceljs/iconv are ABSENT from index.html — it says nothing about
  // whether PR-A1.5's self-hosted-vendoring setup regressed and silently
  // dropped them from intake.html too (a build that isolates by accident,
  // e.g. a broken import, would also pass every assertion above). Checking
  // FOR the marker here is what turns "index.html doesn't have it" into
  // "the split is real," the same purpose golden.html's own positive
  // `toContain("golden")` check above serves.
  it("intake.html has its own, separate entry chunk that DOES contain duckdb/exceljs/iconv (vendoring regression detector)", () => {
    const indexSrcs = scriptSrcsFromHtml(join(DIST_DIR, "index.html"));
    const intakeSrcs = scriptSrcsFromHtml(join(DIST_DIR, "intake.html"));
    expect(
      intakeSrcs.length,
      `intake.html script/preload srcs: ${intakeSrcs.join(", ")}`,
    ).toBeGreaterThan(0);

    const intakeOnlySrcs = intakeSrcs.filter((src) => !indexSrcs.includes(src));
    expect(intakeOnlySrcs.length, `intake.html srcs: ${intakeSrcs.join(", ")}`).toBeGreaterThan(0);

    // Checking all 3 markers here (not just "duckdb") is what makes this a
    // regression detector for the FULL vendoring surface `FORBIDDEN_MARKERS`
    // polices on index.html's side (Codex R1 P1) -- a build that dropped
    // xlsx or encoding reachability while keeping DuckDB reachable would
    // still have passed a duckdb-only check.
    const intakeOnlyText = readAssets(intakeOnlySrcs);
    for (const marker of ["duckdb", "exceljs", "iconv"]) {
      expect(intakeOnlyText, `intake.html's own bundle is missing "${marker}"`).toContain(marker);
    }
  });

  // Codex R1 P1's fix (narrowing `IntakeApp.tsx`'s imports to
  // `@hyakkei/core/datasource` instead of the root `@hyakkei/core` barrel,
  // which also re-exports `./renderer`) has an observable, checkable
  // consequence: intake.html must NOT pull in the same ECharts payload
  // index.html does. Verified empirically pre-fix (an "echarts"-containing
  // chunk WAS shared, ~1.37MB) and post-fix (it is not) -- pinned here so a
  // future import that widens back to the root barrel regresses loudly
  // instead of silently ballooning intake.html's real payload.
  //
  // Phase 6-B adversarial review: checking only the SHARED-with-index
  // subset (as an earlier draft did) can pass vacuously two ways -- (1) if
  // no chunks are shared at all (a chunking-strategy change unrelated to
  // this fix), the assertion trivially holds without proving anything, and
  // (2) if ECharts leaked into an intake-EXCLUSIVE chunk instead of a
  // shared one, intake.html would still ship the ~1.3MB payload this test
  // exists to catch. Three checks close both gaps: a sanity check that
  // ECharts really is reachable from *something* in this build (so "not
  // found" can't be explained by an unrelated build regression), a sanity
  // check that real sharing genuinely happens (proving the shared-chunk
  // filter itself isn't just returning empty), and the actual claim
  // checked against intake.html's FULL bundle, not only its shared subset.
  it("intake.html does not pull in index.html's ECharts renderer payload anywhere in its bundle (no unused ~1.3MB)", () => {
    const indexSrcs = scriptSrcsFromHtml(join(DIST_DIR, "index.html"));
    const intakeSrcs = scriptSrcsFromHtml(join(DIST_DIR, "intake.html"));

    const indexText = readAssets(indexSrcs);
    expect(indexText, "sanity: index.html's own bundle should contain ECharts").toContain(
      "echarts",
    );

    const sharedSrcs = intakeSrcs.filter((src) => indexSrcs.includes(src));
    expect(
      sharedSrcs.length,
      "sanity: expected at least one legitimately shared chunk (e.g. react-dom) between index.html and intake.html",
    ).toBeGreaterThan(0);

    const intakeText = readAssets(intakeSrcs);
    expect(intakeText, "intake.html's full bundle contains ECharts somewhere").not.toContain(
      "echarts",
    );
  });
});
