import { describe, expect, it } from "vitest";
import { appAssetUrl } from "./asset-url.js";

describe("appAssetUrl", () => {
  const deployedUnderSubpath = "https://example.github.io/hyakkei/";

  it("resolves a same-origin asset relative to the deployed subpath", () => {
    expect(appAssetUrl("vendor/duckdb-browser-mvp.worker.js", deployedUnderSubpath)).toBe(
      "https://example.github.io/hyakkei/vendor/duckdb-browser-mvp.worker.js",
    );
  });

  it.each([
    "/vendor/worker.js",
    "../vendor/worker.js",
    "..\\vendor\\worker.js",
    "https://cdn.example/worker.js",
    "//cdn.example/worker.js",
  ])("rejects an unsafe app asset path: %s", (path) => {
    expect(() => appAssetUrl(path, deployedUnderSubpath)).toThrow(/relative app asset path/i);
  });
});
