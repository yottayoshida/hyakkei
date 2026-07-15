import { readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "@playwright/test";

// /simplify simplification pass: `page.goto("/register-harness.html")` was
// the identical first line of every test below — nothing in this file's
// registration flow (createDuckDB() is lazy, only called from inside a
// harness function) depends on `page.on`/`page.route` being registered
// BEFORE navigation, so hoisting the goto here is safe even for the two
// tests that set up request interception of their own.
test.beforeEach(async ({ page }) => {
  await page.goto("/register-harness.html", { waitUntil: "domcontentloaded" });
});

// PR-A2 (issue #7): the real DuckDB-WASM round-trip layer this project's own
// D11 test strategy reserves for Playwright — "登録→SELECT round-tripの
// 最終段のみ" — everything upstream (sniff/byte-gate/encoding/zip-gate/
// ExcelJS row-build) already has fast, deterministic Vitest coverage
// (packages/core/src/datasource/*.test.ts). This spec drives
// register-harness.html (a headless, no-UI Vite entry — see that file's own
// comment) via `window.__hyakkeiHarness`, which is the same createDuckDB()
// factory + shared register path the real app will use.
const FIXTURES_DIR = join(import.meta.dirname, "..", "spikes", "excel-fidelity", "fixtures");
const loadFixtureBytes = (name: string): number[] =>
  Array.from(readFileSync(join(FIXTURES_DIR, name)));

// `e2e/**/*.ts` is a separate tsconfig project (tsconfig.tools.json) from
// packages/app, which owns the real `declare global` for
// `window.__hyakkeiHarness` (register-harness-main.ts) — no shared type
// import path exists between the two, so this is a deliberate, minimal
// duplicate for this spec's own type-checking, same reasoning as the CSP
// string's intentional duplication across index.html/golden.html/serve.json.
declare global {
  interface Window {
    __hyakkeiHarness: {
      registerFile(spec: unknown, bytes: number[], sheet?: string): Promise<HarnessResult>;
      registerUrl(spec: unknown): Promise<HarnessResult>;
      query(sql: string): Promise<Record<string, unknown>[]>;
      makeParquetBytes(sql: string): Promise<number[]>;
    };
  }
}

interface HarnessResult {
  ok: boolean;
  shape?: unknown;
  table?: { id: string; columns: { name: string; type: string }[]; rowCount: number };
  kind?: string;
  reason?: string;
  message?: string;
}

function expectRegistered(
  result: HarnessResult,
): asserts result is HarnessResult & { table: NonNullable<HarnessResult["table"]> } {
  expect(result.ok, JSON.stringify(result)).toBe(true);
  expect(result.table, JSON.stringify(result)).toBeDefined();
}

test.describe("PR-A2 real DuckDB-WASM round-trip (register-harness.html)", () => {
  test("csv: Shift_JIS FileSource decodes correctly end-to-end (no mojibake)", async ({ page }) => {
    const result = await page.evaluate(
      ({ spec, bytes }) => window.__hyakkeiHarness.registerFile(spec, bytes),
      {
        spec: { id: "t_sjis", kind: "file", format: "csv", ref: { name: "06-shift_jis.csv" } },
        bytes: loadFixtureBytes("06-shift_jis.csv"),
      },
    );
    expectRegistered(result);
    expect(result.table.rowCount).toBe(2);
    expect(result.table.columns.map((c: { name: string }) => c.name)).toEqual([
      "部署",
      "担当者",
      "件数",
    ]);

    const rows = await page.evaluate(
      (sql) => window.__hyakkeiHarness.query(sql),
      `SELECT * FROM "t_sjis" ORDER BY 部署`,
    );
    expect(rows).toEqual([
      { 部署: "住民課", 担当者: "田中太郎", 件数: 45 },
      { 部署: "税務課", 担当者: "鈴木花子", 件数: 30 },
    ]);
  });

  // QA Phase 8 finding (Minor m-1): fixtures 15/16 were generated and
  // committed for EN-9/EN-10 but never round-tripped through the real
  // register path anywhere — only encoding.test.ts's hand-built byte
  // arrays exercised the BOM-detection logic in isolation.
  for (const [fixture, tableId] of [
    ["15-utf16le-bom.csv", "t_utf16le"],
    ["16-utf16be-bom.csv", "t_utf16be"],
  ] as const) {
    test(`csv: UTF-16 BOM (${fixture}) decodes and round-trips end-to-end (EN-9/EN-10)`, async ({
      page,
    }) => {
      const result = await page.evaluate(
        ({ spec, bytes }) => window.__hyakkeiHarness.registerFile(spec, bytes),
        {
          spec: { id: tableId, kind: "file", format: "csv", ref: { name: fixture } },
          bytes: loadFixtureBytes(fixture),
        },
      );
      expectRegistered(result);
      expect(result.table.rowCount).toBe(2);
      expect(result.table.columns.map((c: { name: string }) => c.name)).toEqual(["id", "name"]);

      const rows = await page.evaluate(
        (sql) => window.__hyakkeiHarness.query(sql),
        `SELECT * FROM "${tableId}" ORDER BY id`,
      );
      expect(rows).toEqual([
        { id: 1, name: "サンプル" },
        { id: 2, name: "テスト" },
      ]);
    });
  }

  // QA Phase 8 finding (Minor m-2): fixture 17 was committed for CS-B3 but
  // no test anywhere exercised it against the real DuckDB register path.
  // Doing so here overturned the ORIGINAL assumption (documented in
  // csv-source.ts's prior comment, now corrected): `read_csv_auto` does
  // NOT throw on a ragged row, even with `ignore_errors=false`/
  // `null_padding=false` passed explicitly — its auto-detection sniffer
  // silently drops rows that don't fit its own detected column count
  // before those flags would ever apply. This test pins the VERIFIED
  // real (imperfect) behavior — a single surviving row, generic column
  // names, silent data loss — specifically so a future regression to
  // something worse (an unhandled exception reaching the caller) is
  // still caught. See csv-source.ts's `registerCsv` doc comment for the
  // full finding and the tracked follow-up (a two-step
  // detect-schema-then-strict-reread redesign).
  test("csv: a ragged row (fewer/more columns than the header) registers without throwing, but silently loses rows (CS-B3, known gap)", async ({
    page,
  }) => {
    const result = await page.evaluate(
      ({ spec, bytes }) => window.__hyakkeiHarness.registerFile(spec, bytes),
      {
        spec: { id: "t_ragged", kind: "file", format: "csv", ref: { name: "17-ragged.csv" } },
        bytes: loadFixtureBytes("17-ragged.csv"),
      },
    );
    expectRegistered(result);
    // Verified real behavior: only the widest (4-field) row survives, under
    // auto-generated column names — 2 of the file's 3 data rows are
    // silently dropped. This assertion exists to catch a regression to
    // something WORSE (an unhandled exception), not to bless this outcome
    // as correct — see the tracked follow-up referenced above.
    expect(result.table.rowCount).toBe(1);
  });

  test("xlsx: duplicate header names dedupe without losing a column (XL-B3)", async ({ page }) => {
    const result = await page.evaluate(
      ({ spec, bytes }) => window.__hyakkeiHarness.registerFile(spec, bytes),
      {
        spec: {
          id: "t_dup",
          kind: "file",
          format: "xlsx",
          ref: { name: "13-duplicate-headers.xlsx" },
        },
        bytes: loadFixtureBytes("13-duplicate-headers.xlsx"),
      },
    );
    expectRegistered(result);
    expect(result.table.columns.map((c: { name: string }) => c.name)).toEqual([
      "地域",
      "件数",
      "件数_2",
    ]);

    const rows = await page.evaluate(
      (sql) => window.__hyakkeiHarness.query(sql),
      `SELECT * FROM "t_dup" ORDER BY 地域`,
    );
    expect(rows).toEqual([
      { 地域: "大阪府", 件数: 95, 件数_2: 210 },
      { 地域: "東京都", 件数: 120, 件数_2: 340 },
    ]);
  });

  test("xlsx: a column literally named __proto__ registers without polluting Object.prototype (XL-B4/ADV-1)", async ({
    page,
  }) => {
    const before = await page.evaluate(() => Object.getOwnPropertyNames(Object.prototype));

    const result = await page.evaluate(
      ({ spec, bytes }) => window.__hyakkeiHarness.registerFile(spec, bytes),
      {
        spec: {
          id: "t_proto",
          kind: "file",
          format: "xlsx",
          ref: { name: "18-proto-column.xlsx" },
        },
        bytes: loadFixtureBytes("18-proto-column.xlsx"),
      },
    );
    expectRegistered(result);
    expect(result.table.columns.map((c: { name: string }) => c.name)).toEqual([
      "id",
      "__proto__",
      "constructor",
    ]);

    const after = await page.evaluate(() => Object.getOwnPropertyNames(Object.prototype));
    expect(after, "Object.prototype gained an own property during registration").toEqual(before);

    // Data-loss check, not just non-pollution: a naive plain-`{}` row build
    // would silently drop the `__proto__` column's value (the exotic
    // accessor no-ops on a non-object assignment) rather than pollute
    // anything for THIS fixture's string values — round-tripping the real
    // value is the actual regression this test guards.
    //
    // Codex R1 P1 follow-up (found while re-verifying the fix): comparing
    // an object literal `{ __proto__: "polluted?", ... }` against the
    // query result would not actually verify a genuine own "__proto__"
    // property (the literal's `__proto__:` key hits the exotic
    // [[Prototype]] setter, not CreateDataProperty). Worse, verified
    // empirically: Playwright's own `page.evaluate()` return-value
    // serialization ALSO drops a "__proto__"-named own property crossing
    // the browser→Node boundary — even a bare `Object.fromEntries([["__
    // proto__","x"]])` returned from evaluate() loses it in Node,
    // regardless of how correctly the row was built in the browser. This
    // is a Playwright tooling limitation, not an application bug — so the
    // assertion must run entirely INSIDE the page, returning only a
    // "__proto__"-free summary object across the boundary.
    const check = await page.evaluate(async () => {
      const rows = await window.__hyakkeiHarness.query('SELECT * FROM "t_proto"');
      const row = rows[0] as Record<string, unknown>;
      return {
        rowCount: rows.length,
        hasOwnProtoKey: Object.hasOwn(row, "__proto__"),
        protoValue: row["__proto__"],
        id: row.id,
        constructorValue: row.constructor,
      };
    });
    expect(check.rowCount).toBe(1);
    expect(check.hasOwnProtoKey, "row is missing an own __proto__ property").toBe(true);
    expect(check.protoValue).toBe("polluted?");
    expect(check.id).toBe(1);
    expect(check.constructorValue).toBe("also polluted?");
  });

  test("xlsx: a header-only sheet (XL-B1) registers as a valid, non-error table with rowCount:0", async ({
    page,
  }) => {
    // Codex R1 P1: previously zero execution coverage anywhere — the
    // explicit all-VARCHAR CREATE TABLE branch in registerXlsx (taken when
    // there are no data rows) was only reachable through this fixture, and
    // no test (Vitest or e2e) had ever exercised it.
    const result = await page.evaluate(
      ({ spec, bytes }) => window.__hyakkeiHarness.registerFile(spec, bytes),
      {
        spec: { id: "t_empty", kind: "file", format: "xlsx", ref: { name: "11-empty-sheet.xlsx" } },
        bytes: loadFixtureBytes("11-empty-sheet.xlsx"),
      },
    );
    expectRegistered(result);
    expect(result.table.rowCount).toBe(0);
    expect(result.table.columns.map((c: { name: string }) => c.name)).toEqual(["区分", "件数"]);

    const rows = await page.evaluate(
      (sql) => window.__hyakkeiHarness.query(sql),
      `SELECT * FROM "t_empty"`,
    );
    expect(rows).toEqual([]);
  });

  test("parquet: a well-formed file (generated via DuckDB's own COPY TO) round-trips through the self-hosted extension, and never reaches extensions.duckdb.org (ADV-8)", async ({
    page,
    baseURL,
    browserName,
  }) => {
    const selfOrigin = new URL(baseURL!).origin;
    const nonSelfRequests: string[] = [];
    const extensionRequests: string[] = [];
    page.on("request", (req) => {
      const url = new URL(req.url());
      if (url.origin !== selfOrigin) nonSelfRequests.push(req.url());
      if (/\/vendor\/extensions\/.*parquet\.duckdb_extension\.wasm$/.test(url.pathname)) {
        extensionRequests.push(req.url());
      }
    });

    const parquetBytes = await page.evaluate(
      (sql) => window.__hyakkeiHarness.makeParquetBytes(sql),
      `SELECT * FROM (VALUES (1, '東京都', 3400000.5), (2, '大阪府', 2100000.0)) AS t(id, prefecture, amount)`,
    );
    const result = await page.evaluate(
      ({ spec, bytes }) => window.__hyakkeiHarness.registerFile(spec, bytes),
      {
        spec: { id: "t_pq", kind: "file", format: "parquet", ref: { name: "gen.parquet" } },
        bytes: parquetBytes,
      },
    );
    expectRegistered(result);
    expect(result.table.rowCount).toBe(2);
    expect(result.table.columns.map((c: { name: string }) => c.name)).toEqual([
      "id",
      "prefecture",
      "amount",
    ]);

    expect(
      nonSelfRequests,
      `parquet registration must never request a non-self origin: ${nonSelfRequests.join(", ")}`,
    ).toEqual([]);

    // Phase 6-B: without this, the test above only proves "nothing bad
    // happened" — it can't distinguish "the self-hosted repository
    // redirect actually fired" from "DuckDB never needed the extension at
    // all" (e.g. if a future duckdb-wasm version bundled parquet support
    // directly). Asserting the vendored URL was actually requested proves
    // the `custom_extension_repository` redirect (factory.ts) is the real
    // mechanism parquet support goes through, not an accident of this
    // particular file being small enough to not need it.
    //
    // Skipped on firefox only: verified empirically that Playwright's
    // `page.on('request')` under firefox captures the DuckDB Worker's own
    // script/wasm requests but not a *further* fetch issued from inside
    // that Worker (the extension load) — a Playwright/firefox request-
    // capture gap for worker-internal fetches, not a product difference
    // (registration itself, asserted above, succeeds identically on all 3
    // engines; the `nonSelfRequests` security check above also still runs
    // on firefox — only this positive, additional-evidence assertion is
    // engine-limited).
    if (browserName !== "firefox") {
      expect(
        extensionRequests.length,
        "expected a request for the self-hosted parquet.duckdb_extension.wasm (custom_extension_repository redirect)",
      ).toBeGreaterThan(0);
    }
  });

  test("url: UrlSource (fetch DI) reaches the same shared register path as FileSource (V-094 mirror seam)", async ({
    page,
  }) => {
    const result = await page.evaluate((spec) => window.__hyakkeiHarness.registerUrl(spec), {
      id: "t_url",
      kind: "url",
      format: "csv",
      ref: { url: "/test-fixtures/sample.csv" },
    });
    expectRegistered(result);
    expect(result.table.rowCount).toBe(2);
    expect(result.table.columns.map((c: { name: string }) => c.name)).toEqual([
      "id",
      "name",
      "amount",
    ]);

    const rows = await page.evaluate(
      (sql) => window.__hyakkeiHarness.query(sql),
      `SELECT * FROM "t_url" ORDER BY id`,
    );
    expect(rows).toEqual([
      { id: 1, name: "サンプル", amount: 1000 },
      { id: 2, name: "テスト", amount: 2000 },
    ]);
  });

  test("WASM init failure (worker script blocked) surfaces as a catchable Error, not a hang (factory.ts's withTimeout)", async ({
    page,
  }) => {
    test.setTimeout(40_000);
    await page.route("**/vendor/duckdb-browser-*.worker.js", (route) =>
      route.fulfill({ status: 404, body: "not found" }),
    );

    const result = await page.evaluate(
      ({ spec, bytes }) => window.__hyakkeiHarness.registerFile(spec, bytes),
      {
        spec: { id: "t_fail", kind: "file", format: "csv", ref: { name: "x.csv" } },
        bytes: Array.from(Buffer.from("a,b\n1,2\n")),
      },
    );
    expect(result.ok).toBe(false);
    expect(result.message).toMatch(/timed out/i);
  });
});
