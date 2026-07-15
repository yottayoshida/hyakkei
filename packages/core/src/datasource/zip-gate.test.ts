import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { DataSourceError } from "./types.js";
import { assertZipGate } from "./zip-gate.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURES_DIR = join(
  __dirname,
  "..",
  "..",
  "..",
  "..",
  "spikes",
  "excel-fidelity",
  "fixtures",
);

function u16(n: number): number[] {
  return [n & 0xff, (n >> 8) & 0xff];
}

function u32(n: number): number[] {
  return [n & 0xff, (n >> 8) & 0xff, (n >> 16) & 0xff, (n >>> 24) & 0xff];
}

interface EntryOptions {
  name?: string;
  compressionMethod?: number;
  generalPurposeBitFlag?: number;
  compressedSize?: number;
  uncompressedSize?: number;
  extraFieldLength?: number;
  commentLength?: number;
}

/** A minimal central-directory file header — `assertZipGate` never reads local file headers/entry data, only this section, so tests never need to construct real compressed payloads. */
function centralDirEntry(opts: EntryOptions = {}): number[] {
  const nameBytes = Array.from(new TextEncoder().encode(opts.name ?? "sheet1.xml"));
  const extraFieldLength = opts.extraFieldLength ?? 0;
  const commentLength = opts.commentLength ?? 0;
  return [
    ...u32(0x02014b50), // central directory signature
    ...u16(20), // version made by
    ...u16(20), // version needed to extract
    ...u16(opts.generalPurposeBitFlag ?? 0),
    ...u16(opts.compressionMethod ?? 8), // deflate by default
    ...u16(0), // mod time
    ...u16(0), // mod date
    ...u32(0), // crc32
    ...u32(opts.compressedSize ?? 10),
    ...u32(opts.uncompressedSize ?? 30),
    ...u16(nameBytes.length),
    ...u16(extraFieldLength),
    ...u16(commentLength),
    ...u16(0), // disk number start
    ...u16(0), // internal attrs
    ...u32(0), // external attrs
    ...u32(0), // relative offset of local header
    ...nameBytes,
    ...new Array(extraFieldLength).fill(0),
    ...new Array(commentLength).fill(0),
  ];
}

interface ZipOptions {
  totalEntries?: number;
  centralDirSize?: number;
  centralDirOffset?: number;
  omitEocd?: boolean;
  prependZip64Locator?: boolean;
}

function buildZip(entries: number[][], opts: ZipOptions = {}): Uint8Array {
  const centralDir = entries.flat();
  const centralDirOffset = opts.centralDirOffset ?? 0;
  const totalEntries = opts.totalEntries ?? entries.length;
  const centralDirSize = opts.centralDirSize ?? centralDir.length;

  // The Zip64 EOCD locator (20 bytes: signature + disk number + 8-byte
  // offset + total disk count) sits immediately before the standard EOCD
  // record in a real Zip64 archive — `assertZipGate` looks exactly 20 bytes
  // back from the EOCD it found, so the fixture must place it there too.
  const zip64Locator = opts.prependZip64Locator
    ? [...u32(0x07064b50), ...u32(0), ...new Array(8).fill(0), ...u32(1)]
    : [];

  const eocd = [
    ...u32(0x06054b50),
    ...u16(0),
    ...u16(0),
    ...u16(totalEntries),
    ...u16(totalEntries),
    ...u32(centralDirSize),
    ...u32(centralDirOffset),
    ...u16(0), // comment length
  ];

  const body = [...centralDir, ...zip64Locator];
  return new Uint8Array(opts.omitEocd ? body : [...body, ...eocd]);
}

function expectRejects(bytes: Uint8Array, kind: string, matcher?: RegExp) {
  try {
    assertZipGate(bytes);
    expect.fail("expected assertZipGate to throw");
  } catch (err) {
    expect(err).toBeInstanceOf(DataSourceError);
    expect((err as DataSourceError).kind).toBe(kind);
    if (matcher) expect((err as DataSourceError).message).toMatch(matcher);
  }
}

