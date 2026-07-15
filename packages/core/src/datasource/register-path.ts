import type { AsyncDuckDB, AsyncDuckDBConnection } from "@duckdb/duckdb-wasm";
import type * as arrow from "apache-arrow";
import { quoteIdentifier, quoteStringLiteral } from "./identifier.js";
import { DataSourceError, type ColumnMeta, type DataSourceErrorKind } from "./types.js";
import { nextVirtualFileName } from "./virtual-file.js";

/**
 * `read_csv_auto`/`read_parquet`/`insertJSONFromPath` failures reach the
 * three register functions as an opaque WASM exception — no typed
 * distinction between "the content is malformed" and "DuckDB ran out of
 * WASM heap partway through" exists at that boundary. `oom` is a real,
 * catchable, distinctly-worded DuckDB error (`docs/spikes/m0-duckdb.md`,
 * verified empirically: `"Out of Memory Error: could not allocate block of
 * size..."`, a stable prefix from DuckDB's own C++ exception category, not
 * this project's invention) — collapsing it into `corrupt` would show the
 * intake UI's "the file looks broken" copy instead of D10's oom-specific
 * "your data was never stored on this computer" reassurance for a failure
 * that has nothing to do with the file's content being wrong.
 */
export function classifyRegisterFailure(cause: unknown): DataSourceErrorKind {
  if (cause instanceof Error && cause.message.startsWith("Out of Memory Error")) return "oom";
  return "corrupt";
}

/**
 * The `classifyRegisterFailure` → pick-a-message → `throw new
 * DataSourceError` sequence was identical across csv-source.ts,
 * parquet-source.ts, and xlsx-source.ts's `register*()` catch blocks,
 * varying only in the two message strings (/simplify simplification pass).
 */
export function throwClassifiedFailure(
  cause: unknown,
  oomMessage: string,
  corruptMessage: string,
): never {
  const kind = classifyRegisterFailure(cause);
  throw new DataSourceError(kind, kind === "oom" ? oomMessage : corruptMessage, { cause });
}

/**
 * Reads column name/type off the arrow `Table` a query already returned,
 * rather than parsing `DESCRIBE`'s textual output (whose exact column
 * naming isn't part of this project's own contract to depend on) —
 * `Table.schema.fields` is apache-arrow's own typed introspection API,
 * already present on every query result this codebase ever gets back.
 */
export function columnMetaFromArrowTable(table: arrow.Table): ColumnMeta[] {
  return table.schema.fields.map((field) => ({ name: field.name, type: field.type.toString() }));
}

/**
 * Converts one row of a `Table.toArray()` result (an apache-arrow
 * `StructRow` proxy) into a plain object — the exported, tested version of
 * a fix this PR found empirically while re-verifying XL-B4's e2e coverage
 * (/simplify altitude pass): apache-arrow's OWN `StructRow.toJSON()`
 * (`node_modules/apache-arrow/row/struct.mjs`) builds its return value via
 * `json[key] = value` on a plain `{}`, which silently drops a column
 * literally named `__proto__` (the exotic `[[Prototype]]` setter no-ops
 * for a non-object value) — even though the DuckDB table itself has the
 * column correctly. `row`'s own `Symbol.iterator` yields plain `[key,
 * value]` tuples with no object-key assignment involved, so iterating it
 * (not calling `.toJSON()`) is safe regardless of what a column is named.
 * A future editor/preview implementation (PR-B) reading registered table
 * rows back into JS should call this rather than reinventing it — the bug
 * this works around has no compiler signal, only a real-browser e2e test
 * (`e2e/datasource-register.spec.ts`) catches a regression back to `.toJSON()`.
 */
export function rowToPlainObject(row: Iterable<[string, unknown]>): Record<string, unknown> {
  return Object.fromEntries(
    [...row].map(([key, value]) => [key, typeof value === "bigint" ? Number(value) : value]),
  );
}

/**
 * O-REG's file-acquisition step for a decoded-text source (csv, and xlsx's
 * JSON staging content). Registers a virtual file, hands its
 * internally-generated name (safe to embed as a SQL string-literal path
 * argument, virtual-file.ts) to `use`, and unconditionally drops it
 * afterward.
 *
 * QA Phase 8 finding (Bug-fact): the original `registerTextFile`/
 * `registerBufferFile` returned the virtual name and left cleanup to the
 * caller — no caller ever called `db.dropFile()`, so every `inspect()`/
 * `register()` call left its virtual file behind in DuckDB-WASM's virtual
 * filesystem for the lifetime of the connection. At this project's own
 * 100MB-class target size, repeated registrations accumulate real memory.
 * `finally` guarantees the drop runs whether `use` succeeds or throws.
 */
