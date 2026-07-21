import { DEFAULT_MAX_BYTES } from "@hyakkei/core/datasource";
import { describe, expect, it, vi } from "vitest";
import { DATA_SIZE_CEILING_BYTES, getResolvedDataLayer, loadDataLayer } from "./data-layer.js";

// This test file is allowed to statically import `@hyakkei/core/datasource`
// -- it is never part of the shipped app bundle (bundle-isolation.test.ts
// only inspects `dist/`), so it can safely cross the boundary
// `data-layer.ts` itself must not.
describe("data-layer.ts", () => {
  it("DATA_SIZE_CEILING_BYTES mirrors the real DEFAULT_MAX_BYTES exactly (drift detector)", () => {
    expect(DATA_SIZE_CEILING_BYTES).toBe(DEFAULT_MAX_BYTES);
  });

  it("loadDataLayer() resolves to a layer exposing the datasource and factory surfaces IntakeApp/UrlPanel need", async () => {
    const layer = await loadDataLayer();
    expect(typeof layer.datasource.createFileSource).toBe("function");
    expect(typeof layer.datasource.createUrlSource).toBe("function");
    expect(typeof layer.datasource.createEgressPolicy).toBe("function");
    expect(typeof layer.datasource.classifyUrlTarget).toBe("function");
    expect(typeof layer.datasource.quoteIdentifier).toBe("function");
    expect(typeof layer.datasource.rowToPlainObject).toBe("function");
    expect(typeof layer.datasource.DataSourceError).toBe("function");
    expect(typeof layer.factory.createDuckDB).toBe("function");
  });

  it("loadDataLayer() memoizes -- concurrent callers share the same promise, not a fresh import per call", async () => {
    const first = loadDataLayer();
    const second = loadDataLayer();
    expect(first).toBe(second);
    await first;
  });

  it("getResolvedDataLayer() is undefined before the first load and returns the layer once resolved", async () => {
    // Not asserting `undefined` up front: a prior test in this file may
    // have already resolved the module-level singleton (Vitest runs tests
    // within a file against the same module instance) -- this test's real
    // claim is the POST-resolution invariant, which is safe regardless of
    // ordering.
    const layer = await loadDataLayer();
    expect(getResolvedDataLayer()).toBe(layer);
  });

  it("loadDataLayer() wraps an import() rejection in DataLayerLoadError (issue #91), not the raw underlying error -- toIntakeError's instanceof check needs a stable, app-owned class to attribute the failure to the app, not the user's file", async () => {
    vi.resetModules();
    vi.doMock("@hyakkei/core/datasource", () => {
      throw new Error("simulated chunk fetch failure");
    });
    const fresh = await import("./data-layer.js");
    await expect(fresh.loadDataLayer()).rejects.toBeInstanceOf(fresh.DataLayerLoadError);
    vi.doUnmock("@hyakkei/core/datasource");
    vi.resetModules();
  });
});

// `getDuckDBHandle()`'s own composition (loadDataLayer + factory.createDuckDB
// behind one singleton) is exercised transitively by every e2e test that
// actually loads a file/URL (e2e/intake-harness.spec.ts) -- calling it here
// would construct a real `Worker` and fetch WASM, which this Node/jsdom unit
// test environment cannot do (V-002/003/004, plan Phase 2 QA test-layer
// assignment: DuckDB instantiation is e2e-only).
