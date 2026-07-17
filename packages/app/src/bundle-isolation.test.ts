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
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const DIST_DIR = join(import.meta.dirname, "..", "dist");
const ASSETS_DIR = join(DIST_DIR, "assets");
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

/**
 * Strips Vite's own `__vite__mapDeps` dependency-array literal (the
 * preload manifest a dynamic `import()` call site embeds, e.g.
 * `__vite__mapDeps=(...,d=(m.f||(m.f=["assets/exceljs.min-<hash>.js",...])))`)
 * before marker matching. This is expected, harmless bookkeeping — the
 * entry chunk MUST know a lazily-loaded chunk's filename to fetch it
 * later, and that filename can legitimately contain a forbidden marker
 * (e.g. `exceljs.min-<hash>.js`) without any of the marker's actual
 * library CODE being present in the entry. Verified empirically (issue
 * #54 Stage A): this is the only source of an "exceljs" match in intake's
 * own ~15 KB entry chunk once the data layer is truly lazy-loaded — the
 * real exceljs code lives in its own ~1 MB chunk elsewhere, only
 * referenced here by filename.
 *
 * Anchored specifically to `__vite__mapDeps=` (Codex R1 P2: the prior,
 * unanchored `"assets\/...\.js"` pattern would have silently swallowed a
 * forbidden marker appearing in ANY quoted asset-path-shaped string
 * anywhere in the chunk, e.g. inside an unrelated error-message literal,
 * not just Vite's own manifest) — `__vite__mapDeps` is Vite's own stable,
 * never-minified-away preload-helper identifier (confirmed present
 * verbatim in the real minified build output), so this only strips text
 * that is provably part of Vite's dependency bookkeeping, nothing else.
 *
 * `js|css` (Phase 6-B adversarial review): Vite's own manifest array can
 * legitimately mix chunk types -- a dynamically-imported module with its
 * own associated stylesheet gets BOTH a `.js` and a `.css` entry in the
 * SAME `__vite__mapDeps` array. This build currently emits no CSS assets
 * (a `.js`-only pattern happens to match today), but a `.js`-only
 * requirement here is a latent trap: if the array ever mixed extensions,
 * this whole regex would fail to match at all (its `+` quantifier
 * requires EVERY entry to fit the pattern), silently reverting to
 * unstripped text and risking a false-positive `FORBIDDEN_MARKERS` CI
 * failure the day someone adds one. `js|css` closes that gap now, before
 * it's reachable.
 */
function stripChunkPathReferences(text: string): string {
  return text.replaceAll(
    /__vite__mapDeps=[^;]*?\[(?:"assets\/[^"]+\.(?:js|css)",?)+\]/g,
    "__vite__mapDeps=STRIPPED",
  );
}

/**
 * All JS chunks Vite/Rollup actually emitted, as HTML-relative src paths
 * (`/assets/<file>.js`) matching `scriptSrcsFromHtml`'s own format. Needed
 * for issue #54's lazy-loaded data layer: a dynamically `import()`-ed
 * chunk is fetched by runtime JS inside its loading chunk, never
 * referenced by any `<script>`/`<link>` tag in the HTML itself, so it is
 * invisible to `scriptSrcsFromHtml` and must be found by listing
 * `dist/assets` directly instead.
 */
function allEmittedChunkSrcs(): string[] {
  return readdirSync(ASSETS_DIR)
    .filter((name) => name.endsWith(".js"))
    .map((name) => `/assets/${name}`);
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

  // Stage A of issue #54 (data-layer lazy-load boundary): before this,
  // intake.html's own entry chunk STATICALLY contained duckdb/exceljs/
  // iconv (the test this replaces asserted exactly that, as a vendoring
  // regression detector). `IntakeApp.tsx`/`UrlPanel.tsx` now reach the data
  // layer only through `data-layer.ts`'s `loadDataLayer()` dynamic
  // `import()` -- so the entry chunk itself must be as clean as
  // index.html's own (same `FORBIDDEN_MARKERS`, same reasoning): the data
  // layer now lives in a separately-emitted chunk this entry only
  // `import()`s at runtime, on first file drop / URL submit / warm
  // trigger, never in the entry's own static graph.
  it("intake.html's entry chunk does not statically contain the data layer (issue #54 Stage A: lazy boundary)", () => {
    const indexSrcs = scriptSrcsFromHtml(join(DIST_DIR, "index.html"));
    const intakeSrcs = scriptSrcsFromHtml(join(DIST_DIR, "intake.html"));
    expect(
      intakeSrcs.length,
      `intake.html script/preload srcs: ${intakeSrcs.join(", ")}`,
    ).toBeGreaterThan(0);

    const intakeOnlySrcs = intakeSrcs.filter((src) => !indexSrcs.includes(src));
    expect(intakeOnlySrcs.length, `intake.html srcs: ${intakeSrcs.join(", ")}`).toBeGreaterThan(0);

    const intakeOnlyText = stripChunkPathReferences(readAssets(intakeOnlySrcs));
    const found = FORBIDDEN_MARKERS.filter((marker) => intakeOnlyText.includes(marker));
    expect(found, "forbidden markers found in intake.html's ENTRY chunk").toEqual([]);
  });

  // D7's reverse assertion, Stage A form: the entry-chunk check above only
  // proves duckdb/exceljs/iconv are ABSENT from intake.html's entry -- it
  // says nothing about whether the lazy-load wiring itself regressed and
  // silently dropped the data layer from the build entirely (a broken
  // `import()` specifier would also pass every assertion above). Checking
  // FOR the markers in a chunk OUTSIDE both entries' static graphs is what
  // turns "the entry doesn't have it" into "it's still reachable, just
  // lazily" -- this deliberately does not claim the discovered chunk is
  // EXCLUSIVELY intake's own lazy chunk (register-harness.html's own
  // static entry also reaches the data layer and could share a chunk with
  // it via Rollup's dedup) -- only that the data layer wasn't silently
  // lost from the build.
  it("the data layer (duckdb/exceljs/iconv) is still reachable in the build output, outside both index.html's and intake.html's entries (vendoring regression detector)", () => {
    const indexSrcs = scriptSrcsFromHtml(join(DIST_DIR, "index.html"));
    const intakeSrcs = scriptSrcsFromHtml(join(DIST_DIR, "intake.html"));
    const nonEntrySrcs = allEmittedChunkSrcs().filter(
      (src) => !indexSrcs.includes(src) && !intakeSrcs.includes(src),
    );
    expect(
      nonEntrySrcs.length,
      "expected at least one chunk outside index.html's/intake.html's entries",
    ).toBeGreaterThan(0);

    const nonEntryText = readAssets(nonEntrySrcs);
    for (const marker of ["duckdb", "exceljs", "iconv"]) {
      expect(
        nonEntryText,
        `no chunk outside index.html's/intake.html's entries contains "${marker}"`,
      ).toContain(marker);
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
