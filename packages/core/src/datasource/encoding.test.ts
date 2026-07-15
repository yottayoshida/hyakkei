import { describe, expect, it } from "vitest";
import { decodeCsvText } from "./encoding.js";

function utf8Bytes(text: string): Uint8Array {
  return new TextEncoder().encode(text);
}

describe("decodeCsvText", () => {
  it("EN-1: decodes UTF-8 without a BOM", () => {
    expect(decodeCsvText(utf8Bytes("id,name\n1,田中\n"))).toBe("id,name\n1,田中\n");
  });

  it("EN-2/RS-2: strips a UTF-8 BOM (does not leak into the first column name)", () => {
    const withBom = new Uint8Array([0xef, 0xbb, 0xbf, ...utf8Bytes("id,name\n")]);
    const decoded = decodeCsvText(withBom);
    expect(decoded).toBe("id,name\n");
    expect(decoded.charCodeAt(0)).toBe("i".charCodeAt(0)); // not U+FEFF
  });

  it("EN-3/RS-1: falls back to Shift_JIS when UTF-8-fatal decoding throws (real fixture bytes for '部署,')", () => {
    const sjisBytes = new Uint8Array([0x95, 0x94, 0x8f, 0x90, 0x2c]);
    expect(decodeCsvText(sjisBytes)).toBe("部署,");
  });

  it("EN-9: UTF-16LE BOM is caught before the UTF-8-fatal probe (would otherwise mojibake via the SJIS fallback)", () => {
    const utf16le = new Uint8Array([0xff, 0xfe, 0x69, 0x00, 0x64, 0x00]); // BOM + "id" as UTF-16LE
    expect(decodeCsvText(utf16le)).toBe("id");
  });

  it("EN-10: UTF-16BE BOM is caught before the UTF-8-fatal probe", () => {
    const utf16be = new Uint8Array([0xfe, 0xff, 0x00, 0x69, 0x00, 0x64]); // BOM + "id" as UTF-16BE
    expect(decodeCsvText(utf16be)).toBe("id");
  });

  it("EN-5/EN-6: does not throw on empty or header-only content (emptiness is the caller's concern, not decode's)", () => {
    expect(decodeCsvText(new Uint8Array(0))).toBe("");
    expect(decodeCsvText(utf8Bytes("id,name\n"))).toBe("id,name\n");
  });
});
