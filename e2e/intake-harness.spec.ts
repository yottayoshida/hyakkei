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

/**
 * Neutralizes `scheduleIdleWarm()` (data-layer.ts, issue #54) for tests
 * that deliberately fail `loadDataLayer()` via `page.route`. Root cause
 * (Phase 6-B adversarial review): idle warm fires its OWN
 * `loadDataLayer()` call on mount, independent of anything a test does --
 * if that call wins the race and succeeds before a route is even
 * registered, `loadDataLayer()`'s singleton memoizes the successful
 * result, and every later caller (a test's own URL submit / file drop)
 * silently reuses it instead of hitting the intended failure. This was
 * observed as flaky failures where the intended error never appeared
 * (the URL path instead reached real `classifyUrlTarget` and hit an
 * unrelated "blocked" outcome). `requestIdleCallback` is overridden to a
 * no-op (not deleted -- `scheduleIdleWarm`'s `typeof
 * requestIdleCallback === "function"` check must still hold, so it
 * doesn't fall through to the equally-racy `setTimeout` path) BEFORE any
 * page script runs (`addInitScript`), so idle warm never calls
 * `loadDataLayer()` at all in these tests.
 */
async function disableIdleWarm(page: import("@playwright/test").Page): Promise<void> {
  await page.addInitScript(() => {
    (window as unknown as { requestIdleCallback: () => number }).requestIdleCallback = () => 0;
  });
}

/**
 * Aborts only the FIRST `**\/assets/*.js` request, letting every later one
 * through -- the shared setup both "permanent failure" tests below use to
 * fail exactly one data-layer load attempt without permanently blocking
 * the entry chunk or any later, legitimately different request. An
 * optional delay lets a test create an observable "still in flight"
 * window before the failure lands (/simplify: extracted from two
 * near-identical inline `interceptedOnce` blocks).
 */
