import * as duckdb from "@duckdb/duckdb-wasm";
import { appAssetUrl } from "../asset-url.js";
import { configureContainment } from "./containment.js";

/**
 * Self-hosted worker/wasm paths (PR-A1.5's `copy-duckdb-vendor.mjs` puts
 * these files here at build time) — mirrors `spikes/lib/duckdb.mjs`'s
 * MANUAL_BUNDLES exactly. COI (multi-threaded) is deliberately excluded:
 * it requires COOP/COEP response headers, which the `file://`/plain-
 * static-hosting deployment targets this project supports can't provide
 * (ADR-0005).
 */
function manualBundles() {
  return {
    mvp: {
      mainModule: appAssetUrl("vendor/duckdb-mvp.wasm"),
      mainWorker: appAssetUrl("vendor/duckdb-browser-mvp.worker.js"),
    },
    eh: {
      mainModule: appAssetUrl("vendor/duckdb-eh.wasm"),
      mainWorker: appAssetUrl("vendor/duckdb-browser-eh.worker.js"),
    },
  };
}

/**
 * Phase 3 PoC finding: a `Worker` pointed at a nonexistent/unreachable
 * script neither resolves nor rejects `AsyncDuckDB.instantiate()` within
 * any bounded time on its own — confirmed empirically (a 404'd worker path
 * left the returned promise pending past 5s with no error surfaced). A
 * white screen is exactly the failure mode this project's success criteria
 * forbid, so `createDuckDB()` wraps instantiation in an explicit timeout
 * and throws a real `Error` if it fires.
 */
const INIT_TIMEOUT_MS = 15_000;

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (err) => {
        clearTimeout(timer);
        reject(err);
      },
    );
  });
}

export interface DuckDBHandle {
  db: duckdb.AsyncDuckDB;
  conn: duckdb.AsyncDuckDBConnection;
}

/**
 * The app-owned DuckDB factory (D8, ADR-0007 amendment): `packages/core/
 * src/renderer/bundle-isolation.test.ts` forbids a `new Worker(` marker in
 * core's bundle, so `DataSource.register()`/`inspect()` implementations
 * receive an already-constructed `TableRegistrar` (types.ts) via DI —
 * this function is the one place that constructs it.
 *
 * Order matters and is fixed by Phase 3 PoC (verified empirically, not
 * assumed): `custom_extension_repository` must be `SET` and `LOAD
 * parquet` must run *before* `configureContainment()`, because
 * `configureContainment`'s `lock_configuration=true` freezes every `SET`
 * after it — attempting the extension-repository redirect afterward would
 * throw. An explicit `LOAD` (as opposed to relying on
 * `autoload_known_extensions`) still succeeds even once containment later
 * sets that flag `false` — confirmed by PoC — because `LOAD` is a direct,
 * explicit statement, not the automatic-loading path that flag gates.
 */
export async function createDuckDB(): Promise<DuckDBHandle> {
  const bundle = await duckdb.selectBundle(manualBundles());
  // `mainWorker` is typed nullable (duckdb-wasm's general `SelectedBundle`
  // shape allows a worker-less target) but both `MANUAL_BUNDLES` entries
  // above always declare one — this can only be null if duckdb-wasm's own
  // bundle-selection logic picked neither, which would itself be a defect
  // worth a clear failure over a silent `!` assertion.
  if (!bundle.mainWorker) {
    throw new Error("DuckDB-WASM bundle selection returned no worker script path");
  }
  const worker = new Worker(bundle.mainWorker);
  const logger = new duckdb.ConsoleLogger(duckdb.LogLevel.WARNING);
  const db = new duckdb.AsyncDuckDB(logger, worker);
  await withTimeout(
    db.instantiate(bundle.mainModule, bundle.pthreadWorker),
    INIT_TIMEOUT_MS,
    "DuckDB-WASM instantiation",
  );

  const conn = await db.connect();

  // Self-hosted parquet extension (PR-A2 prerequisite, Phase 3 PoC finding):
  // `LOAD parquet` fetches `parquet.duckdb_extension.wasm` from
  // `extensions.duckdb.org` by default — exactly like `httpfs` — which
  // `connect-src 'self'` (PR-A1.5) blocks outright. `custom_extension_
  // repository` (a genuine DuckDB setting, not a hyakkei invention —
  // verified present in the pinned duckdb-eh.wasm binary) redirects that
  // fetch to this same-origin path instead; `copy-duckdb-extension.mjs`
  // vendors the exact file DuckDB will request there at build time.
  // DuckDB appends `/<engine-version>/wasm_<bundle>/parquet.duckdb_
  // extension.wasm` onto this base itself — verified empirically, this
  // script does not need to know which bundle (eh/mvp) is active.
  await conn.query(`SET custom_extension_repository='${appAssetUrl("vendor/extensions")}'`);
  await conn.query(`LOAD parquet`);

  await configureContainment(conn);

  return { db, conn };
}
