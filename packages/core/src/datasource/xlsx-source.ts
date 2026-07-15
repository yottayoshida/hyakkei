import ExcelJS from "exceljs";
import { assertByteCeiling } from "./byte-gate.js";
import { quoteIdentifier } from "./identifier.js";
import { describeTable, throwClassifiedFailure, withVirtualTextFile } from "./register-path.js";
import { assertContentShape } from "./sniff.js";
import {
  DataSourceError,
  type RegisterContext,
  type RegisteredTable,
  type SourceShape,
} from "./types.js";
import { assertZipGate } from "./zip-gate.js";

// XL-8: v0.1 has no header-row-detection heuristic (deferred M2, per the M0
// spike's own framing: "header-row detection is the app's job"). Row 1 is
// always treated as the header; a workbook with preamble rows above its
// real header registers that preamble as columns. Documented limitation,
// not an error.
const HEADER_ROW_NUMBER = 1;

type PrimitiveCellValue = string | number | boolean | null;

/**
 * ExcelJS's own browser bundle has no streaming reader (shape enumeration
 * §2b, verified: `WorkbookReader` absent from `dist/exceljs.min.js`) — the
 * only in-browser parse path is `xlsx.load()`, which fully materializes the
 * decompressed content in memory. `assertZipGate` (O-XGATE) must therefore
 * run on the raw bytes *before* this call, not during or after it — a
 * decompression bomb has already done its damage by the time `load()`
 * itself could throw.
 */
async function loadWorkbook(bytes: Uint8Array): Promise<ExcelJS.Workbook> {
  assertByteCeiling(bytes);
  assertContentShape(bytes, "xlsx");
  assertZipGate(bytes);
  const workbook = new ExcelJS.Workbook();
  try {
    // `.d.ts` declares `Buffer` only, but ExcelJS's actual runtime accepts a
    // raw `ArrayBuffer`/`Uint8Array` too — verified empirically (M0 spike,
    // `spikes/excel-fidelity/large-perf/src/main.mjs`) parsing a 50k-row
    // workbook in-browser, where no Node `Buffer` exists at all. The type
    // is Node-centric and incomplete for the browser build. Cast through
    // the load() parameter's own type (not the ambient `Buffer`) to dodge a
    // nominal mismatch between the workspace's `@types/node` and exceljs's.
    await workbook.xlsx.load(bytes as unknown as Parameters<typeof workbook.xlsx.load>[0]);
  } catch (cause) {
    throw new DataSourceError("corrupt", "the xlsx content could not be read", { cause });
  }
  return workbook;
}

/**
 * V-083: an unspecified sheet defaults to the first (or sole) sheet. An
 * explicit reference to a sheet name that does not exist is unreachable via
 * the real inspect→pick→register UI flow (the picker only ever offers names
 * `inspect()` itself returned) — shapes.md's "one shape with no clean union
 * leaf" calls this a caller-contract violation, not a `DataSourceError`
 * leaf, so it throws a plain `Error` rather than adding a new error kind.
 */
function pickWorksheet(
  workbook: ExcelJS.Workbook,
  sheetName: string | undefined,
): ExcelJS.Worksheet {
  if (sheetName === undefined) {
    const first = workbook.worksheets[0];
    if (!first) throw new DataSourceError("empty", "the workbook has no sheets");
    return first;
  }
  const sheet = workbook.getWorksheet(sheetName);
  if (!sheet) throw new Error(`xlsx-source: sheet "${sheetName}" does not exist in this workbook`);
  return sheet;
}

/**
 * XL-B3: two same-named header cells naively keyed into one row object
 * would silently lose a column (`obj[name] = ...` twice, last wins). This
 * is a separate gap from the null-proto mitigation below — dedup happens
 * before any row object is ever built, so every distinct column position
 * keeps its own key (`name`, `name_2`, `name_3`, ...).
 *
 * Tracks the full set of names already emitted, not just a per-original-name
 * counter — a per-name counter alone collides when a header already
 * contains a literal name matching what dedup would generate for a
 * different column (`["件数", "件数_2", "件数"]` would naively produce
 * `件数_2` twice: once as the real second header, once as the generated
 * suffix for the third `件数`). Round 1 Codex review, verified reproducible.
 */
