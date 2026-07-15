import { DataSourceError } from "./types.js";

const EOCD_SIGNATURE = 0x06054b50; // "PK\x05\x06"
const CENTRAL_DIR_SIGNATURE = 0x02014b50; // "PK\x01\x02"
const ZIP64_EOCD_LOCATOR_SIGNATURE = 0x07064b50; // "PK\x06\x07"
const EOCD_FIXED_SIZE = 22;
const MAX_COMMENT_LENGTH = 65535;
const CENTRAL_DIR_ENTRY_FIXED_SIZE = 46;

export interface ZipGateOptions {
  maxEntries?: number;
  maxTotalUncompressedBytes?: number;
  maxCompressionRatio?: number;
}

const DEFAULT_MAX_ENTRIES = 10_000;
const DEFAULT_MAX_TOTAL_UNCOMPRESSED_BYTES = 512 * 1024 * 1024;
const DEFAULT_MAX_COMPRESSION_RATIO = 200;

// `Uint8Array.prototype.buffer`/`byteOffset` account for `bytes` possibly
// being a *view* into a larger `ArrayBuffer` (e.g. a subarray) — a `DataView`
// built any other way could read outside `bytes`'s own bounds. Native
// little-endian `getUint32`/`getUint16` replace a hand-rolled bit-shift
// reader (/simplify reuse pass) with no behavior change.
function toDataView(bytes: Uint8Array): DataView {
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
}

function findEndOfCentralDirectory(bytes: Uint8Array): number {
  // The EOCD record's variable-length comment field means its start
  // position isn't fixed — scan backward from the tail. The comment is
  // capped at 65535 bytes, so the search window is bounded regardless of
  // overall file size (never a full-file scan).
  const view = toDataView(bytes);
  const searchStart = Math.max(0, bytes.length - EOCD_FIXED_SIZE - MAX_COMMENT_LENGTH);
  for (let i = bytes.length - EOCD_FIXED_SIZE; i >= searchStart; i--) {
    if (view.getUint32(i, true) === EOCD_SIGNATURE) return i;
  }
  return -1;
}

/**
 * O-XGATE (shape enumeration §3a/ZB-*, plan D6/technical-selection table):
 * a hand-rolled zip EOCD + central-directory parse run *before*
 * `ExcelJS.Workbook#xlsx.load()` — the only in-browser xlsx parse path
 * (`WorkbookReader`, ExcelJS's streaming reader, is verified absent from
 * the browser build; `xlsx.load()` fully materializes the decompressed
 * content in memory, so a decompression-bomb defense must happen before
 * that call, not during it). Feasibility confirmed by Phase 3 PoC against
 * all 8 real xlsx fixtures (typical compression ratio ~3.1–3.3×) plus
 * synthetic adversarial byte sequences for every fail-closed branch below.
 *
 * Every unrecognized/unsupported shape fails closed (v0.1 handles only a
 * normal Excel-saved zip, per the technical-selection table's own
 * boundary): Zip64 (`ZB-4`), encrypted entries (`ZB-5`), and unsupported
 * compression methods (`ZB-6`) all reject as `unsupported-format`; a
 * broken/absent EOCD, an out-of-bounds central-directory entry, or a
 * duplicate entry name (`ZB-7`/`ZB-8`) reject as `corrupt`; entry count,
 * total uncompressed size, and compression ratio ceilings (`ZB-1`/`ZB-2`/
 * `ZB-3`/`ZB-9`) reject as `too-large`.
 *
 * Honest scope boundary (Phase 8 Security + QA review, both independently):
 * `totalUncompressed`/`totalCompressed` are accounted from the central
 * directory's own *declared* `uncompressedSize`/`compressedSize` fields —
 * this function never decompresses anything itself, so it cannot verify
 * those declared sizes against what a real DEFLATE stream actually expands
 * to. A zip that under-declares its central-directory sizes while its
 * local entries genuinely decompress far larger would pass this gate's
 * size/ratio accounting undetected — a **different** attack from ZB-1/ZB-2
 * (which target the honest-declaration case this gate is verified against,
 * `assertZipGate — real xlsx fixtures pass` + the ZB-1 tests below). This
 * is the structural limit of any pre-decompression static gate, not a
 * bug fixable by more bookkeeping here. Two real backstops still hold
 * regardless: (1) `assertByteCeiling` (byte-gate.ts) bounds the *input*
 * bytes this function ever sees to 256 MiB, which upper-bounds how much a
 * under-declaring zip could physically smuggle; (2) blast radius is the
 * caller's own tab (browser-only, no shared server/tenant), so the worst
 * case is a catchable parse failure or, absent that, a single-tab crash —
 * never data exfiltration or a cross-user impact. Tracked as a follow-up:
 * a real (non-declared-size) decompression-bomb reproduction through
 * `ExcelJS.load()`, and/or a tighter xlsx-specific byte ceiling.
 */
