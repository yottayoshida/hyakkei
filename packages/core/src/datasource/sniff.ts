import { startsWith, UTF8_BOM } from "./byte-prefix.js";
import { DataSourceError } from "./types.js";

// Parquet's magic is the ASCII bytes "PAR1", present at both the start and
// end of a well-formed file — checked here at the head only (a cheap,
// early extension-spoof/wrong-content check); a truncated tail is instead
// caught downstream when `read_parquet` itself throws (PQ-B1, mapped to
// `corrupt` by the parquet register path, not by this function).
const PARQUET_MAGIC = new Uint8Array([0x50, 0x41, 0x52, 0x31]); // "PAR1"
// xlsx is a zip container; the local-file-header signature "PK\x03\x04" is
// present at the start of every non-empty zip.
const ZIP_MAGIC = new Uint8Array([0x50, 0x4b, 0x03, 0x04]);

/**
 * Skips a UTF-8 BOM and leading ASCII whitespace, then checks whether what
 * follows looks like the start of an HTML document (`<` or `<!doctype`,
 * case-insensitive) — the shape a same-origin authentication redirect, an
 * error page, or any other non-data response takes (ADV-3/EN-8/V-090).
 * Deliberately loose (checks for the leading `<` alone, not a full HTML
 * grammar): the goal is catching an obviously-wrong response, not
 * validating HTML.
 */
function looksLikeHtml(bytes: Uint8Array): boolean {
  let offset = startsWith(bytes, UTF8_BOM) ? UTF8_BOM.length : 0;
  while (
    offset < bytes.length &&
    (bytes[offset] === 0x20 ||
      bytes[offset] === 0x09 ||
      bytes[offset] === 0x0a ||
      bytes[offset] === 0x0d)
  ) {
    offset++;
  }
  return bytes[offset] === 0x3c; // "<"
}

/**
 * O-SNIFF (shape enumeration §4): the shared register path's content-shape
 * check, run on already-acquired bytes before any format-specific parse —
 * covers both FileSource (an author declaring the wrong `format` for a
 * file, or a hostile/mislabeled file — ADV-2) and UrlSource (a same-origin
 * endpoint returning an HTML/JSON response instead of data — ADV-3/EN-8),
 * with one byte-based check shared by both, rather than trusting a
 * declared format or a server's `Content-Type` header (the latter is a
 * URL-only concern kept separate in `EgressPolicy`; this is the
 * authoritative content gate for every source).
 *
 * `csv` has no positive magic number to check (shape enumeration CS-*) —
 * the HTML check above is this function's only defense for csv; anything
 * else that isn't HTML is left to `read_csv_auto`'s own parse to accept or
 * reject (CS-B3/CS-B4).
 */
export function assertContentShape(bytes: Uint8Array, format: "csv" | "xlsx" | "parquet"): void {
  if (looksLikeHtml(bytes)) {
    throw new DataSourceError(
      "non-csv-response",
      `expected ${format} content but received what looks like an HTML page`,
    );
  }
  if (format === "parquet" && !startsWith(bytes, PARQUET_MAGIC)) {
    throw new DataSourceError(
      "unsupported-format",
      "content does not look like a Parquet file (missing 'PAR1' magic)",
    );
  }
  if (format === "xlsx" && !startsWith(bytes, ZIP_MAGIC)) {
    throw new DataSourceError(
      "unsupported-format",
      "content does not look like an xlsx workbook (missing zip signature)",
    );
  }
}