export function dedupeHeaderNames(names: string[]): string[] {
  const used = new Set<string>();
  const seenCounts = new Map<string, number>();
  return names.map((name) => {
    let count = (seenCounts.get(name) ?? 0) + 1;
    let candidate = count === 1 ? name : `${name}_${count}`;
    while (used.has(candidate)) {
      count++;
      candidate = `${name}_${count}`;
    }
    seenCounts.set(name, count);
    used.add(candidate);
    return candidate;
  });
}

function readHeaderNames(worksheet: ExcelJS.Worksheet): string[] {
  const headerRow = worksheet.getRow(HEADER_ROW_NUMBER);
  const names: string[] = [];
  for (let col = 1; col <= worksheet.actualColumnCount; col++) {
    const primitive = cellPrimitive(headerRow.getCell(col).value);
    names.push(primitive === null || primitive === "" ? `column_${col}` : String(primitive));
  }
  return names;
}

/**
 * XL-B2: a formula's cached `result` is optional (verified `CellFormulaValue`
 * type) — no cache present emits `null`, never the raw `{formula}` wrapper.
 * A `result` that is itself a `CellErrorValue` (e.g. `#DIV/0!` inside a
 * formula) resolves through the same error-string branch as a direct error
 * cell.
 */
function resultPrimitive(
  result: number | string | boolean | Date | ExcelJS.CellErrorValue | undefined,
): PrimitiveCellValue {
  if (result === undefined) return null;
  if (result instanceof Date) return result.toISOString();
  if (typeof result === "object") return result.error;
  return result;
}

/**
 * XL-B5/XL-B6: extracts a JSON-safe primitive from ExcelJS's `CellValue`
 * union. Object-shaped cells (formula/rich-text/hyperlink/error) must never
 * be `JSON.stringify`'d as-is — that would turn the column into an opaque
 * JSON blob instead of the value a user actually wants to see.
 */
export function cellPrimitive(value: ExcelJS.CellValue): PrimitiveCellValue {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) return value.toISOString();
  if (typeof value !== "object") return value;
  if ("formula" in value || "sharedFormula" in value) return resultPrimitive(value.result);
  if ("richText" in value) return value.richText.map((run) => run.text).join("");
  if ("error" in value) return value.error;
  if ("hyperlink" in value) return value.text;
  return null;
}

/**
 * XL-B4 (ND-7, the prototype-pollution vector): xlsx column names are data,
 * not a closed identifier set — `__proto__`/`constructor`/`prototype` are
 * all legal header text. Building row objects via `Object.create(null)`
 * (never a plain `{}`) means a bracket assignment keyed by such a name can
 * never reach `Object.prototype`. `JSON.stringify` of a null-proto object
 * still emits `"__proto__": value` as an ordinary key — DuckDB downstream
 * receives it as a harmless quoted column name.
 */
function buildRows(
  worksheet: ExcelJS.Worksheet,
  headerNames: string[],
): Record<string, PrimitiveCellValue>[] {
  const rows: Record<string, PrimitiveCellValue>[] = [];
  worksheet.eachRow({ includeEmpty: true }, (row, rowNumber) => {
    if (rowNumber === HEADER_ROW_NUMBER) return;
    const record: Record<string, PrimitiveCellValue> = Object.create(null);
    for (let col = 1; col <= headerNames.length; col++) {
      record[headerNames[col - 1]!] = cellPrimitive(row.getCell(col).value);
    }
    rows.push(record);
  });
  return rows;
}

/**
 * XL-B7: hidden/veryHidden sheets are enumerated the same as visible ones —
 * a hidden sheet may hold the real data (or be intentional scratch space),
 * so this never silently drops one. `SourceShape.sheets` (A1's frozen
 * contract) is a plain `string[]` with no per-sheet metadata slot, so
 * hidden-state cannot be surfaced to the picker without reshaping that
 * type; out of this PR's scope.
 */
