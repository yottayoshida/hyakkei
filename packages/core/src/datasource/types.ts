import type { AsyncDuckDB, AsyncDuckDBConnection } from "@duckdb/duckdb-wasm";
import type { Source } from "@hyakkei/schema";

/**
 * The DuckDB handle a `DataSource` needs to register a table. Provided by
 * the caller (editor / bake step) via dependency injection — a `DataSource`
 * never constructs or owns a DuckDB connection itself. This is what keeps
 * PR-A1 (this interface, plus `EgressPolicy`) fully testable without a real
 * WASM instance: `register()`'s *contract* is pinned here; PR-A2 wires the
 * real `db`/`conn` and implements the byte-to-table bodies.
 */
export interface TableRegistrar {
  db: AsyncDuckDB;
  conn: AsyncDuckDBConnection;
}

/**
 * The intended sole path a `DataSource` uses to reach the network
 * (ARCHITECTURE §6, plan D3): a `UrlSource` implementation calls
 * `ctx.egress.fetchBytes()` rather than importing `fetch` itself, and that
 * implementation (`createEgressPolicy`, `egress-policy.ts`) owns the
 * https-scheme check and origin allowlist match. This is a contract
 * `RegisterContext` makes easy to follow correctly (`egress` is always
 * present, ready to use) — TypeScript cannot stop a careless future
 * implementation from calling the global `fetch` directly instead, so this
 * is a review-time discipline the DataSource implementations (PR-A2) must
 * honor, not a guarantee the type system enforces on its own.
 *
 * `FileSource` never reads `egress` — it stays on `RegisterContext` (always
 * present, not optional) so a future snapshot-form `ProxySource` can consume
 * it the same way `UrlSource` does, without `RegisterContext` needing a
 * reshape (shape enumeration §5a mirror-seam confirmation).
 */
export interface EgressPolicy {
  fetchBytes(url: string): Promise<Uint8Array>;
}

export interface RegisterContext {
  registrar: TableRegistrar;
  egress: EgressPolicy;
}

export type ColumnMeta = { name: string; type: string };

export type RegisteredTable = {
  id: string;
  columns: ColumnMeta[];
  rowCount: number;
};

/**
 * `inspect()`'s result — what a `DataSource` can tell the caller about its
 * content *before* a final `register()` call commits to one interpretation
 * of it. `sheets` drives the editor's sheet-picker for a multi-sheet xlsx
 * (M0 fixture #5 is a real 3-sheet workbook); `columns` is what a csv/
 * parquet/url source can offer instead, since none of those have a
 * sheet concept. Note that "inspect" is not free: for `xlsx`, ExcelJS
 * cannot partially parse a workbook, and for `UrlSource`, inspecting means
 * fetching — implementations should cache the acquired bytes/parse result
 * so a following `register()` call doesn't redo the work (shape enumeration
 * §5a).
 */
export type SourceShape =
  | { kind: "sheets"; sheets: string[] }
  | { kind: "columns"; columns: ColumnMeta[]; rowCountEstimate?: number };

export type RegisterOptions = { sheet?: string };

/**
 * Every leaf a shape enumerated across FileSource/UrlSource ingestion (A2),
 * the intake UI's error states (PR-B), and the OOM-specific UI (#44) maps to
 * (shape enumeration §5b's completeness cross-check) — declared once here so
 * later PRs only ever add a leaf, never reshape the union.
 */
export type DataSourceErrorKind =
  | "unsupported-format"
  | "corrupt"
  | "empty"
  | "too-large"
  | "encoding"
  | "network-blocked"
  | "network-notfound"
  | "non-csv-response"
  | "aborted"
  | "oom";

export class DataSourceError extends Error {
  readonly kind: DataSourceErrorKind;

  constructor(kind: DataSourceErrorKind, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "DataSourceError";
    this.kind = kind;
  }
}

export interface DataSource {
  readonly spec: Source;
  inspect(ctx: RegisterContext): Promise<SourceShape>;
  register(ctx: RegisterContext, opts?: RegisterOptions): Promise<RegisteredTable>;
}

// Implementation note for PR-A2 (`register()`'s real body): `spec.id`
// (`SqlIdentifier`, packages/schema) is a value, not a property name — it
// deliberately accepts `__proto__`/`constructor`/`prototype` as SQL-safe
// table-name values (schema test SI-A5; `SAFE_PROPERTY_NAMES`,
// packages/schema/src/common.ts, guards property *names*, not values, and
// intentionally doesn't cover this). Never key a plain `{}` by `spec.id`
// via bracket assignment (`cache[spec.id] = ...`) — that reopens the exact
// prototype-pollution class `SAFE_PROPERTY_NAMES` closes elsewhere, just
// through the value channel. Use a `Map` for any `spec.id`-keyed lookup.
