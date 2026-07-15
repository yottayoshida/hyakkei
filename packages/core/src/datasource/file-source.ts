import type { Source } from "@hyakkei/schema";
import { inspectCsv, registerCsv } from "./csv-source.js";
import { inspectParquet, registerParquet } from "./parquet-source.js";
import type {
  DataSource,
  RegisterContext,
  RegisterOptions,
  RegisteredTable,
  SourceShape,
} from "./types.js";
import { inspectXlsx, registerXlsx } from "./xlsx-source.js";

type FileSourceSpec = Extract<Source, { kind: "file" }>;

/**
 * `bytes` is acquired synchronously via the File API by the caller, before
 * a `DataSource` is even constructed (`types.ts`'s own framing of
 * `FileSource`) — this function never fetches or lazily acquires anything.
 *
 * `inspect()` and `register()` each independently re-process `bytes`:
 * xlsx's `ExcelJS.load()` re-parses the whole workbook (M0: ~350-600ms even
 * at 50k rows — CPU only, no external side effect to duplicate); parquet's
 * `registerBufferFile` (register-path.ts) re-copies and re-registers the
 * *same* buffer into DuckDB-WASM's virtual filesystem, which is a real,
 * non-trivial cost at the project's own 100MB-class target size, not just
 * CPU time. `url-source.ts`'s `bytesPromise` memoization is the exact
 * pattern that would fix this — deliberately not applied here yet
 * (/simplify altitude pass, 2026-07-15): scoped out of this PR as an
 * acquire-once-caching improvement for `FileSource`, not because no cheap
 * fix exists.
 */
export function createFileSource(spec: FileSourceSpec, bytes: Uint8Array): DataSource {
  return {
    spec,
    async inspect(ctx: RegisterContext): Promise<SourceShape> {
      switch (spec.format) {
        case "csv":
          return inspectCsv(ctx, bytes);
        case "parquet":
          return inspectParquet(ctx, bytes);
        case "xlsx":
          return inspectXlsx(bytes);
      }
    },
    async register(ctx: RegisterContext, opts?: RegisterOptions): Promise<RegisteredTable> {
      switch (spec.format) {
        case "csv":
          return registerCsv(ctx, spec.id, bytes);
        case "parquet":
          return registerParquet(ctx, spec.id, bytes);
        case "xlsx":
          return registerXlsx(ctx, spec.id, bytes, opts?.sheet);
      }
    },
  };
}
