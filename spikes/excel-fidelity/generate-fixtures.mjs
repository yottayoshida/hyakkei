import ExcelJS from "exceljs";
import iconv from "iconv-lite";
import { writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT = (name) => join(__dirname, "fixtures", name);

// 1. Two-row merged header: "売上" spans B1:C1, sub-headers in row 2, data from row 3.
async function fixture01() {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Sheet1");
  ws.mergeCells("B1:C1");
  ws.getCell("A1").value = "地域";
  ws.getCell("B1").value = "売上";
  ws.getCell("A2").value = "";
  ws.getCell("B2").value = "件数";
  ws.getCell("C2").value = "金額";
  ws.addRow(["東京都", 120, 3400000]);
  ws.addRow(["大阪府", 95, 2100000]);
  await wb.xlsx.writeFile(OUT("01-merged-header-2row.xlsx"));
}

// 2. Japanese era (和暦) dates stored as plain text, not native Excel dates.
async function fixture02() {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Sheet1");
  ws.addRow(["日付", "件数"]);
  ws.addRow(["令和6年4月1日", 12]);
  ws.addRow(["令和6年12月31日", 8]);
  ws.addRow(["平成31年4月1日", 5]);
  await wb.xlsx.writeFile(OUT("02-wareki-dates.xlsx"));
}

// 3. Full-width (全角) digits stored as text instead of half-width numbers.
async function fixture03() {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Sheet1");
  ws.addRow(["項目", "数量"]);
  ws.addRow(["申請件数", "１２３４"]);
  ws.addRow(["受理件数", "５６７"]);
  await wb.xlsx.writeFile(OUT("03-fullwidth-digits.xlsx"));
}

// 4. Header not in row 1 — 3 rows of title/notes preamble before the real header.
async function fixture04() {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Sheet1");
  ws.addRow(["令和6年度 住民登録状況（速報値）"]);
  ws.addRow(["作成日: 2026年4月1日"]);
  ws.addRow([]);
  ws.addRow(["区分", "件数", "備考"]);
  ws.addRow(["転入", 340, ""]);
  ws.addRow(["転出", 290, ""]);
  await wb.xlsx.writeFile(OUT("04-header-not-row1.xlsx"));
}

// 5. Multiple sheets with the same shape (本庁 / 支所A / 支所B).
async function fixture05() {
  const wb = new ExcelJS.Workbook();
  for (const name of ["本庁", "支所A", "支所B"]) {
    const ws = wb.addWorksheet(name);
    ws.addRow(["区分", "件数"]);
    ws.addRow(["証明書発行", Math.floor(Math.random() * 200)]);
    ws.addRow(["相談受付", Math.floor(Math.random() * 100)]);
  }
  await wb.xlsx.writeFile(OUT("05-multi-sheet.xlsx"));
}

// 6. Shift_JIS-encoded CSV, no BOM (common from older government systems).
function fixture06() {
  const text = "部署,担当者,件数\n住民課,田中太郎,45\n税務課,鈴木花子,30\n";
  writeFileSync(OUT("06-shift_jis.csv"), iconv.encode(text, "Shift_JIS"));
}

// 7. UTF-8 CSV with a BOM prefix ("CSV UTF-8" export from Excel).
function fixture07() {
  const text = "﻿id,name,amount\n1,サンプル,1000\n2,テスト,2000\n";
  writeFileSync(OUT("07-utf8-bom.csv"), Buffer.from(text, "utf-8"));
}

// 8. Vertically merged first column (hierarchical government report style).
async function fixture08() {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Sheet1");
  ws.addRow(["都道府県", "市区町村", "件数"]);
  ws.addRow(["東京都", "千代田区", 12]);
  ws.addRow(["東京都", "中央区", 8]);
  ws.addRow(["東京都", "港区", 15]);
  ws.mergeCells("A2:A4");
  ws.addRow(["大阪府", "北区", 9]);
  ws.addRow(["大阪府", "中央区", 11]);
  ws.mergeCells("A5:A6");
  await wb.xlsx.writeFile(OUT("08-merged-cells-vertical.xlsx"));
}

// 9. Mixed types in one column: text-formatted "1,234" alongside real numbers.
async function fixture09() {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Sheet1");
  ws.addRow(["項目", "金額"]);
  ws.addRow(["A", 1234]);
  ws.getCell("B3").value = "1,234"; // text-formatted, comma included
  ws.getCell("A3").value = "B";
  ws.addRow(["C", 5678]);
  await wb.xlsx.writeFile(OUT("09-mixed-types-column.xlsx"));
}

// 10. Formula cells — does ExcelJS return the cached computed value?
async function fixture10() {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Sheet1");
  ws.addRow(["項目", "件数"]);
  ws.addRow(["4月", 100]);
  ws.addRow(["5月", 150]);
  const totalRow = ws.addRow(["合計", null]);
  totalRow.getCell(2).value = { formula: "SUM(B2:B3)", result: 250 };
  await wb.xlsx.writeFile(OUT("10-formula-cells.xlsx"));
}

// 11. Empty sheet: header row present, zero data rows (PR-A2 XL-B1 — a
// valid registration with rowCount:0, not an error, symmetric with CS-6).
async function fixture11() {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Sheet1");
  ws.addRow(["区分", "件数"]);
  await wb.xlsx.writeFile(OUT("11-empty-sheet.xlsx"));
}

// 12. Formula cell with NO cached result (PR-A2 XL-B2 — `CellFormulaValue
// .result` is optional; ExcelJS's own type confirms a formula-only cell is
// real, e.g. a workbook saved by a tool that doesn't cache computed values).
async function fixture12() {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Sheet1");
  ws.addRow(["項目", "件数"]);
  ws.addRow(["4月", 100]);
  ws.addRow(["5月", 150]);
  const totalRow = ws.addRow(["合計", null]);
  totalRow.getCell(2).value = { formula: "SUM(B2:B3)" }; // no `result` field
  await wb.xlsx.writeFile(OUT("12-formula-no-cache.xlsx"));
}

// 13. Duplicate header names (PR-A2 XL-B3 — naive object-key row-building
// would silently drop the first "件数" column; register() must dedupe).
async function fixture13() {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Sheet1");
  ws.addRow(["地域", "件数", "件数"]);
  ws.addRow(["東京都", 120, 340]);
  ws.addRow(["大阪府", 95, 210]);
  await wb.xlsx.writeFile(OUT("13-duplicate-headers.xlsx"));
}

// 14. A hidden sheet alongside a visible one (PR-A2 XL-B7 — inspect() must
// enumerate both, never silently drop the hidden one).
async function fixture14() {
  const wb = new ExcelJS.Workbook();
  const visible = wb.addWorksheet("公開シート");
  visible.addRow(["区分", "件数"]);
  visible.addRow(["転入", 340]);
  const hidden = wb.addWorksheet("下書き", { state: "hidden" });
  hidden.addRow(["メモ", "値"]);
  hidden.addRow(["作業中", 1]);
  await wb.xlsx.writeFile(OUT("14-hidden-sheet.xlsx"));
}

// 15/16. UTF-16LE / UTF-16BE BOM csv (PR-A2 EN-9/EN-10 — must be caught at
// the BOM-detection stage; falling through to the UTF-8-fatal→SJIS fallback
// silently mojibakes it, verified empirically in shape enumeration).
function fixture15() {
  const text = "id,name\n1,サンプル\n2,テスト\n";
  const utf16le = Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(text, "utf-16le")]);
  writeFileSync(OUT("15-utf16le-bom.csv"), utf16le);
}

