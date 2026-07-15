import { join } from "node:path";
import { expect, test } from "@playwright/test";

// PR-B (issue #7 close-out): the real UI counterpart to
// e2e/datasource-register.spec.ts's headless harness — this spec drives
// intake.html through actual clicks/drops/typed URLs, not
// `window.__hyakkeiHarness` calls, exercising the state machine
// (packages/app/src/intake/types.ts) and its wiring in `IntakeApp.tsx`
// that a headless harness call can't observe (D11: "登録→SELECT
// round-tripの最終段のみ" gets a real browser; the UI layer above it gets
// this spec).
const FIXTURES_DIR = join(import.meta.dirname, "..", "spikes", "excel-fidelity", "fixtures");
const fixturePath = (name: string) => join(FIXTURES_DIR, name);

test.beforeEach(async ({ page }) => {
  await page.goto("/intake.html", { waitUntil: "domcontentloaded" });
});

test.describe("PR-B intake harness: file registration", () => {
  test("csv: drop -> Registered payoff view shows the real table, no dead-end", async ({
    page,
  }) => {
    await page.locator('input[type="file"]').setInputFiles(fixturePath("06-shift_jis.csv"));

    const status = page.getByRole("status").filter({ hasText: "取り込み完了" });
    await expect(status).toBeVisible();
    await expect(status).toContainText("06-shift_jis.csv");
    await expect(status).toContainText("2 行");
    await expect(page.locator("table th")).toHaveText(["部署", "担当者", "件数"]);
    // The payoff view IS the completion screen (D7's "eager register" —
    // Preview and Registered are the same state) — a forward-looking
    // completion line, not a dead end.
    await expect(status).toContainText("グラフ作成機能は今後の更新で追加されます");
  });

  test("xlsx multi-sheet: SheetPick appears with all 3 sheet names, choosing one registers it", async ({
    page,
  }) => {
    await page.locator('input[type="file"]').setInputFiles(fixturePath("05-multi-sheet.xlsx"));

    await expect(page.getByText("複数のシートがあります")).toBeVisible();
    const sheetButtons = page.locator("ul button");
    await expect(sheetButtons).toHaveCount(3);
    await expect(sheetButtons).toHaveText(["本庁", "支所A", "支所B"]);

    await sheetButtons.nth(1).click(); // 支所A
    const status = page.getByRole("status").filter({ hasText: "取り込み完了" });
    await expect(status).toBeVisible();
    await expect(status).toContainText("05-multi-sheet.xlsx");
  });

  test("an unrecognized file extension fails closed with the format error, without ever reaching DuckDB (no 'reading' flash)", async ({
    page,
  }) => {
    await page.locator('input[type="file"]').setInputFiles({
      name: "data.json",
      mimeType: "application/json",
      buffer: Buffer.from("{}"),
    });

    await expect(page.getByRole("alert")).toContainText("対応していない形式です");
    await expect(page.getByRole("alert")).toContainText("CSV・Excel(.xlsx)・Parquet");
  });

  test("redo (やり直す) drops the abandoned table so re-registering the identical file doesn't collide (register() is a plain CREATE TABLE, not CREATE OR REPLACE)", async ({
    page,
  }) => {
    const fileInput = page.locator('input[type="file"]');
    const status = page.getByRole("status").filter({ hasText: "取り込み完了" });

    await fileInput.setInputFiles(fixturePath("06-shift_jis.csv"));
    await expect(status).toBeVisible();

    await page.getByRole("button", { name: "やり直す" }).click();
    await expect(page.getByRole("button", { name: "ファイルを選択" })).toBeVisible();

    // Re-registering the identical file generates the identical sanitized
    // id (identifier.ts) -- this only succeeds if the first attempt's
    // table was actually dropped, not merely abandoned.
    await fileInput.setInputFiles(fixturePath("06-shift_jis.csv"));
    await expect(status).toBeVisible();
    await expect(page.getByRole("alert")).toHaveCount(0);
  });

  test("cancel during a slow load returns to empty immediately, and a late-arriving DuckDB init never resurrects stale state (generation guard)", async ({
    page,
  }) => {
    // Neither FileSource nor DuckDB itself exposes a progress/abort hook
    // (ReadingPanel.tsx's own doc comment) -- the one real, interceptable
    // network step in the whole registration path is DuckDB-WASM's own
    // worker/wasm bootstrap (`createDuckDB()`, first use only), so that is
    // what this test delays to create an observable "reading" window.
    let vendorRequestsIntercepted = 0;
    await page.route("**/vendor/**", async (route) => {
      vendorRequestsIntercepted++;
      await new Promise((resolve) => setTimeout(resolve, 1500));
      await route.continue();
    });

    await page.locator('input[type="file"]').setInputFiles(fixturePath("06-shift_jis.csv"));

    // The delayed spinner+cancel only appears past ~400ms (D10 flicker
    // avoidance) -- wait for it rather than clicking immediately.
    const cancelButton = page.getByRole("button", { name: "中止" });
    await expect(cancelButton).toBeVisible({ timeout: 2000 });
    await cancelButton.click();

    await expect(page.getByText("読み込みを中止しました")).toBeVisible();
    await expect(page.getByRole("button", { name: "ファイルを選択" })).toBeVisible();

    // The intercepted vendor fetch resolves ~1.5s after the drop; give
    // DuckDB init (and whatever it triggers) time to land and confirm it
    // did NOT flip the UI back to a registered/error state behind the
    // user's back.
    await page.waitForTimeout(2000);
    await expect(page.getByRole("status").filter({ hasText: "取り込み完了" })).toHaveCount(0);
    await expect(page.getByRole("alert")).toHaveCount(0);

    // Determinism sentinel (Phase 6-B adversarial review): without this,
    // a browser/cache/chunking difference that made `**/vendor/**` never
    // actually match anything would make the whole test pass vacuously
    // (cancel button never delayed, but also never clicked in time to
    // matter) instead of genuinely proving the generation guard.
    expect(
      vendorRequestsIntercepted,
      "the route interception never actually fired",
    ).toBeGreaterThan(0);
  });

  test("a column named __proto__/constructor renders correctly in the payoff table and never pollutes Object.prototype (UI-layer counterpart to e2e/datasource-register.spec.ts's core-layer test)", async ({
    page,
  }) => {
    const before = await page.evaluate(() => Object.getOwnPropertyNames(Object.prototype));

    await page.locator('input[type="file"]').setInputFiles(fixturePath("18-proto-column.xlsx"));

    const status = page.getByRole("status").filter({ hasText: "取り込み完了" });
    await expect(status).toBeVisible();

    // Rendered DOM text, not a value crossing page.evaluate()'s own
    // return-value serialization boundary (which is known to drop a
    // "__proto__"-named own property regardless of how correctly the
    // browser-side object was built) -- `RegisteredSummary.tsx` renders
    // `row[name]` as plain JSX text nodes, so what a user actually SEES is
    // exactly what this checks.
    await expect(page.locator("table th")).toHaveText(["id", "__proto__", "constructor"]);
    const dataRow = page.locator("table tbody tr").first();
    await expect(dataRow.locator("td")).toHaveText(["1", "polluted?", "also polluted?"]);

    const after = await page.evaluate(() => Object.getOwnPropertyNames(Object.prototype));
    expect(after, "Object.prototype gained an own property while registering/rendering").toEqual(
      before,
    );
  });
});

