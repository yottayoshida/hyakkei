import type { DuckDBHandle } from "./duckdb/factory.js";

/**
 * Mirrors @hyakkei/core/datasource's real `DEFAULT_MAX_BYTES`
 * (byte-gate.ts, 256 MiB). Duplicated as a literal, not imported:
 * importing anything -- even a single constant -- from
 * `@hyakkei/core/datasource` statically pulls its whole barrel
 * (exceljs/iconv-lite/duckdb types via file-source.ts/url-source.ts) into
 * whatever chunk does the importing, which is exactly what this lazy
 * boundary exists to prevent (bundle-isolation.test.ts, issue #54).
 * `IntakeApp`'s OOM-prevention gate (Security review F-1: reject an
 * oversized file from cheap `file.size` metadata BEFORE
 * `file.arrayBuffer()` fully materializes it) must stay synchronous and
 * not wait on a data-layer fetch first -- drift against the real constant
 * is caught by data-layer.test.ts asserting equality against the real
 * export.
 */
export const DATA_SIZE_CEILING_BYTES = 256 * 1024 * 1024;

/**
 * Thrown when `importDataLayer()`'s dynamic `import()` itself rejects (a
 * chunk-fetch failure, permanent for the rest of the page per the module-map
 * doc comment below) — distinct from a `DataSourceError` (a problem with the
 * user's file/URL). `toIntakeError` (IntakeApp.tsx) checks `instanceof` this
 * FIRST, before the datasource-error check, so the failure is attributed to
 * "the app failed to load its own code" rather than misclassified as
 * `corrupt` ("the user's file is broken") — issue #91.
 */
export class DataLayerLoadError extends Error {
  constructor(cause: unknown) {
    super("failed to load the application's data layer");
    this.name = "DataLayerLoadError";
    this.cause = cause;
  }
}

async function importDataLayer() {
  const [datasource, factory] = await Promise.all([
    import("@hyakkei/core/datasource"),
    import("./duckdb/factory.js"),
  ]);
  return { datasource, factory };
}

export type DataLayer = Awaited<ReturnType<typeof importDataLayer>>;

let layerPromise: Promise<DataLayer> | undefined;
let resolvedLayer: DataLayer | undefined;

/**
 * The single dynamic-import boundary between the intake entry chunk and
 * the data layer (DuckDB-WASM, ExcelJS, iconv-lite via
 * `@hyakkei/core/datasource`, and this app's own DuckDB factory) -- issue
 * #54. The two specifiers above are literal, not computed (Security T6):
 * a computed specifier could be redirected to a third-party origin,
 * silently reopening the CDN-egress path self-hosted vendoring
 * (ADR-0007) exists to close.
 *
 * Singleton + rejection-reset, the same pattern `IntakeApp`'s own
 * (now-removed) `getHandle()` used for `createDuckDB()`: on rejection the
 * cached promise is cleared rather than left permanently wedged.
 *
 * **What this reset does and does NOT guarantee** (Phase 6-B adversarial
 * review, verified empirically against a real built app, not assumed):
 * clearing `layerPromise` lets the NEXT *caller* start a fresh Promise
 * chain -- this is what stops a caller that arrives after a failure from
 * awaiting an already-stale rejection forever. It does NOT make the
 * underlying `import()` re-fetch over the network. Per the HTML spec's
 * module map ("once a module map entry's result is not 'fetching', it
 * does not change"), a browser records a failed module-script fetch as a
 * permanent entry for that exact URL for the rest of the page's
 * lifetime -- confirmed empirically (Playwright + `page.route`: a route
 * that aborts only the FIRST request and lets every later one through
 * still shows ZERO further network requests for that chunk on a second
 * in-page attempt; the browser replays the cached failure without
 * touching the network again). A transient failure is therefore only
 * recoverable by a full page reload, not by retrying in-page -- this is
 * a real, currently-undocumented UX gap (a full reload isn't prompted
 * anywhere), tracked as a follow-up rather than solved in this PR (it
 * would need either query-string cache-busting on the dynamic import
 * specifier, forgoing Vite's static code-split analysis for this call, or
 * an explicit "reload the page" affordance in the error UI).
 */
