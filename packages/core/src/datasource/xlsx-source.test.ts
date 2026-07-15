import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { CellValue } from "exceljs";
import { describe, expect, it } from "vitest";
import { cellPrimitive, dedupeHeaderNames, inspectXlsx } from "./xlsx-source.js";

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
const load = (name: string) => new Uint8Array(readFileSync(join(FIXTURES_DIR, name)));

describe("dedupeHeaderNames (XL-B3)", () => {
  it("leaves unique names untouched", () => {
    expect(dedupeHeaderNames(["id", "name", "amount"])).toEqual(["id", "name", "amount"]);
  });

  it("suffixes repeated names so every column keeps a distinct key", () => {
    expect(dedupeHeaderNames(["件数", "件数", "件数"])).toEqual(["件数", "件数_2", "件数_3"]);
  });

  it("dedupes independently per distinct name", () => {
    expect(dedupeHeaderNames(["a", "b", "a", "b", "a"])).toEqual(["a", "b", "a_2", "b_2", "a_3"]);
  });

  it("Codex R1 P0: a real header that literally equals a would-be-generated suffix does not collide", () => {
    // A naive per-name counter maps the 3rd "件数" to "件数_2", colliding
    // with the real, distinct 2nd header — silently losing one column.
    expect(dedupeHeaderNames(["件数", "件数_2", "件数"])).toEqual(["件数", "件数_2", "件数_3"]);
  });

  it("keeps resolving forward through a chain of pre-existing suffixed collisions", () => {
    expect(dedupeHeaderNames(["x", "x_2", "x_3", "x"])).toEqual(["x", "x_2", "x_3", "x_4"]);
  });
});

describe("cellPrimitive (XL-B5/XL-B6)", () => {
  it("passes through primitives unchanged", () => {
    expect(cellPrimitive(42)).toBe(42);
    expect(cellPrimitive("text")).toBe("text");
    expect(cellPrimitive(true)).toBe(true);
  });

  it("maps null/undefined to null", () => {
    expect(cellPrimitive(null)).toBeNull();
    expect(cellPrimitive(undefined)).toBeNull();
  });

  it("converts a Date cell to an ISO string", () => {
    const date = new Date("2026-04-01T00:00:00.000Z");
    expect(cellPrimitive(date)).toBe(date.toISOString());
  });

  it("extracts a formula's cached result, not the {formula} wrapper", () => {
    const value = { formula: "SUM(B2:B3)", result: 250 } as unknown as CellValue;
    expect(cellPrimitive(value)).toBe(250);
  });

  it("XL-B2: a formula with no cached result becomes null, not the wrapper object", () => {
    const value = { formula: "SUM(B2:B3)" } as unknown as CellValue;
    expect(cellPrimitive(value)).toBeNull();
  });

  it("resolves a formula whose cached result is itself an error", () => {
    const value = { formula: "1/0", result: { error: "#DIV/0!" } } as unknown as CellValue;
    expect(cellPrimitive(value)).toBe("#DIV/0!");
  });

  it("Phase 6-B: resolves a SHARED formula (not just a plain formula) whose cached result is itself an error", () => {
    const value = { sharedFormula: "1/0", result: { error: "#DIV/0!" } } as unknown as CellValue;
    expect(cellPrimitive(value)).toBe("#DIV/0!");
  });

  it("Phase 6-B: a formula's cached result that is itself a Date resolves through resultPrimitive's own Date branch", () => {
    const date = new Date("2026-04-01T00:00:00.000Z");
    const value = { formula: "TODAY()", result: date } as unknown as CellValue;
    expect(cellPrimitive(value)).toBe(date.toISOString());
  });

  it("extracts joined text from a rich-text cell", () => {
    const value = { richText: [{ text: "hello " }, { text: "world" }] } as unknown as CellValue;
    expect(cellPrimitive(value)).toBe("hello world");
  });

  it("extracts the display text from a hyperlink cell, not the URL", () => {
    const value = { text: "公式サイト", hyperlink: "https://example.jp" } as unknown as CellValue;
    expect(cellPrimitive(value)).toBe("公式サイト");
  });

  it("extracts the error string from an error cell", () => {
    const value = { error: "#REF!" } as unknown as CellValue;
    expect(cellPrimitive(value)).toBe("#REF!");
  });

  it("never returns a JSON-blob-shaped string for any object cell", () => {
    const cases: CellValue[] = [
      { formula: "SUM(B2:B3)", result: 250 } as unknown as CellValue,
      { richText: [{ text: "x" }] } as unknown as CellValue,
      { text: "y", hyperlink: "https://example.jp" } as unknown as CellValue,
      { error: "#N/A" } as unknown as CellValue,
    ];
    for (const value of cases) {
      const primitive = cellPrimitive(value);
      expect(typeof primitive === "object").toBe(false);
    }
  });
});

describe("inspectXlsx (XL-4/XL-B7, DuckDB-free)", () => {
  it("XL-1: a single-sheet workbook returns one sheet name", async () => {
    const shape = await inspectXlsx(load("01-merged-header-2row.xlsx"));
    expect(shape).toEqual({ kind: "sheets", sheets: ["Sheet1"] });
  });

  it("XL-4: a multi-sheet workbook enumerates every sheet by name", async () => {
    const shape = await inspectXlsx(load("05-multi-sheet.xlsx"));
    expect(shape).toEqual({ kind: "sheets", sheets: ["本庁", "支所A", "支所B"] });
  });

  it("XL-B7: a hidden sheet is enumerated alongside the visible one, not dropped", async () => {
    const shape = await inspectXlsx(load("14-hidden-sheet.xlsx"));
    expect(shape).toEqual({ kind: "sheets", sheets: ["公開シート", "下書き"] });
  });

  it("ADV-2: extension-spoofed bytes (declared xlsx, actually csv) are rejected before any parse", async () => {
    const csvBytes = load("07-utf8-bom.csv");
    await expect(inspectXlsx(csvBytes)).rejects.toMatchObject({ kind: "unsupported-format" });
  });
});