describe("assertZipGate — real xlsx fixtures pass", () => {
  // Phase 6-B test adversarial review: the original list only covered the
  // M0-era corpus (01-10, minus the two .csv entries) — the fixtures added
  // during this PR (11-14, 18) are equally real Excel-saved zips and were
  // silently exempt from this independent-evidence check.
  const realFixtures = [
    "01-merged-header-2row.xlsx",
    "02-wareki-dates.xlsx",
    "03-fullwidth-digits.xlsx",
    "04-header-not-row1.xlsx",
    "05-multi-sheet.xlsx",
    "08-merged-cells-vertical.xlsx",
    "09-mixed-types-column.xlsx",
    "10-formula-cells.xlsx",
    "11-empty-sheet.xlsx",
    "12-formula-no-cache.xlsx",
    "13-duplicate-headers.xlsx",
    "14-hidden-sheet.xlsx",
    "18-proto-column.xlsx",
  ];

  for (const name of realFixtures) {
    it(`accepts ${name}`, () => {
      const bytes = new Uint8Array(readFileSync(join(FIXTURES_DIR, name)));
      expect(() => assertZipGate(bytes)).not.toThrow();
    });
  }

  // Phase 6-B: a real fixture's independently-verified total uncompressed
  // size (`unzip -v fixtures/01-merged-header-2row.xlsx` → 15858 bytes),
  // not a value derived from this test suite's own byte-builder — proves
  // the compressed/uncompressed size accounting is correct against an
  // actual zip, not merely self-consistent with `centralDirEntry()`'s own
  // assumptions about the byte layout.
  it("accepts fixture 01 exactly at its real total uncompressed size, rejects one byte below", () => {
    const bytes = new Uint8Array(readFileSync(join(FIXTURES_DIR, "01-merged-header-2row.xlsx")));
    expect(() => assertZipGate(bytes, { maxTotalUncompressedBytes: 15_858 })).not.toThrow();
    try {
      assertZipGate(bytes, { maxTotalUncompressedBytes: 15_857 });
      expect.fail("expected too-large");
    } catch (err) {
      expect(err).toBeInstanceOf(DataSourceError);
      expect((err as DataSourceError).kind).toBe("too-large");
      expect((err as DataSourceError).message).toMatch(/uncompressed size/);
    }
  });
});

