// ADR-0007/plan D9: the DuckDB virtual-filesystem name a `DataSource`
// registers bytes under is always internally generated, never derived
// from `spec.ref.name`/`sheet` (author-authored, untrusted values) — this
// is what keeps the file-path string literal `read_csv_auto('<name>')`/
// `read_parquet('<name>')` argument safe without needing to escape
// arbitrary author input: the generated name's character set is fixed by
// construction (`[A-Za-z0-9_.]` only), so there is nothing for a string-
// literal-breakout attempt to reach.
let counter = 0;

/** `extension` is cosmetic only (aids debugging virtual-file-not-found
 * errors) — `read_csv_auto`/`read_parquet` are called explicitly per
 * format in this codebase, never the extension-sniffing generic dispatcher,
 * so DuckDB itself never inspects this name's extension. */
export function nextVirtualFileName(extension: string): string {
  return `__hyakkei_buf_${counter++}.${extension}`;
}
