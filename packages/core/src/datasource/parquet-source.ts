import { assertByteCeiling } from "./byte-gate.js";
import { quoteIdentifier, quoteStringLiteral } from "./identifier.js";
import {
  describeTable,
  describeVirtualFile,
  throwClassifiedFailure,
  withVirtualBufferFile,
} from "./register-path.js";
import { assertContentShape } from "./sniff.js";
import type { RegisterContext, RegisteredTable, SourceShape } from "./types.js";

const readParquetCall = (quotedPath: string): string => `read_parquet(${quotedPath})`;

export async function inspectParquet(
  ctx: RegisterContext,
  bytes: Uint8Array,
): Promise<SourceShape> {
  assertByteCeiling(bytes);
  assertContentShape(bytes, "parquet");
  const columns = await withVirtualBufferFile(ctx.registrar.db, bytes, "parquet", (virtualName) =>
    describeVirtualFile(ctx.registrar.conn, readParquetCall, virtualName),
  );
  return { kind: "columns", columns };
}

/**
 * PQ-B1/PQ-B2/PQ-B3 (truncated tail, corrupt footer/metadata, an
 * unsupported compression codec — `assertContentShape` already ruled out
 * a missing head `PAR1` magic, so anything reaching this point plausibly
 * *is* a Parquet file): DuckDB's own `read_parquet` throws for all three;
 * this function does not attempt to distinguish which one from the error
 * text (that would mean depending on DuckDB's free-text error messages,
 * which are not this project's contract to parse) — all three surface
 * uniformly as a catchable `corrupt`. The one exception is `oom`
 * (`classifyRegisterFailure`, register-path.ts): a real WASM heap
 * exhaustion is a different failure family from a malformed file, matched
 * on DuckDB's stable `"Out of Memory Error"` prefix, not general free-text
 * sniffing of PQ-B1/B2/B3's own distinctions.
 */
export async function registerParquet(
  ctx: RegisterContext,
  tableId: string,
  bytes: Uint8Array,
): Promise<RegisteredTable> {
  assertByteCeiling(bytes);
  assertContentShape(bytes, "parquet");
  const quotedId = quoteIdentifier(tableId);

  await withVirtualBufferFile(ctx.registrar.db, bytes, "parquet", async (virtualName) => {
    try {
      await ctx.registrar.conn.query(
        `CREATE TABLE ${quotedId} AS SELECT * FROM ${readParquetCall(quoteStringLiteral(virtualName))}`,
      );
    } catch (cause) {
      throwClassifiedFailure(
        cause,
        "ran out of memory while registering the Parquet file",
        "the Parquet content could not be read",
      );
    }
  });

  const { columns, rowCount } = await describeTable(ctx.registrar.conn, tableId);
  return { id: tableId, columns, rowCount };
}