function fixture16() {
  const text = "id,name\n1,サンプル\n2,テスト\n";
  const le = Buffer.from(text, "utf-16le");
  const be = Buffer.alloc(le.length);
  for (let i = 0; i < le.length; i += 2) {
    be[i] = le[i + 1];
    be[i + 1] = le[i];
  }
  writeFileSync(OUT("16-utf16be-bom.csv"), Buffer.concat([Buffer.from([0xfe, 0xff]), be]));
}

// 17. Ragged csv — a data row with fewer columns than the header (PR-A2
// CS-B3 — DuckDB's `read_csv_auto` default (`ignore_errors=false`,
// `null_padding=false`) errors on this, mapped to `corrupt`).
function fixture17() {
  const text = "id,name,amount\n1,サンプル,1000\n2,テスト\n3,テスト2,2000,余分\n";
  writeFileSync(OUT("17-ragged.csv"), Buffer.from(text, "utf-8"));
}

// 18. Column header literally named `__proto__` (PR-A2 XL-B4/ADV-1 — the
// prototype-pollution vector; row-object construction must use
// `Object.create(null)`, never a plain `{}`). Committed as a real xlsx so
// the Playwright e2e round-trip proves this end-to-end through the actual
// DuckDB `CREATE TABLE`, not just the pure `cellPrimitive`/dedupe unit tests.
async function fixture18() {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Sheet1");
  ws.addRow(["id", "__proto__", "constructor"]);
  ws.addRow([1, "polluted?", "also polluted?"]);
  await wb.xlsx.writeFile(OUT("18-proto-column.xlsx"));
}

async function main() {
  await fixture01();
  await fixture02();
  await fixture03();
  await fixture04();
  await fixture05();
  fixture06();
  fixture07();
  await fixture08();
  await fixture09();
  await fixture10();
  await fixture11();
  await fixture12();
  await fixture13();
  await fixture14();
  fixture15();
  fixture16();
  fixture17();
  await fixture18();
  console.log("18 fixtures written to spikes/excel-fidelity/fixtures/");
}

main();
