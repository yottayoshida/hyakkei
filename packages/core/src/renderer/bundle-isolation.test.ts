// Plan §技術選定 subpath export separation: `@hyakkei/core/renderer` must
// never pull `@duckdb/duckdb-wasm` or `exceljs` into a viewer bundle
// (ADR-0005: the viewer never runs SQL). This is verified empirically by
// actually bundling the subpath entry with esbuild, not merely asserted by
// inspecting source imports (ADR-0005's own CSP-hash caveat: "verify
// empirically, don't trust it by construction").
import { join } from "node:path";
import * as esbuild from "esbuild";
import { describe, expect, it } from "vitest";

const FORBIDDEN_MARKERS = ["duckdb", "exceljs", "AsyncDuckDB", "new Worker("];
const FORBIDDEN_PATH_SEGMENTS = ["/bake/", "/datasource/"];

function assertNoForbiddenContent(result: esbuild.BuildResult<{ metafile: true }>) {
  const inputPaths = Object.keys(result.metafile.inputs);
  // Sentinel (no-hardcoded-hex.test.ts's own convention): a bundle graph
  // that silently resolved to near-nothing would make every assertion
  // below pass vacuously.
  expect(inputPaths.length, `bundle graph: ${inputPaths.join(", ")}`).toBeGreaterThan(5);
  expect(inputPaths.some((path) => path.includes("mount"))).toBe(true);

  const offendingMarkerInputs = inputPaths.filter((path) =>
    FORBIDDEN_MARKERS.some((marker) => path.toLowerCase().includes(marker.toLowerCase())),
  );
  expect(offendingMarkerInputs, `bundle graph: ${inputPaths.join(", ")}`).toEqual([]);

  // Codex R1 P1: marker-substring matching alone would miss a pure
  // `./bake` or `./datasource` re-export that happens not to mention any
  // forbidden identifier by name yet (e.g. an accidental barrel re-export
  // added before either module grows a real duckdb/exceljs runtime call).
  const offendingPathSegments = inputPaths.filter((path) =>
    FORBIDDEN_PATH_SEGMENTS.some((segment) => path.includes(segment)),
  );
  expect(offendingPathSegments, `bundle graph: ${inputPaths.join(", ")}`).toEqual([]);

  const bundleText = result.outputFiles?.[0]?.text ?? "";
  const offendingMarkers = FORBIDDEN_MARKERS.filter((marker) => bundleText.includes(marker));
  expect(offendingMarkers, "forbidden markers found in bundled output text").toEqual([]);
}

describe("renderer subpath bundle isolation (CI assert)", () => {
  it("bundling the source file packages/core/src/renderer/index.ts pulls in no duckdb/exceljs/bake/datasource code", async () => {
    const result = await esbuild.build({
      entryPoints: [join(import.meta.dirname, "index.ts")],
      bundle: true,
      write: false,
      format: "esm",
      platform: "browser",
      // Real npm dependencies of the final bundle -- not what this assert
      // is checking. `@hyakkei/schema` is a separate published package at
      // the actual packaging boundary; `echarts` is the renderer's own
      // declared dependency, already exact-pinned and audited separately.
      external: ["echarts", "@hyakkei/schema"],
      metafile: true,
      logLevel: "silent",
    });
    assertNoForbiddenContent(result);
  });

  it("bundling the PUBLISHED `@hyakkei/core/renderer` subpath (as an actual dependent package resolves it) is equally clean", async () => {
    // Codex R1 P1: bundling the source file directly (test above) cannot
    // catch a package.json `exports` map regression or a stale `dist/`
    // build -- resolving the bare specifier from a real dependent package's
    // directory (packages/app, which lists `@hyakkei/core` as a workspace
    // dependency) exercises the exact resolution a real consumer gets.
    // Requires `packages/core/dist` to already be built (root `pnpm test`
    // runs `build` before `-r run test`, per package.json).
    const appDir = join(import.meta.dirname, "..", "..", "..", "app");
    const result = await esbuild.build({
      stdin: {
        contents: `export * from "@hyakkei/core/renderer";`,
        resolveDir: appDir,
        loader: "ts",
      },
      bundle: true,
      write: false,
      format: "esm",
      platform: "browser",
      external: ["echarts", "@hyakkei/schema"],
      metafile: true,
      logLevel: "silent",
    });
    assertNoForbiddenContent(result);
  });
});