describe("assertZipGate — boundary/adversarial (ZB-*)", () => {
  it("ZB-1: single entry, uncompressed size over the total-bytes cap → too-large", () => {
    const zip = buildZip([centralDirEntry({ compressedSize: 1, uncompressedSize: 10_000 })]);
    try {
      // Isolate the total-uncompressed-bytes check from the ratio check
      // (10000:1 would otherwise trip the default 200x ratio cap first).
      assertZipGate(zip, { maxTotalUncompressedBytes: 5_000, maxCompressionRatio: 1_000_000 });
      expect.fail("expected too-large");
    } catch (err) {
      expect(err).toBeInstanceOf(DataSourceError);
      expect((err as DataSourceError).kind).toBe("too-large");
      expect((err as DataSourceError).message).toMatch(/uncompressed size/);
    }
  });

  it("ZB-1 (ratio): high compression ratio over the ratio cap → too-large", () => {
    const zip = buildZip([centralDirEntry({ compressedSize: 1, uncompressedSize: 1000 })], {});
    try {
      assertZipGate(zip, { maxTotalUncompressedBytes: 10_000, maxCompressionRatio: 10 });
      expect.fail("expected too-large");
    } catch (err) {
      expect(err).toBeInstanceOf(DataSourceError);
      expect((err as DataSourceError).kind).toBe("too-large");
      expect((err as DataSourceError).message).toMatch(/compression ratio/);
    }
  });

  it("ZB-2: many-entry bomb — entry count over the cap → too-large", () => {
    const entries = Array.from({ length: 5 }, (_, i) => centralDirEntry({ name: `f${i}.xml` }));
    const zip = buildZip(entries);
    try {
      assertZipGate(zip, { maxEntries: 2 });
      expect.fail("expected too-large");
    } catch (err) {
      expect(err).toBeInstanceOf(DataSourceError);
      expect((err as DataSourceError).kind).toBe("too-large");
      expect((err as DataSourceError).message).toMatch(/entries/);
    }
  });

  it("ZB-4: Zip64 sentinel in EOCD (totalEntries=0xFFFF) → unsupported-format", () => {
    const zip = buildZip([centralDirEntry()], { totalEntries: 0xffff });
    expectRejects(zip, "unsupported-format", /Zip64/);
  });

  it("ZB-4: Zip64 EOCD locator present → unsupported-format", () => {
    const zip = buildZip([centralDirEntry()], { prependZip64Locator: true });
    expectRejects(zip, "unsupported-format", /Zip64/);
  });

  it("Phase 6-B: entry-level Zip64 sentinel (compressedSize=0xFFFFFFFF), distinct from the EOCD-level check → unsupported-format", () => {
    const zip = buildZip([centralDirEntry({ compressedSize: 0xffffffff })]);
    expectRejects(zip, "unsupported-format", /Zip64/);
  });

  it("Phase 6-B: entry-level Zip64 sentinel (uncompressedSize=0xFFFFFFFF) → unsupported-format", () => {
    const zip = buildZip([centralDirEntry({ uncompressedSize: 0xffffffff })]);
    expectRejects(zip, "unsupported-format", /Zip64/);
  });

  it("ZB-5: encrypted entry (general-purpose bit 0 set) → unsupported-format", () => {
    const zip = buildZip([centralDirEntry({ generalPurposeBitFlag: 0x1 })]);
    expectRejects(zip, "unsupported-format", /encrypted/);
  });

  it("ZB-6: unsupported compression method → unsupported-format", () => {
    const zip = buildZip([centralDirEntry({ compressionMethod: 99 })]);
    expectRejects(zip, "unsupported-format", /compression method/);
  });

  it("ZB-7: no EOCD record at all → corrupt", () => {
    const zip = buildZip([centralDirEntry()], { omitEocd: true });
    expectRejects(zip, "corrupt", /end-of-central-directory/);
  });

  it("ZB-7: EOCD central-directory offset lies (out of bounds) → corrupt", () => {
    const zip = buildZip([centralDirEntry()], { centralDirOffset: 9999 });
    expectRejects(zip, "corrupt");
  });

  it("ZB-8: duplicate entry names → corrupt", () => {
    const zip = buildZip([
      centralDirEntry({ name: "same.xml" }),
      centralDirEntry({ name: "same.xml" }),
    ]);
    expectRejects(zip, "corrupt", /duplicate/);
  });

  it("Codex R1 P1: centralDirSize inflated beyond what totalEntries actually spans → corrupt (parser-differential defense)", () => {
    const entries = [centralDirEntry({ name: "a.xml" })];
    const realSize = entries.flat().length;
    // A forged EOCD claims a larger central directory than `totalEntries`
    // (1) actually walks — simulating extra, unaccounted-for entries a more
    // lenient zip reader downstream could still decompress.
    const zip = buildZip(entries, { centralDirSize: realSize + 100 });
    expectRejects(zip, "corrupt", /do not add up/);
  });

  it("Codex R1 P1: centralDirSize understated relative to what totalEntries actually spans → corrupt", () => {
    const entries = [centralDirEntry({ name: "a.xml" }), centralDirEntry({ name: "b.xml" })];
    const realSize = entries.flat().length;
    const zip = buildZip(entries, { centralDirSize: realSize - 10 });
    expectRejects(zip, "corrupt", /do not add up/);
  });

  it("Codex R1 P1: a non-UTF-8 entry name is rejected rather than silently replacement-charactered", () => {
    const invalidUtf8Name = [0xff, 0xfe, 0x00, 0x01]; // not valid UTF-8
    const entry = centralDirEntry({ name: "placeholder" });
    // Overwrite the name bytes in place with an invalid UTF-8 sequence of
    // the same declared length so the entry's own nameLength field stays
    // consistent (avoids also tripping the bounds/size-consistency check).
    const nameOffset = 46;
    for (let i = 0; i < invalidUtf8Name.length; i++) entry[nameOffset + i] = invalidUtf8Name[i]!;
    const zip = buildZip([entry]);
    expectRejects(zip, "corrupt", /not valid UTF-8/);
  });

  it("accepts a well-formed multi-entry zip within all caps", () => {
    const entries = [
      centralDirEntry({ name: "a.xml", compressedSize: 100, uncompressedSize: 300 }),
      centralDirEntry({ name: "b.xml", compressedSize: 100, uncompressedSize: 300 }),
    ];
    const zip = buildZip(entries);
    expect(() => assertZipGate(zip)).not.toThrow();
  });

  it("Phase 6-B: nonzero extra/comment fields on an earlier entry don't misalign the offset walk to a later, otherwise-valid entry", () => {
    // Exercises `offset += entrySpan` (name + extra + comment) actually
    // advancing past the FULL declared span, not just nameLength — a
    // mutation dropping extraFieldLength/commentLength from that sum would
    // misread entry b's fixed-size fields from the wrong offset and either
    // throw or silently misparse, not silently succeed with the right values.
    const entries = [
      centralDirEntry({
        name: "a.xml",
        compressedSize: 50,
        uncompressedSize: 150,
        extraFieldLength: 12,
        commentLength: 8,
      }),
      centralDirEntry({ name: "b.xml", compressedSize: 100, uncompressedSize: 300 }),
    ];
    const zip = buildZip(entries);
    expect(() => assertZipGate(zip)).not.toThrow();
  });
});
