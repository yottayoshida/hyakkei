import { assertByteCeiling } from "./byte-gate.js";
import { prepareCsvInputAsync } from "./encoding.js";
import { quoteIdentifier, quoteStringLiteral } from "./identifier.js";
import {
  describeTable,
  describeVirtualFile,
  throwClassifiedFailure,
  withVirtualBufferFile,
  withVirtualTextFile,
} from "./register-path.js";
import { assertContentShape } from "./sniff.js";
import {
  DataSourceError,
  type RegisterContext,
  type RegisteredTable,
  type SourceShape,
} from "./types.js";

const readCsvAutoCall = (quotedPath: string): string => `read_csv_auto(${quotedPath})`;

/** CS-B1/EN-5: a genuinely empty (0-byte) file has no header to interpret at all — distinct from CS-6 (a header-only file, which registers fine with rowCount:0 and is left to read_csv_auto to handle). */
function assertNotEmpty(bytes: Uint8Array): void {
  if (bytes.byteLength === 0) throw new DataSourceError("empty", "the file has no content");
}

export async function inspectCsv(ctx: RegisterContext, bytes: Uint8Array): Promise<SourceShape> {
  assertByteCeiling(bytes);
  assertNotEmpty(bytes);
  assertContentShape(bytes, "csv");
  const input = await prepareCsvInputAsync(bytes);
  const columns =
    input.kind === "buffer"
      ? await withVirtualBufferFile(ctx.registrar.db, input.bytes, "csv", (virtualName) =>
          describeVirtualFile(ctx.registrar.conn, readCsvAutoCall, virtualName),
        )
      : await withVirtualTextFile(ctx.registrar.db, input.text, "csv", (virtualName) =>
          describeVirtualFile(ctx.registrar.conn, readCsvAutoCall, virtualName),
        );
  return { kind: "columns", columns };
}

/**
 * CS-B4 (ambiguous delimiter, silent misparse — not this function's
 * concern, `read_csv_auto`'s own sniffer decides): a genuinely malformed
 * CSV `read_csv_auto` itself refuses to parse at all surfaces here as a
 * catchable `corrupt`, not an unhandled DuckDB exception reaching the
 * caller.
 *
 * Honest correction (Phase 8 QA review, verified empirically — the
 * original comment here was wrong, not just imprecise): CS-B3 (ragged
 * rows — a row with more/fewer fields than the header) does **not**
 * throw under `read_csv_auto`, even with `ignore_errors=false`/
 * `null_padding=false` passed explicitly. Confirmed live against this
 * project's pinned DuckDB-WASM version: the auto-detection sniffer
 * silently drops rows that don't fit its own detected column count
 * *before* `ignore_errors`/`null_padding` would ever apply (those flags
 * govern behavior once a schema is locked in, not the sniffer's own
 * row-selection) — the observed result for a 3-column-header file with a
 * 2-field row and a 4-field row was a **single surviving row**, generic
 * `column0..N` names, and no error at all. This is real, silent,
 * partial data loss, worse than the CS-B4 class it was assumed to share
 * `read_csv_auto`'s strictness with. The only reliable strict-rejection
 * path found (`read_csv(path, auto_detect=false, columns={...})`) requires
 * an explicit schema this function does not have ahead of time — fixing
 * this properly needs a two-step "detect schema via `read_csv_auto`, then
 * re-read strictly with that schema pinned" redesign, tracked as a
 * follow-up rather than rushed into this PR. `e2e/datasource-register.spec.ts`'s
 * ragged-csv test asserts the CURRENT (imperfect) behavior, not the
 * originally-intended one, so a regression to something worse (an
 * unhandled exception) is still caught.
 */
export async function registerCsv(
  ctx: RegisterContext,
  tableId: string,
  bytes: Uint8Array,
): Promise<RegisteredTable> {
  assertByteCeiling(bytes);
  assertNotEmpty(bytes);
  assertContentShape(bytes, "csv");
  const input = await prepareCsvInputAsync(bytes);
  const quotedId = quoteIdentifier(tableId);

  const register = async (virtualName: string) => {
    try {
      await ctx.registrar.conn.query(
        `CREATE TABLE ${quotedId} AS SELECT * FROM ${readCsvAutoCall(quoteStringLiteral(virtualName))}`,
      );
    } catch (cause) {
      throwClassifiedFailure(
        cause,
        "ran out of memory while registering the CSV",
        "the CSV content could not be parsed",
      );
    }
  };
  if (input.kind === "buffer") {
    await withVirtualBufferFile(ctx.registrar.db, input.bytes, "csv", register);
  } else {
    await withVirtualTextFile(ctx.registrar.db, input.text, "csv", register);
  }

  const { columns, rowCount } = await describeTable(ctx.registrar.conn, tableId);
  return { id: tableId, columns, rowCount };
}