export function assertZipGate(bytes: Uint8Array, options: ZipGateOptions = {}): void {
  const {
    maxEntries = DEFAULT_MAX_ENTRIES,
    maxTotalUncompressedBytes = DEFAULT_MAX_TOTAL_UNCOMPRESSED_BYTES,
    maxCompressionRatio = DEFAULT_MAX_COMPRESSION_RATIO,
  } = options;

  const eocdOffset = findEndOfCentralDirectory(bytes);
  if (eocdOffset === -1) {
    throw new DataSourceError("corrupt", "no zip end-of-central-directory record found");
  }
  const view = toDataView(bytes);

  const totalEntries = view.getUint16(eocdOffset + 10, true);
  const centralDirSize = view.getUint32(eocdOffset + 12, true);
  const centralDirOffset = view.getUint32(eocdOffset + 16, true);

  // Zip64 sentinel values (0xFFFF/0xFFFFFFFF) in the standard EOCD record,
  // or a Zip64 EOCD locator immediately preceding it — either indicates a
  // Zip64 archive, which this gate does not parse (fail-closed, not a
  // silent misread of a 32-bit-truncated size).
  const hasZip64Sentinel =
    totalEntries === 0xffff || centralDirSize === 0xffffffff || centralDirOffset === 0xffffffff;
  const hasZip64Locator =
    eocdOffset >= 20 && view.getUint32(eocdOffset - 20, true) === ZIP64_EOCD_LOCATOR_SIGNATURE;
  if (hasZip64Sentinel || hasZip64Locator) {
    throw new DataSourceError("unsupported-format", "Zip64 archives are not supported");
  }

  if (totalEntries > maxEntries) {
    throw new DataSourceError(
      "too-large",
      `zip contains ${totalEntries} entries, exceeding the ${maxEntries}-entry limit`,
    );
  }

  let offset = centralDirOffset;
  let totalUncompressed = 0;
  let totalCompressed = 0;
  const seenNames = new Set<string>();
  // Hoisted out of the loop (up to `maxEntries`, default 10,000, iterations)
  // — a fatal-mode decoder carries no per-call state, so there's nothing to
  // gain from re-constructing one per entry (/simplify efficiency pass).
  const fatalUtf8Decoder = new TextDecoder("utf-8", { fatal: true });

  for (let i = 0; i < totalEntries; i++) {
    if (offset + CENTRAL_DIR_ENTRY_FIXED_SIZE > bytes.length) {
      throw new DataSourceError("corrupt", `central directory entry ${i} is out of bounds`);
    }
    if (view.getUint32(offset, true) !== CENTRAL_DIR_SIGNATURE) {
      throw new DataSourceError("corrupt", `central directory entry ${i} has an invalid signature`);
    }

    const generalPurposeBitFlag = view.getUint16(offset + 8, true);
    const compressionMethod = view.getUint16(offset + 10, true);
    const compressedSize = view.getUint32(offset + 20, true);
    const uncompressedSize = view.getUint32(offset + 24, true);
    const nameLength = view.getUint16(offset + 28, true);
    const extraFieldLength = view.getUint16(offset + 30, true);
    const commentLength = view.getUint16(offset + 32, true);

    // Bit 0 of the general-purpose flag marks an encrypted entry.
    if ((generalPurposeBitFlag & 0x1) !== 0) {
      throw new DataSourceError("unsupported-format", "encrypted zip entries are not supported");
    }
    // 0 = stored (no compression), 8 = deflate — the only two methods a
    // normal Excel-saved xlsx ever uses.
    if (compressionMethod !== 0 && compressionMethod !== 8) {
      throw new DataSourceError(
        "unsupported-format",
        `unsupported zip compression method ${compressionMethod}`,
      );
    }
    if (compressedSize === 0xffffffff || uncompressedSize === 0xffffffff) {
      throw new DataSourceError(
        "unsupported-format",
        "Zip64 entry sentinel values are not supported",
      );
    }

    // Round 1 Codex review (Bug-fact): bounds-check the FULL entry span
    // (name + extra + comment) up front, not just the name — an oversized
    // extra/comment length previously only surfaced (if at all) one
    // iteration late, via the next entry's signature check, rather than
    // failing closed at the entry that actually declared it.
    const entrySpan = CENTRAL_DIR_ENTRY_FIXED_SIZE + nameLength + extraFieldLength + commentLength;
    if (offset + entrySpan > bytes.length) {
      throw new DataSourceError("corrupt", `central directory entry ${i} is out of bounds`);
    }
    // Fatal decode: a non-UTF-8 byte sequence replaced with U+FFFD instead
    // of rejected could coincidentally collide with (or mask a collision
    // with) another entry's name, defeating the duplicate-name check below.
    let name: string;
    try {
      name = fatalUtf8Decoder.decode(
        bytes.subarray(
          offset + CENTRAL_DIR_ENTRY_FIXED_SIZE,
          offset + CENTRAL_DIR_ENTRY_FIXED_SIZE + nameLength,
        ),
      );
    } catch {
      throw new DataSourceError(
        "corrupt",
        `central directory entry ${i}'s file name is not valid UTF-8`,
      );
    }
    if (seenNames.has(name)) {
      throw new DataSourceError("corrupt", `duplicate zip entry name: ${name}`);
    }
    seenNames.add(name);

    totalUncompressed += uncompressedSize;
    totalCompressed += compressedSize;
    offset += entrySpan;
  }

  // Round 1 Codex review (Bug-fact, parser-differential risk): `totalEntries`
  // and `centralDirSize` are two independently attacker-controlled EOCD
  // fields; this gate only ever reads `totalEntries` entries and never used
  // `centralDirSize` to cross-check it. A forged EOCD understating
  // `totalEntries` relative to what actually sits at `centralDirOffset`
  // would pass this gate's size/ratio accounting for only the entries it
  // walked — while a more lenient zip reader (ExcelJS's underlying
  // library, which is not guaranteed to trust `totalEntries` over a
  // forward scan) could still decompress additional, unaccounted-for
  // entries. Requiring the walked span to land exactly on the declared
  // `centralDirSize` closes that gap: the two fields must agree.
  if (offset !== centralDirOffset + centralDirSize) {
    throw new DataSourceError(
      "corrupt",
      "central directory entries do not add up to the declared central directory size",
    );
  }

  if (totalUncompressed > maxTotalUncompressedBytes) {
    throw new DataSourceError(
      "too-large",
      `zip's total uncompressed size (${totalUncompressed} bytes) exceeds the ${maxTotalUncompressedBytes}-byte limit`,
    );
  }
  const ratio = totalCompressed > 0 ? totalUncompressed / totalCompressed : 1;
  if (ratio > maxCompressionRatio) {
    throw new DataSourceError(
      "too-large",
      `zip's compression ratio (${ratio.toFixed(1)}x) exceeds the ${maxCompressionRatio}x limit`,
    );
  }
}