// UrlSource's real `EgressPolicy` (unlike register-harness.html's
// deliberately loose DI stub) enforces https-only + same-origin
// (egress-policy.ts's own `classifyUrlTarget`) -- which the plan's own D11
// technical selection already established is structurally untestable via a
// real browser click-through against this project's e2e server
// (`npx serve`, plain http; ADR-0007's own "a same-origin static-file-
// server... without TLS can never satisfy this check" is the exact
// documented reason). This describe block only exercises the ONE branch
// that IS environment-independent: a disallowed URL never reaching the
// network. UrlSource's success path stays covered where the plan puts it —
// egress-policy.ts's 24 pure Vitest cases, plus
// e2e/datasource-register.spec.ts's fetch-DI harness test for the shared
// register path itself.
test.describe("PR-B intake harness: URL registration", () => {
  test("a disallowed URL is blocked BEFORE any fetch runs (V-085: zero requests reach it), and renders as guidance, not an error", async ({
    page,
  }) => {
    const blockedRequests: string[] = [];
    page.on("request", (request) => {
      if (new URL(request.url()).origin === "https://attacker.example") {
        blockedRequests.push(request.url());
      }
    });

    await page.getByLabel("データのURL").fill("https://attacker.example/x.csv");
    await page.getByRole("button", { name: "接続" }).click();

    // This test server is plain http (playwright.config.ts) -- ANY https
    // target therefore fails `classifyUrlTarget`'s scheme-mismatch check
    // before its origin is ever compared (egress-policy.ts), so the exact
    // `NetworkBlockedReason` this hits is an artifact of the test
    // environment, not of "attacker.example" specifically. Asserting the
    // shared "blocked" outcome (info-toned, guidance copy, zero network
    // requests) is the environment-independent invariant worth pinning
    // here; `errorCopy.test.ts` already covers each reason's copy in
    // isolation.
    const blockedPanel = page
      .getByRole("status")
      .filter({ hasText: "https://attacker.example/x.csv" });
    await expect(blockedPanel).toBeVisible();
    // `ReadingPanel` is ALSO a `role="status"` region and would ALSO
    // contain the typed URL as its echoed source label (Phase 6-B
    // adversarial review) -- the `hasText` filter above alone cannot tell
    // "correctly blocked before any fetch" apart from "preflight was
    // removed and it's just reading". `戻る` only exists on `BlockedPanel`
    // (`ReadingPanel`'s button is `中止`), and "読み込み中" text only ever
    // appears in `ReadingPanel` -- asserting both closes that gap.
    await expect(page.getByRole("button", { name: "戻る" })).toBeVisible();
    await expect(page.getByText("読み込み中")).toHaveCount(0);
    // The panel must NOT be styled/announced as an error (D10: "第三者URL
    // は...正常分岐としてescape hatch案内に落ちる（エラー経路に残さない）").
    await expect(page.getByRole("alert")).toHaveCount(0);
    expect(blockedRequests, "a request reached the blocked origin").toEqual([]);
  });
});
