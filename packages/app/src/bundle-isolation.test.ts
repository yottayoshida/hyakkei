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
import { beforeAll, describe, expect, it } from "vitest";

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

type ManifestChunk = {
  file: string;
  src?: string;
  isEntry?: boolean;
  isDynamicEntry?: boolean;
  imports?: string[];
  dynamicImports?: string[];
};
type ViteManifest = Record<string, ManifestChunk>;

function readManifest(): ViteManifest {
  return JSON.parse(readFileSync(join(DIST_DIR, ".vite", "manifest.json"), "utf-8"));
}

/**
 * Every manifest key reachable from `entryKey` via STATIC `imports` only
 * (never `dynamicImports`) -- exactly "what's really in this entry's own
 * build graph," the set a Stage B negative assert must find zero
 * data-layer keys in.
 */
function staticClosure(manifest: ViteManifest, entryKey: string): Set<string> {
  const seen = new Set<string>();
  const stack = [entryKey];
  while (stack.length > 0) {
    const key = stack.pop()!;
    if (seen.has(key)) continue;
    seen.add(key);
    for (const dep of manifest[key]?.imports ?? []) stack.push(dep);
  }
  return seen;
}

/**
 * Every `dynamicImports` entry reachable from a static closure -- a Stage B
 * positive assert must find the data-layer keys here. Takes an
 * already-computed `staticClosure(...)` result rather than an `entryKey`
 * (/simplify Efficiency finding): callers that need both the closure itself
 * AND its dynamic edges (as the Stage B tests below do) would otherwise
 * recompute the same closure walk twice.
 */
function dynamicEdgesFrom(manifest: ViteManifest, closure: Set<string>): Set<string> {
  const out = new Set<string>();
  for (const key of closure) {
    for (const dep of manifest[key]?.dynamicImports ?? []) out.add(dep);
  }
  return out;
}

/**
 * The two dynamic-import specifiers `data-layer.ts`'s `importDataLayer()`
 * uses (`@hyakkei/core/datasource`, `./duckdb/factory.js`), as Vite records
 * them in the manifest (resolved source paths, not the specifier strings
 * themselves). These are the keys `staticClosure`/`dynamicEdgesFrom` check
 * against -- module-source-path-keyed, so chunk FILENAME hashes changing
 * between builds (or a chunk being shared with `register-harness.html` via
 * Rollup dedup) cannot cause a false match or a false negative the way a
 * text/filename grep can.
 */
const DATA_LAYER_MODULE_KEYS = ["../core/dist/datasource/index.js", "src/duckdb/factory.ts"];

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

describe("packages/app real build output isolation (CI assert)", () => {
  // issue #11a (single-SPA editor, ADR-0010): index.html is no longer a
  // pure viewer with zero legitimate reason to reference the data layer --
  // it legitimately reaches it now, but only lazily (Stage B, below). This
  // check is narrower than the pre-#11a version: golden-harness markers
  // (which have no reason to ever appear here) must still be genuinely
  // absent, and any duckdb/exceljs/iconv occurrence must be nothing more
  // than a stripped lazy-chunk filename reference, not real library code.
  it("index.html's static bundle text contains no golden-harness markers, and no data-layer occurrence beyond a stripped lazy-chunk filename reference", () => {
    const srcs = scriptSrcsFromHtml(join(DIST_DIR, "index.html"));
    // Sentinel: a build that silently produced zero script references
    // would make every assertion below pass vacuously.
    expect(srcs.length, `index.html script/preload srcs: ${srcs.join(", ")}`).toBeGreaterThan(0);

    const bundleText = stripChunkPathReferences(readAssets(srcs));
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

  // Stage B of issue #54 (extended by issue #11a's single-SPA rewrite):
  // index.html IS the editor now (the former separate intake.html entry is
  // gone) -- the entry chunk must stay as statically clean of the data
  // layer as intake.html's Stage A entry was. Verified via Vite's own build
  // manifest (`dist/.vite/manifest.json`) rather than chunk-text grepping:
  // a mapDeps-array text-extraction approach (considered and rejected
  // during this PR's review) cannot detect a chunk reachable only via a
  // bare `import("./chunk.js")` call site with no array literal at all --
  // empirically confirmed against this exact build, where `_App-*.js`'s
  // `factory.ts` edge has no such array. The manifest's `imports` (static)
  // vs `dynamicImports` (lazy) fields are Vite's own authoritative record
  // of the same distinction, keyed by resolved module source path rather
  // than an unstable content hash -- immune to two failure modes a
  // text-based check has: chunk-filename hashes changing between builds,
  // and register-harness.html sharing the same underlying chunk via
  // Rollup's dedup (register-harness.html reaches these same two modules
  // through its OWN `imports` field, never `dynamicImports` -- a separate
  // manifest key entirely, so it cannot be conflated with index.html's
  // edge either way).
  // Manifest read + closure walk computed once and shared by both tests
  // below (/simplify Efficiency finding) -- each was independently
  // recomputing both (the second via its own internal call to
  // `staticClosure`), redundant I/O and graph traversal for a value
  // neither test mutates.
  let manifest: ViteManifest;
  let indexStaticClosure: Set<string>;
  beforeAll(() => {
    manifest = readManifest();
    indexStaticClosure = staticClosure(manifest, "index.html");
  });

  it("index.html's entry does not STATICALLY contain the data-layer module (issue #54 Stage B / #11a: the single editor entry, not just its former intake.html sibling, must stay clean)", () => {
    for (const key of DATA_LAYER_MODULE_KEYS) {
      expect(
        [...indexStaticClosure],
        `data-layer module "${key}" found in index.html's static closure`,
      ).not.toContain(key);
    }
  });

  // The static-absence check above only proves the data layer is ABSENT
  // from index.html's static graph -- it says nothing about whether the
  // lazy-load wiring itself regressed and silently dropped the data layer
  // from the build entirely (a broken `import()` specifier would also pass
  // that check). This is what turns "the entry doesn't have it" into "it's
  // still reachable, just lazily."
  it("index.html can still reach the data layer, but only through a dynamic-import edge (vendoring regression detector: not silently lost from the build)", () => {
    const dynamicEdges = dynamicEdgesFrom(manifest, indexStaticClosure);
    for (const key of DATA_LAYER_MODULE_KEYS) {
      expect(
        [...dynamicEdges],
        `expected a dynamic-import edge to "${key}" reachable from index.html`,
      ).toContain(key);
    }
  });
});
