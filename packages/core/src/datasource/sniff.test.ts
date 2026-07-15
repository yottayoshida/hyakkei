import { describe, expect, it } from "vitest";
import { assertContentShape } from "./sniff.js";
import { DataSourceError } from "./types.js";

function bytesOf(text: string): Uint8Array {
  return new TextEncoder().encode(text);
}

describe("assertContentShape — csv", () => {
  it("CS-1: accepts plain CSV text", () => {
    expect(() => assertContentShape(bytesOf("a,b\n1,2\n"), "csv")).not.toThrow();
  });

  it("ADV-3/EN-8/V-090: rejects an HTML response declared as csv", () => {
    expect(() => assertContentShape(bytesOf("<!doctype html><html></html>"), "csv")).toThrow(
      DataSourceError,
    );
    try {
      assertContentShape(bytesOf("<html><body>login</body></html>"), "csv");
      throw new Error("expected throw");
    } catch (e) {
      expect(e).toBeInstanceOf(DataSourceError);
      expect((e as DataSourceError).kind).toBe("non-csv-response");
    }
  });

  it("tolerates a UTF-8 BOM and leading whitespace before the HTML check", () => {
    const withBom = new Uint8Array([0xef, 0xbb, 0xbf, ...bytesOf("  <html>")]);
    expect(() => assertContentShape(withBom, "csv")).toThrow(DataSourceError);
  });

  it("CS-9: does not reject non-HTML binary-ish content (no positive csv magic to check; read_csv_auto decides)", () => {
    expect(() => assertContentShape(new Uint8Array([1, 2, 3, 4]), "csv")).not.toThrow();
  });
});

describe("assertContentShape — parquet", () => {
  it("PQ-1: accepts content starting with the PAR1 magic", () => {
    expect(() => assertContentShape(bytesOf("PAR1restofafile"), "parquet")).not.toThrow();
  });

  it("PQ-B4/ADV-2: rejects content without the PAR1 magic (extension-spoofed)", () => {
    try {
      assertContentShape(bytesOf("not a parquet file"), "parquet");
      throw new Error("expected throw");
    } catch (e) {
      expect(e).toBeInstanceOf(DataSourceError);
      expect((e as DataSourceError).kind).toBe("unsupported-format");
    }
  });
});

describe("assertContentShape — xlsx", () => {
  it("XL-1: accepts content starting with the zip local-file-header magic", () => {
    const bytes = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0, 0, 0, 0]);
    expect(() => assertContentShape(bytes, "xlsx")).not.toThrow();
  });

  it("ADV-2: rejects content without the zip magic (extension-spoofed)", () => {
    try {
      assertContentShape(bytesOf("not a zip file"), "xlsx");
      throw new Error("expected throw");
    } catch (e) {
      expect(e).toBeInstanceOf(DataSourceError);
      expect((e as DataSourceError).kind).toBe("unsupported-format");
    }
  });
});
