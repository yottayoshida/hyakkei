import type { AsyncDuckDBConnection } from "@duckdb/duckdb-wasm";

/**
 * DuckDB-WASM's defense-in-depth flags (ARCHITECTURE §6, ADR-0007). CSP
 * `connect-src` is the primary containment mechanism and holds on its own —
 * `docs/spikes/m0-containment.md` verified zero successful external
 * requests with these flags entirely absent — but M0 still recommends
 * shipping them, since they close `LOAD`/extension paths one layer earlier
 * (before a request is even attempted) and remain a second, independent
 * control if a future CSP change is done carelessly for an unrelated
 * reason (ADR-0007 "Consequences").
 *
 * `lock_configuration` must run last: once set, it freezes every `SET`
 * after it (that's its entire purpose — nothing after this call in a real
 * DuckDB session can loosen these flags again).
 *
 * Deliberately excluded: `enable_external_access`. M0 found it also blocks
 * `registerFileBuffer`'s local, in-memory reads — the editor's own "load
 * the user's file" workflow — so setting it would break FileSource, not
 * just harden UrlSource/httpfs.
 *
 * Belongs to `packages/app`, not `packages/core/src/datasource`: this
 * operates on an already-constructed `AsyncDuckDBConnection` (dependency
 * injection, same as `TableRegistrar` — it never constructs a `Worker` or
 * `AsyncDuckDB` instance itself), but the DuckDB factory that owns that
 * construction is app-owned (PR-A2; `packages/core/src/renderer/
 * bundle-isolation.test.ts` forbids a `new Worker(` marker in core's
 * bundle), so this stays alongside it rather than splitting DuckDB-facing
 * code across two packages for no benefit.
 */
export async function configureContainment(conn: AsyncDuckDBConnection): Promise<void> {
  await conn.query(`SET autoinstall_known_extensions=false`);
  await conn.query(`SET autoload_known_extensions=false`);
  await conn.query(`SET allow_community_extensions=false`);
  await conn.query(`SET lock_configuration=true`);
}
