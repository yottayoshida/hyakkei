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

type UrlSourceSpec = Extract<Source, { kind: "url" }>;

/**
 * Mirror of `createFileSource` for the two formats `UrlSource` supports
 * (`Source.format` is `csv | parquet` only for `kind:"url"` — xlsx is
 * structurally FileSource-only, shape enumeration RS-10). The only delta
 * from `FileSource` is *how* bytes are acquired — `ctx.egress.fetchBytes()`
 * (A1, already https-scheme/origin/size-capped) instead of a synchronous
 * File API read — the shared register path downstream (sniff, byte gate,
 * decode, `CREATE TABLE`) is identical, confirming the mirror hypothesis
 * (shape enumeration §5): correct only because the byte gate lives in the
 * *shared* register path, not solely in `egress`.
 *
 * Unlike `FileSource`, bytes here are cached after the first fetch: a
 * second acquisition would be a real duplicate network request against a
 * URL that may not be idempotent, not just wasted CPU — worth the one
 * `bytesPromise` field to avoid.
 */
export function createUrlSource(spec: UrlSourceSpec): DataSource {
  let bytesPromise: Promise<Uint8Array> | undefined;
  const acquireBytes = (ctx: RegisterContext): Promise<Uint8Array> => {
    bytesPromise ??= ctx.egress.fetchBytes(spec.ref.url);
    return bytesPromise;
  };

  return {
    spec,
    async inspect(ctx: RegisterContext): Promise<SourceShape> {
      const bytes = await acquireBytes(ctx);
      switch (spec.format) {
        case "csv":
          return inspectCsv(ctx, bytes);
        case "parquet":
          return inspectParquet(ctx, bytes);
      }
    },
    async register(ctx: RegisterContext, _opts?: RegisterOptions): Promise<RegisteredTable> {
      const bytes = await acquireBytes(ctx);
      switch (spec.format) {
        case "csv":
          return registerCsv(ctx, spec.id, bytes);
        case "parquet":
          return registerParquet(ctx, spec.id, bytes);
      }
    },
  };
}