export async function withVirtualTextFile<T>(
  db: AsyncDuckDB,
  content: string,
  extension: string,
  use: (virtualName: string) => Promise<T>,
): Promise<T> {
  const name = nextVirtualFileName(extension);
  await db.registerFileText(name, content);
  try {
    return await use(name);
  } finally {
    await db.dropFile(name);
  }
}

/**
 * O-REG's file-acquisition step for a raw-bytes source (parquet). Same
 * register→use→drop discipline as `withVirtualTextFile` above.
 *
 * `db.registerFileBuffer` transfers (detaches) the `Uint8Array`'s
 * underlying `ArrayBuffer` to DuckDB's Worker for zero-copy performance —
 * verified empirically (Phase 5 e2e): a caller's `bytes` reference becomes
 * unusable (`length` reads 0, any read throws "detached ArrayBuffer")
 * immediately after this call returns. `parquet-source.ts`'s `inspect()`
 * and `register()` both register the *same* caller-owned `bytes` — passing
 * a copy here, not the original, keeps that caller's reference valid for
 * a second call instead of silently breaking it (a correctness bug, not
 * just an ergonomics one: the second call would read a zero-length buffer
 * and misreport `unsupported-format`, not `oom`/a clear "already consumed"
 * error).
 */
export async function withVirtualBufferFile<T>(
  db: AsyncDuckDB,
  content: Uint8Array,
  extension: string,
  use: (virtualName: string) => Promise<T>,
): Promise<T> {
  const name = nextVirtualFileName(extension);
  await db.registerFileBuffer(name, content.slice());
  try {
    return await use(name);
  } finally {
    await db.dropFile(name);
  }
}

/**
 * `SELECT * FROM "<id>" LIMIT 0` (schema only, no row materialization) +
 * `SELECT COUNT(*)` (row count without pulling row data into the JS/Arrow
 * layer) — deliberately two cheap queries rather than reading every row
 * back just to derive `{columns, rowCount}` (wasteful for a 100MB-class
 * table, the exact scale this project's success criteria target).
 */
export async function describeTable(
  conn: AsyncDuckDBConnection,
  tableId: string,
): Promise<{ columns: ColumnMeta[]; rowCount: number }> {
  const quotedId = quoteIdentifier(tableId);
  try {
    const schemaResult = await conn.query(`SELECT * FROM ${quotedId} LIMIT 0`);
    const countResult = await conn.query(`SELECT COUNT(*) AS row_count FROM ${quotedId}`);
    const rowCount = Number(countResult.toArray()[0]?.row_count ?? 0);
    return { columns: columnMetaFromArrowTable(schemaResult), rowCount };
  } catch (cause) {
    // Reached only after a successful CREATE TABLE — a failure here (e.g.
    // OOM during the COUNT scan of a huge table) is just as real and just
    // as untyped-by-default as a register-time failure; the same
    // classification applies (Round 1 Codex review: DuckDB-side failures
    // must never reach the caller as a raw, unclassified exception).
    throw new DataSourceError(
      classifyRegisterFailure(cause),
      "could not read back the registered table",
      {
        cause,
      },
    );
  }
}

/**
 * Schema of a virtual file *without* creating a persistent, `spec.id`-named
 * table — `inspect()`'s csv/parquet case (types.ts: "what a csv/parquet/
 * url source can offer instead" of a sheet list). Reuses the same
 * `quoteStringLiteral`-escaped virtual-file path `register()` will later
 * reference for the real `CREATE TABLE`, so acquiring/decoding bytes never
 * happens twice for one `DataSource` instance (the acquire-once
 * discipline, shape enumeration §5a).
 */
export async function describeVirtualFile(
  conn: AsyncDuckDBConnection,
  readerCall: (path: string) => string,
  virtualFileName: string,
): Promise<ColumnMeta[]> {
  try {
    const result = await conn.query(
      `SELECT * FROM ${readerCall(quoteStringLiteral(virtualFileName))} LIMIT 0`,
    );
    return columnMetaFromArrowTable(result);
  } catch (cause) {
    // Round 1 Codex review (Bug-fact): `inspect()` (csv/parquet) reaches
    // this on a schema-only query — a truncated/corrupt file that still
    // passes O-SNIFF's magic check (e.g. PQ-B1/PQ-B2) throws HERE, before
    // `register()` ever runs its own try/catch. Left unwrapped, this was a
    // raw WASM exception reaching the caller during `inspect()` alone,
    // never a catchable `DataSourceError` — a real gap `register()`'s
    // parallel wrapping did not cover.
    throw new DataSourceError(classifyRegisterFailure(cause), "the content could not be read", {
      cause,
    });
  }
}