export async function inspectXlsx(bytes: Uint8Array): Promise<SourceShape> {
  const workbook = await loadWorkbook(bytes);
  if (workbook.worksheets.length === 0) {
    throw new DataSourceError("empty", "the workbook has no sheets");
  }
  return { kind: "sheets", sheets: workbook.worksheets.map((ws) => ws.name) };
}

export async function registerXlsx(
  ctx: RegisterContext,
  tableId: string,
  bytes: Uint8Array,
  sheetName: string | undefined,
): Promise<RegisteredTable> {
  const workbook = await loadWorkbook(bytes);
  const worksheet = pickWorksheet(workbook, sheetName);
  if (worksheet.actualRowCount === 0) {
    throw new DataSourceError("empty", "the sheet has no rows");
  }

  const headerNames = dedupeHeaderNames(readHeaderNames(worksheet));
  const rows = buildRows(worksheet, headerNames);
  const quotedId = quoteIdentifier(tableId);

  try {
    if (rows.length === 0) {
      // XL-B1: header-only sheet — no data rows for insertJSONFromPath to
      // infer a schema from. An explicit all-VARCHAR CREATE TABLE keeps this
      // a valid, non-error registration (symmetric with CS-6's header-only csv).
      const columnDefs = headerNames.map((name) => `${quoteIdentifier(name)} VARCHAR`).join(", ");
      await ctx.registrar.conn.query(`CREATE TABLE ${quotedId} (${columnDefs})`);
    } else {
      // `insertJSONFromPath`'s auto-inferred (`create: true`) schema does
      // NOT preserve the JSON objects' own key order — verified
      // empirically (Phase 5 e2e): DuckDB's JSON schema-unification
      // alphabetizes columns instead. Registering into a staging table
      // first, then re-projecting an explicit `SELECT <headerNames in
      // order>` into the real table, keeps DuckDB's own type inference
      // (numbers stay numbers) while fixing the column order a user
      // expects to match their spreadsheet.
      const jsonText = JSON.stringify(rows);
      // QA Phase 8 finding (Bug-fact): the staging TABLE already gets
      // dropped in a `finally` below, but the underlying virtual JSON FILE
      // it was built from did not — `withVirtualTextFile` closes that gap
      // (register-path.ts) the same way it does for csv/parquet.
      await withVirtualTextFile(ctx.registrar.db, jsonText, "json", async (virtualName) => {
        const stagingId = virtualName;
        const quotedStagingId = quoteIdentifier(stagingId);
        await ctx.registrar.conn.insertJSONFromPath(virtualName, { name: stagingId, create: true });
        // /simplify altitude pass: the staging table only exists once
        // `insertJSONFromPath` above has already succeeded, so the DROP
        // belongs in a `finally` scoped to just the reproject step — if
        // that step throws (bad column name, OOM), the staging table would
        // otherwise leak in the DuckDB catalog for the rest of the
        // connection's lifetime instead of being cleaned up before the
        // classified error propagates.
        try {
          const orderedSelect = headerNames.map((name) => quoteIdentifier(name)).join(", ");
          await ctx.registrar.conn.query(
            `CREATE TABLE ${quotedId} AS SELECT ${orderedSelect} FROM ${quotedStagingId}`,
          );
        } finally {
          await ctx.registrar.conn.query(`DROP TABLE ${quotedStagingId}`);
        }
      });
    }
  } catch (cause) {
    // ADV-5/V-091: any DuckDB-side failure here (malformed JSON DuckDB's
    // own reader still rejects, or genuine WASM heap exhaustion on a large
    // sheet) must surface as a catchable, typed error — never an unhandled
    // exception reaching the caller.
    throwClassifiedFailure(
      cause,
      "ran out of memory while registering the sheet",
      "the sheet content could not be registered",
    );
  }

  const { columns, rowCount } = await describeTable(ctx.registrar.conn, tableId);
  return { id: tableId, columns, rowCount };
}