export function loadDataLayer(): Promise<DataLayer> {
  layerPromise ??= importDataLayer()
    .then((layer) => {
      resolvedLayer = layer;
      return layer;
    })
    .catch((err: unknown) => {
      layerPromise = undefined;
      resolvedLayer = undefined;
      throw new DataLayerLoadError(err);
    });
  return layerPromise;
}

/**
 * Synchronous access to an already-resolved layer, for code that only
 * needs to run after an earlier `await loadDataLayer()` already succeeded
 * elsewhere in the same call chain (error classification in a `catch`
 * block) -- avoids threading the layer object through every call site.
 * Returns `undefined` if the layer has never resolved (never requested,
 * still in flight, or its most recent attempt failed); callers must treat
 * that the same as "not a recognized error type", the correct fallback in
 * all three cases.
 */
export function getResolvedDataLayer(): DataLayer | undefined {
  return resolvedLayer;
}

let handlePromise: Promise<DuckDBHandle> | undefined;

/** Composes `loadDataLayer()` + `factory.createDuckDB()` behind one singleton, same rejection-reset. */
export function getDuckDBHandle(): Promise<DuckDBHandle> {
  handlePromise ??= loadDataLayer()
    .then(({ factory }) => factory.createDuckDB())
    .catch((err: unknown) => {
      handlePromise = undefined;
      throw err;
    });
  return handlePromise;
}

/**
 * For callers that need both the handle and the layer object
 * (startUrl/handleRedo) — NOT `Promise.all([loadDataLayer(),
 * getDuckDBHandle()])` (/simplify efficiency finding): `getDuckDBHandle()`
 * already awaits `loadDataLayer()` internally before it can resolve, so
 * that pairing never actually runs anything in parallel, just awaits
 * `getDuckDBHandle()` with an extra, redundant call alongside it. Reading
 * `getResolvedDataLayer()` after `getDuckDBHandle()` settles is exactly as
 * cheap and cannot observe a stale/absent layer, by the same dependency.
 */
export async function getDuckDBHandleWithLayer(): Promise<{
  handle: DuckDBHandle;
  layer: DataLayer;
}> {
  const handle = await getDuckDBHandle();
  const layer = getResolvedDataLayer();
  if (!layer) {
    // Unreachable: getDuckDBHandle() succeeding means the loadDataLayer()
    // it awaits internally already resolved and cached itself first.
    throw new Error("unreachable: getDuckDBHandle() resolved without a cached data layer");
  }
  return { handle, layer };
}

/**
 * Warm hooks (UX: shell + drop zone paint before the data layer
 * downloads). Both are silent, best-effort. A sharper risk than ordinary
 * best-effort failure, though (see `loadDataLayer()`'s doc comment above
 * for why): a warm call that hits a transient network blip permanently
 * poisons the SAME chunk URL for every later real attempt this page
 * session too, per the browser's own module-map caching -- confirmed
 * empirically for both hooks below, tracked as issue #91, not yet
 * mitigated.
 */
export function warmDataLayerModule(): void {
  loadDataLayer().catch(() => {
    // silent -- real usage retries and reports
  });
}

/** Full warm through DuckDB instantiation (not just the module), for the dragenter trigger where a drop is imminent. */
export function warmDuckDB(): void {
  getDuckDBHandle().catch(() => {
    // silent -- real usage retries and reports
  });
}

/**
 * Schedules a module-only warm (not DuckDB instantiation) during idle
 * time, so it never competes with first paint. Safari has no
 * `requestIdleCallback` -- falls back to a `setTimeout`, which still
 * keeps this off the critical path, just without idle-scheduling's
 * yield-to-more-urgent-work property.
 */
export function scheduleIdleWarm(): void {
  if (typeof requestIdleCallback === "function") {
    requestIdleCallback(() => warmDataLayerModule());
  } else {
    setTimeout(() => warmDataLayerModule(), 0);
  }
}