async function abortFirstAssetRequest(
  page: import("@playwright/test").Page,
  options: { delayMs?: number } = {},
): Promise<{ wasIntercepted: () => boolean }> {
  let intercepted = false;
  await page.route("**/assets/*.js", async (route) => {
    if (intercepted) {
      await route.continue();
      return;
    }
    intercepted = true;
    if (options.delayMs) {
      await new Promise((resolve) => setTimeout(resolve, options.delayMs));
    }
    await route.abort("failed");
  });
  return { wasIntercepted: () => intercepted };
}

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

  // Codex R1 P1: this PR (issue #54 Stage A) redesigned `toIntakeError`'s
  // classification from a static `instanceof DataSourceError` to one
  // indirected through `getResolvedDataLayer()` -- `data-layer.test.ts`
  // only proves this holds inside a single, unsplit Vitest module graph.
  // A 0-byte CSV is the one fixture-free way to reach a GENUINE
  // `DataSourceError` (csv-source.ts's `assertNotEmpty`, kind "empty") from
  // `inspect()`, past `loadDataLayer()`'s dynamic `import()` -- proving the
  // `instanceof` check still recognizes the real error class once it comes
  // from a lazily-loaded chunk in the actual built app, not just Node.
  test("a genuinely empty (0-byte) CSV shows the specific 'empty' copy, not the generic corrupt fallback -- proves toIntakeError's DataSourceError classification survives the real, chunk-split build (issue #54 Stage A)", async ({
    page,
  }) => {
    await page.locator('input[type="file"]').setInputFiles({
      name: "empty.csv",
      mimeType: "text/csv",
      buffer: Buffer.from(""),
    });

    const status = page.getByRole("status").filter({ hasText: "データが空でした" });
    await expect(status).toBeVisible();
    await expect(status).toContainText("empty.csv");
    // "empty" is an info-toned outcome (D10: "0件"と"失敗"の分離), rendered
    // via `role="status"`, never `role="alert"` -- if the dynamic
    // `instanceof DataSourceError` check ever silently misclassified this
    // as an unrecognized error, `toIntakeError`'s generic "corrupt"
    // fallback would replace this copy with "内容を読み取れませんでした"
    // under `role="alert"` instead, which this rules out.
    await expect(page.getByRole("alert")).toHaveCount(0);
  });

  // Phase 6-B adversarial review: this started as an attempt to prove
  // `loadDataLayer()`'s rejection-reset lets a LATER attempt retry from
  // scratch and succeed. It does not -- and the reason is a real browser
  // constraint, not a bug in this PR's code: per the HTML spec's module
  // map ("once a module map entry's result is not 'fetching', it does not
  // change"), a failed dynamic `import()` for a given URL is cached as
  // permanently failed for the rest of the page's lifetime. Empirically
  // confirmed here: even though the route below lets every request AFTER
  // the first one through, a second in-page attempt issues ZERO further
  // network requests for the chunk -- the browser replays the cached
  // failure. `data-layer.ts`'s own doc comment has been corrected to
  // state this precisely; this test pins the actual, verified behavior
  // (consistent replay, not silent recovery) instead of the originally
  // assumed one.
  test("a data-layer load failure is permanent for the rest of the page session (browser module-map caching, HTML spec) -- a later in-page retry consistently replays the same failure, it does not silently recover", async ({
    page,
  }) => {
    // Re-navigates so the init script actually takes effect (addInitScript
    // only applies from the NEXT navigation onward, not retroactively to
    // `beforeEach`'s already-completed one).
    await disableIdleWarm(page);
    await page.goto("/intake.html", { waitUntil: "domcontentloaded" });
    // QA review: confirm React/entry chunks are done loading BEFORE
    // registering the route -- otherwise, under load, "the first request"
    // `abortFirstAssetRequest` catches could be a still-in-flight
    // `modulepreload` chunk (React itself), not the data-layer chunk this
    // test means to fail, intermittently preventing mount entirely.
    await expect(page.getByLabel("ファイルを選択")).toBeVisible();

    const chunkRequests: string[] = [];
    page.on("request", (req) => {
      if (/\/assets\/(index|factory)-.*\.js$/.test(req.url())) chunkRequests.push(req.url());
    });

    const abortedRequest = await abortFirstAssetRequest(page);

    await page.locator('input[type="file"]').setInputFiles(fixturePath("06-shift_jis.csv"));
    await expect(page.getByRole("alert")).toContainText("内容を読み取れませんでした");
    const requestCountAfterFirst = chunkRequests.length;

    await page.getByRole("button", { name: "はじめからやり直す" }).click();
    // Wait for `DropZone` to actually remount (RESET -> phase "empty") --
    // without this, `setInputFiles` can target the previous phase's
    // now-detaching `<input>` before React has re-rendered.
    await expect(page.getByLabel("ファイルを選択")).toBeVisible();
    await page.locator('input[type="file"]').setInputFiles(fixturePath("06-shift_jis.csv"));

    // Consistently the SAME failure, not a stale/blank/different one --
    // `toIntakeError`'s `getResolvedDataLayer()` indirection (Round 1)
    // still classifies it correctly on repeat.
    await expect(page.getByRole("alert")).toContainText("内容を読み取れませんでした");
    // The route now lets chunk requests through (past the first abort),
    // yet no NEW request for the data-layer chunks was issued -- the
    // browser's module map served the cached failure instead of
    // re-fetching, exactly the constraint this test documents.
    expect(
      chunkRequests.length,
      "a second in-page attempt issued a new network request for the data-layer chunk -- browser module-map caching behavior changed",
    ).toBe(requestCountAfterFirst);

    expect(abortedRequest.wasIntercepted(), "the route interception never actually fired").toBe(
      true,
    );
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

  // Codex R1 P1: before this fix, `UrlPanel`'s own `await loadDataLayer()`
  // had no error handling at all -- a rejection here (unlike every other
  // call site in this app) was a completely silent no-op: no error, no
  // "reading" flash, just an unresponsive button forever.
  test("a data-layer chunk load failure on URL submit shows the retryable error UX, not silence", async ({
    page,
  }) => {
    await disableIdleWarm(page);
    await page.goto("/intake.html", { waitUntil: "domcontentloaded" });
    // QA review: `domcontentloaded` doesn't guarantee `modulepreload`-hinted
    // chunks (`client-*.js` etc., React itself) have finished fetching --
    // under load, registering the abort-everything route immediately after
    // could still catch one of THOSE in flight, not just the data-layer
    // chunk this test means to fail, intermittently preventing React from
    // ever mounting. Waiting for the real UI to render first confirms the
    // entry/vendor chunks are already done, so the route below can only
    // affect requests the URL submission itself triggers.
    await expect(page.getByLabel("データのURL")).toBeVisible();
    await page.route("**/assets/*.js", (route) => route.abort("failed"));

    await page.getByLabel("データのURL").fill("https://example.com/x.csv");
    await page.getByRole("button", { name: "接続" }).click();

    // Falls through `toIntakeError`'s generic "corrupt" classification
    // (getResolvedDataLayer() returns undefined -- the layer never
    // resolved), same as any other unrecognized failure in this app.
    const alert = page.getByRole("alert");
    await expect(alert).toContainText("内容を読み取れませんでした");
    await expect(page.getByRole("button", { name: "はじめからやり直す" })).toBeVisible();
    // No lingering silent-pending state: the button was disabled only for
    // the duration of the failed attempt, not forever.
    await expect(page.getByRole("button", { name: "接続" })).toHaveCount(0);
  });

  // Codex R2 (fix-for-a-fix on the previous test's own fix): a late-
  // arriving URL load failure must not clobber an unrelated, already-
  // settled attempt that started after it. Dropping an unsupported-format
  // file never calls `loadDataLayer()` at all (`fileFormatFromName` fails
  // first, synchronously) -- deliberately so this test doesn't get
  // entangled in `loadDataLayer()`'s own singleton memoization (a file
  // attempt that DID call it while the URL's load was still pending would
  // share and fail with the SAME promise, which is a different, already-
  // legitimate outcome, not the clobbering bug this test targets).
  test("a URL's stale, delayed load failure does not overwrite a DIFFERENT, already-settled attempt that started while it was still pending (Codex R2: generation-guarded onLoadFailed)", async ({
    page,
  }) => {
    await disableIdleWarm(page);
    await page.goto("/intake.html", { waitUntil: "domcontentloaded" });
    // QA review: see the "permanent failure" test above for why this must
    // come before registering the route.
    await expect(page.getByLabel("データのURL")).toBeVisible();

    // Long enough for the file drop below to fully settle into "error"
    // before this URL attempt's failure arrives -- proving the failure
    // really is stale by the time it lands, not just fast enough in
    // practice to not matter.
    const abortedRequest = await abortFirstAssetRequest(page, { delayMs: 1500 });

    await page.getByLabel("データのURL").fill("https://example.com/x.csv");
    await page.getByRole("button", { name: "接続" }).click();

    // While the URL's (delayed) preflight is still in flight,
    // `IntakeApp.state.phase` is still "empty" -- `submitting` only
    // disables `UrlPanel`'s own input/button, not `DropZone`, which stays
    // interactive. This drop starts and fully settles a SECOND, unrelated
    // attempt (its own generation) before the URL's failure lands.
    await page.locator('input[type="file"]').setInputFiles({
      name: "data.json",
      mimeType: "application/json",
      buffer: Buffer.from("{}"),
    });

    const formatError = page.getByRole("alert").filter({ hasText: "対応していない形式です" });
    await expect(formatError).toBeVisible();

    // The URL's failure arrives ~1.5s after the drop; give it time to
    // land and confirm it did NOT flip the file's error screen to one
    // about the abandoned URL instead.
    await page.waitForTimeout(2000);
    await expect(formatError).toBeVisible();
    await expect(page.getByRole("alert")).toHaveCount(1);

    expect(abortedRequest.wasIntercepted(), "the route interception never actually fired").toBe(
      true,
    );
  });
});
