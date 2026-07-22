import { join } from "node:path";
import { expect, test } from "@playwright/test";

// PR-B (issue #7 close-out), rewritten for issue #11a (single-SPA editor,
// ADR-0010): intake.html no longer exists -- `IntakeApp` is embedded in
// index.html's editor shell (App.tsx). This spec drives that shell through
// actual clicks/drops/typed URLs, exercising the state machine
// (packages/app/src/intake/types.ts) and its wiring in `IntakeApp.tsx`/
// `App.tsx` that a headless harness call (e2e/datasource-register.spec.ts)
// can't observe.
const FIXTURES_DIR = join(import.meta.dirname, "..", "spikes", "excel-fidelity", "fixtures");
const fixturePath = (name: string) => join(FIXTURES_DIR, name);

/**
 * Registers `06-shift_jis.csv` as the workspace's first source, then opens
 * the "add source" panel -- the first half of a two-source setup, split
 * from the second half so a caller can inject something (e.g. a `page.route`
 * abort) between opening the panel and the second file actually landing.
 */
async function registerFirstSourceAndOpenPanel(
  page: import("@playwright/test").Page,
): Promise<void> {
  await page.locator('input[type="file"]').setInputFiles(fixturePath("06-shift_jis.csv"));
  await expect(page.getByRole("heading", { name: "データワークスペース" })).toBeVisible();
  await page.getByRole("button", { name: "データを追加" }).click();
}

/** Registers `05-multi-sheet.xlsx` through the already-open "add source" panel -- the second half of a two-source setup (see `registerFirstSourceAndOpenPanel`). */
async function registerSecondSourceViaPanel(page: import("@playwright/test").Page): Promise<void> {
  await page.locator('input[type="file"]').setInputFiles(fixturePath("05-multi-sheet.xlsx"));
  await page.getByText("複数のシートがあります").waitFor();
  await page.locator("ul button").first().click();
  await expect(page.locator(".hyakkei-source-card")).toHaveCount(2);
}

/**
 * The mechanical setup 3 of the "multiple sources" tests below share
 * verbatim (/simplify: matching this file's own existing precedent,
 * `abortFirstAssetRequest`'s doc comment, "extracted from two
 * near-identical inline blocks"). Only for tests that don't care about the
 * INTERMEDIATE state this produces (panel focus mid-flow, etc.) -- the one
 * test that specifically verifies that intermediate state keeps its own
 * inline steps instead of calling this.
 */
async function registerTwoSources(page: import("@playwright/test").Page): Promise<void> {
  await registerFirstSourceAndOpenPanel(page);
  await registerSecondSourceViaPanel(page);
}

/**
 * Neutralizes `scheduleIdleWarm()` (data-layer.ts, issue #54) for tests
 * that deliberately fail `loadDataLayer()` via `page.route`. Root cause
 * (Phase 6-B adversarial review): idle warm fires its OWN
 * `loadDataLayer()` call on mount, independent of anything a test does --
 * if that call wins the race and succeeds before a route is even
 * registered, `loadDataLayer()`'s singleton memoizes the successful
 * result, and every later caller (a test's own URL submit / file drop)
 * silently reuses it instead of hitting the intended failure. `requestIdleCallback`
 * is overridden to a no-op (not deleted -- `scheduleIdleWarm`'s `typeof
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
  await page.goto("/index.html", { waitUntil: "domcontentloaded" });
});

test.describe("editor shell: file registration", () => {
  test("csv: drop -> workspace shows the real table, no dead-end", async ({ page }) => {
    await page.locator('input[type="file"]').setInputFiles(fixturePath("06-shift_jis.csv"));

    // issue #11a: registration success auto-enters the workspace (no
    // "確定" click) -- the workspace's own heading is the arrival signal.
    const heading = page.getByRole("heading", { name: "データワークスペース" });
    await expect(heading).toBeVisible();
    // UX review focus-management (code review): the workspace's own
    // heading receives focus on the FIRST successful registration, so a
    // keyboard/screen-reader user isn't left wherever the (now-gone)
    // onboarding form used to be.
    await expect(heading).toBeFocused();
    const announcement = page.getByRole("status").filter({ hasText: "取り込みました" });
    await expect(announcement).toBeVisible();
    await expect(announcement).toContainText("06-shift_jis.csv");
    await expect(announcement).toContainText("2行");

    const card = page.locator(".hyakkei-source-card");
    // issue #11b: each `<th>` now also nests a category `<select>`
    // (Playwright's `toHaveText` walks all descendant text nodes, including
    // a closed `<select>`'s own `<option>` labels) -- scoped to the name's
    // own wrapper `<div>` so this keeps asserting the visible column name
    // only, not the select's internal option text.
    await expect(card.locator("table th > div")).toHaveText(["部署", "担当者", "件数"]);
    // a11y (code review P2 #4 / WCAG 1.3.1): every `<th>` names its column
    // for assistive tech, and the table itself carries a caption.
    for (const th of await card.locator("table th").all()) {
      await expect(th).toHaveAttribute("scope", "col");
    }
    await expect(card.locator("table caption")).toContainText("06-shift_jis.csv");
    // The workspace's forward-looking note (D7's "not a dead end" framing,
    // carried forward from the former terminal screen) -- now a single
    // workspace-level note, not repeated per source card.
    await expect(page.getByText("グラフ作成機能は今後の更新で追加されます")).toBeVisible();
  });

  test("xlsx multi-sheet: SheetPick appears with all 3 sheet names, choosing one registers it and enters the workspace", async ({
    page,
  }) => {
    await page.locator('input[type="file"]').setInputFiles(fixturePath("05-multi-sheet.xlsx"));

    await expect(page.getByText("複数のシートがあります")).toBeVisible();
    const sheetButtons = page.locator("ul button");
    await expect(sheetButtons).toHaveCount(3);
    await expect(sheetButtons).toHaveText(["本庁", "支所A", "支所B"]);

    await sheetButtons.nth(1).click(); // 支所A
    await expect(page.getByRole("heading", { name: "データワークスペース" })).toBeVisible();
    const announcement = page.getByRole("status").filter({ hasText: "取り込みました" });
    await expect(announcement).toBeVisible();
    await expect(announcement).toContainText("05-multi-sheet.xlsx");
  });

  test("an unrecognized file extension fails closed with the format error, staying in onboarding (no 'reading' flash, no workspace entry)", async ({
    page,
  }) => {
    await page.locator('input[type="file"]').setInputFiles({
      name: "data.json",
      mimeType: "application/json",
      buffer: Buffer.from("{}"),
    });

    await expect(page.getByRole("alert")).toContainText("対応していない形式です");
    await expect(page.getByRole("alert")).toContainText("CSV・Excel(.xlsx)・Parquet");
    await expect(page.getByRole("heading", { name: "データワークスペース" })).toHaveCount(0);
  });

  // issue #42: a legacy .xls extension gets its own actionable copy, not
  // the generic unsupported-format fallback -- this repo's own target
  // persona (old government-distributed spreadsheets) frequently has these.
  test("a legacy .xls file is rejected with the specific re-save-as-.xlsx guidance, not the generic unsupported-format copy", async ({
    page,
  }) => {
    await page.locator('input[type="file"]').setInputFiles({
      name: "legacy.xls",
      mimeType: "application/vnd.ms-excel",
      buffer: Buffer.from("not a real xls file"),
    });

    const alert = page.getByRole("alert");
    await expect(alert).toContainText("古い形式のExcelファイルです");
    await expect(alert).toContainText(".xlsx");
    await expect(alert).not.toContainText("対応していない形式です");
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

  // issue #91, rewritten for issue #11a's fix: a data-layer chunk-load
  // failure used to be misattributed to the user's file ("内容を読み取れ
  // ませんでした" / corrupt). It is now correctly attributed to the app's
  // own code failing to load, with a reload affordance instead of the
  // normal (never-effective, per the module-map constraint below) "はじめ
  // からやり直す" retry.
  test("a data-layer load failure is correctly attributed to the app (not the user's file), with a reload affordance instead of the never-effective in-page retry", async ({
    page,
  }) => {
    // Re-navigates so the init script actually takes effect (addInitScript
    // only applies from the NEXT navigation onward, not retroactively to
    // `beforeEach`'s already-completed one).
    await disableIdleWarm(page);
    await page.goto("/index.html", { waitUntil: "domcontentloaded" });
    // QA review: confirm React/entry chunks are done loading BEFORE
    // registering the route -- otherwise, under load, "the first request"
    // `abortFirstAssetRequest` catches could be a still-in-flight
    // `modulepreload` chunk (React itself), not the data-layer chunk this
    // test means to fail, intermittently preventing mount entirely.
    await expect(page.getByLabel("ファイルを選択")).toBeVisible();

    const abortedRequest = await abortFirstAssetRequest(page);

    await page.locator('input[type="file"]').setInputFiles(fixturePath("06-shift_jis.csv"));

    const alert = page.getByRole("alert");
    await expect(alert).toContainText("アプリの読み込みに問題が発生しました");
    // The one message this app shows at the exact moment a user's mental
    // model of "did my data just get uploaded/corrupted" is most in
    // question -- explicitly clearing the file of blame.
    await expect(alert).toContainText("お使いのファイルに問題はありません");
    // No in-page retry offered for this kind (it cannot succeed, per the
    // module-map constraint) -- only a reload affordance.
    await expect(page.getByRole("button", { name: "はじめからやり直す" })).toHaveCount(0);
    const reloadButton = page.getByRole("button", { name: "ページを再読み込み" });
    await expect(reloadButton).toBeVisible();

    // Reload proceeds directly, no confirm dialog: a `data-layer-load`
    // failure can only occur before any source is registered (this kind is
    // architecturally unreachable once `loadDataLayer()` has ever resolved
    // successfully -- see ADR-0010's correction note), so there is nothing
    // a reload here could ever discard.
    await reloadButton.click();
    await expect(page.getByLabel("ファイルを選択")).toBeVisible();

    expect(abortedRequest.wasIntercepted(), "the route interception never actually fired").toBe(
      true,
    );
  });

  // Split from the test above (not merely appended) because this second
  // half's premise -- "a full reload re-fetches the previously-aborted
  // chunk" -- does not hold uniformly across engines. Empirically
  // confirmed via a network trace (2026-07-21): Chromium and Firefox both
  // re-request the earlier-aborted chunk after `location.reload()` and the
  // registration then succeeds. WebKit does not -- of the 3 chunks the
  // data layer needs, the 2 that were NEVER aborted are freshly
  // re-requested after reload, but the ONE chunk `abortFirstAssetRequest`
  // aborted on the first attempt is never re-requested at all (no request
  // reaches Playwright's route handler for it a second time), and the
  // second registration attempt fails with the exact same error. This
  // reads as WebKit scoping its failed-module-resolution record to
  // something that survives a same-document `location.reload()` (broader
  // than the "page's own lifetime" the other two engines implement, and
  // broader than data-layer.ts's own doc comment assumed) -- a real,
  // synthetic-abort-specific engine difference, not a product defect: nothing
  // suggests a genuine (non-test-harness-induced) transient network failure
  // would be cached the same way. Skipped on WebKit rather than asserted
  // against a premise this engine doesn't honor.
  test("a page reload (not the in-page retry) genuinely recovers from a data-layer load failure", async ({
    page,
    browserName,
  }) => {
    test.skip(
      browserName === "webkit",
      "WebKit does not re-fetch a chunk whose earlier request was aborted, even across a full location.reload() -- see comment above this test",
    );

    await disableIdleWarm(page);
    await page.goto("/index.html", { waitUntil: "domcontentloaded" });
    await expect(page.getByLabel("ファイルを選択")).toBeVisible();

    const abortedRequest = await abortFirstAssetRequest(page);
    await page.locator('input[type="file"]').setInputFiles(fixturePath("06-shift_jis.csv"));
    await expect(page.getByRole("alert")).toContainText("アプリの読み込みに問題が発生しました");

    await page.getByRole("button", { name: "ページを再読み込み" }).click();
    await expect(page.getByLabel("ファイルを選択")).toBeVisible();

    // The interception route's one-shot abort was already spent on the
    // first attempt, so this fresh page load's own asset requests go
    // through untouched -- proving the reload (unlike any in-page
    // retry) genuinely recovers.
    await page.locator('input[type="file"]').setInputFiles(fixturePath("06-shift_jis.csv"));
    await expect(page.getByRole("heading", { name: "データワークスペース" })).toBeVisible();

    expect(abortedRequest.wasIntercepted(), "the route interception never actually fired").toBe(
      true,
    );
  });

  test("deleting a source drops its table so re-registering the identical file doesn't collide (register() is a plain CREATE TABLE, not CREATE OR REPLACE)", async ({
    page,
  }) => {
    const fileInput = page.locator('input[type="file"]');

    await fileInput.setInputFiles(fixturePath("06-shift_jis.csv"));
    await expect(page.getByRole("heading", { name: "データワークスペース" })).toBeVisible();
    // The underlying table id, captured BEFORE delete (code review
    // Mirror-Check finding): `sourceLabel`/row/column counts are identical
    // for a same-file re-registration whether the id is genuinely reused
    // or silently suffixed (identifier.ts's own collision-avoidance) --
    // `data-table-id` is the one thing that actually distinguishes them.
    const originalTableId = await page
      .locator(".hyakkei-source-card")
      .getAttribute("data-table-id");
    expect(originalTableId).toBeTruthy();

    await page.locator(".hyakkei-source-card").getByRole("button", { name: "削除" }).click();
    // Deleting the only source returns to onboarding (issue #11a: no
    // sources left = no workspace), with focus and a live-region
    // announcement following it there (code review P2 #2).
    const onboardHeading = page.getByRole("heading", { name: "データ取り込み" });
    await expect(onboardHeading).toBeVisible();
    await expect(onboardHeading).toBeFocused();
    await expect(page.getByRole("status").filter({ hasText: "削除しました" })).toContainText(
      "06-shift_jis.csv",
    );

    // Re-registering the identical file generates the identical sanitized
    // id (identifier.ts) -- this only succeeds if the first attempt's
    // table was actually dropped, not merely abandoned.
    await fileInput.setInputFiles(fixturePath("06-shift_jis.csv"));
    await expect(page.getByRole("heading", { name: "データワークスペース" })).toBeVisible();
    await expect(page.getByRole("alert")).toHaveCount(0);
    // The decisive check: the SAME table id was reused, not a `_2`-suffixed
    // new one -- proving the DROP TABLE genuinely ran, not merely that the
    // UI looks the same either way.
    await expect(page.locator(".hyakkei-source-card")).toHaveAttribute(
      "data-table-id",
      originalTableId!,
    );
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
    // did NOT flip the UI to the workspace behind the user's back.
    await page.waitForTimeout(2000);
    await expect(page.getByRole("heading", { name: "データワークスペース" })).toHaveCount(0);
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

  test("a column named __proto__/constructor renders correctly in the workspace's data card and never pollutes Object.prototype (UI-layer counterpart to e2e/datasource-register.spec.ts's core-layer test)", async ({
    page,
  }) => {
    const before = await page.evaluate(() => Object.getOwnPropertyNames(Object.prototype));

    await page.locator('input[type="file"]').setInputFiles(fixturePath("18-proto-column.xlsx"));

    await expect(page.getByRole("heading", { name: "データワークスペース" })).toBeVisible();

    // Rendered DOM text, not a value crossing page.evaluate()'s own
    // return-value serialization boundary (which is known to drop a
    // "__proto__"-named own property regardless of how correctly the
    // browser-side object was built) -- `RegisteredSummary.tsx` renders
    // `row[name]` as plain JSX text nodes, so what a user actually SEES is
    // exactly what this checks.
    const card = page.locator(".hyakkei-source-card");
    // issue #11b: scoped to the name's own `<div>`, not the whole `<th>`
    // (which now also nests a category `<select>`) -- see the identical
    // note on this file's first `toHaveText(["部署", ...])` assertion.
    await expect(card.locator("table th > div")).toHaveText(["id", "__proto__", "constructor"]);
    const dataRow = card.locator("table tbody tr").first();
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
test.describe("editor shell: URL registration", () => {
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
  // "reading" flash, just an unresponsive button forever. issue #91: this
  // failure is now attributed correctly (data-layer-load, reload
  // affordance), not the generic corrupt fallback the pre-#11a version
  // fell back to.
  test("a data-layer chunk load failure on URL submit shows the reload-affordance error UX, not silence", async ({
    page,
  }) => {
    await disableIdleWarm(page);
    await page.goto("/index.html", { waitUntil: "domcontentloaded" });
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

    const alert = page.getByRole("alert");
    await expect(alert).toContainText("アプリの読み込みに問題が発生しました");
    await expect(alert).toContainText("お使いのファイルに問題はありません");
    await expect(page.getByRole("button", { name: "ページを再読み込み" })).toBeVisible();
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
    await page.goto("/index.html", { waitUntil: "domcontentloaded" });
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

test.describe("editor shell: multiple sources", () => {
  test("a second source registered via the 'データを追加' panel is added alongside the first, without disturbing it", async ({
    page,
  }) => {
    await page.locator('input[type="file"]').setInputFiles(fixturePath("06-shift_jis.csv"));
    await expect(page.getByRole("heading", { name: "データワークスペース" })).toBeVisible();
    await expect(page.locator(".hyakkei-source-card")).toHaveCount(1);

    const addButton = page.getByRole("button", { name: "データを追加" });
    await addButton.click();
    // The panel mode's own heading (not a second <h1>, a11y) confirms the
    // contained panel opened, not a second full onboarding screen.
    await expect(page.getByRole("heading", { name: "データを追加" })).toBeVisible();
    // Focus moves into the newly-opened panel (code review, focus mgmt).
    await expect(page.locator('div[tabindex="-1"]:has(h2:text("データを追加"))')).toBeFocused();

    // A distinct fixture (different sanitized id) -- proves accumulation,
    // not replacement.
    await page.locator('input[type="file"]').setInputFiles(fixturePath("05-multi-sheet.xlsx"));
    await page.getByText("複数のシートがあります").waitFor();
    await page.locator("ul button").first().click();

    // The panel closes on success (issue #11a: registered -> onComplete ->
    // merge + close), leaving both sources visible in the workspace.
    await expect(page.getByRole("heading", { name: "データを追加" })).toHaveCount(0);
    await expect(page.locator(".hyakkei-source-card")).toHaveCount(2);
    // Focus returns to "データを追加" once the panel closes (code review,
    // focus mgmt) -- whether it closed via success or cancel.
    await expect(addButton).toBeFocused();
    // The FIRST source's card is untouched by the second registration.
    // issue #11b: scoped to `th > div` (see this file's first such note).
    await expect(page.locator(".hyakkei-source-card").first().locator("table th > div")).toHaveText(
      ["部署", "担当者", "件数"],
    );
  });

  // R2 review: the P2 focus-hijack guard (App.tsx's `!panelOpen` check) and
  // the aria-label distinguishability fix (RegisteredSummary.tsx) both
  // exist specifically for the "2+ sources" case -- a single-source test
  // can't tell them apart from their absence (Playwright's default
  // substring name-matching finds a lone "削除" button either way, and
  // there's no OTHER source's focus for a wayward effect to steal).
  test("deleting one of several sources by its distinguishing label leaves the other untouched and returns focus to 'データを追加'", async ({
    page,
  }) => {
    await registerTwoSources(page);

    // Each card's delete button is named for ITS OWN source, not a bare
    // "削除" both would match identically -- `exact` rules out substring
    // overlap between the two labels.
    const deleteFirst = page.getByRole("button", {
      name: "「06-shift_jis.csv」を削除",
      exact: true,
    });
    const deleteSecond = page.getByRole("button", {
      name: "「05-multi-sheet.xlsx」を削除",
      exact: true,
    });
    await expect(deleteFirst).toBeVisible();
    await expect(deleteSecond).toBeVisible();

    await deleteFirst.click();

    // The one source that was NOT deleted survives, still showing its own
    // data -- not just "a card count of 1", which a wrong-source delete
    // would also produce.
    await expect(page.locator(".hyakkei-source-card")).toHaveCount(1);
    await expect(deleteFirst).toHaveCount(0);
    await expect(deleteSecond).toBeVisible();
    // A source remains -> still the workspace, not onboarding (code review
    // P2 #3's `!panelOpen`-guarded branch: deleting one of SEVERAL leaves
    // others behind, distinct from the last-source-deleted path this file
    // already covers elsewhere).
    await expect(page.getByRole("heading", { name: "データワークスペース" })).toBeVisible();
    await expect(page.getByRole("button", { name: "データを追加" })).toBeFocused();
  });

  // code review P2 #3: deleting a source while mid-interaction with the
  // "add source" panel must not yank focus out of that panel onto a button
  // behind it -- the `!panelOpen` guard in App.tsx's focus effect exists
  // specifically for this. Needs TWO sources already present before the
  // panel opens: deleting the only/last source instead would unmount the
  // entire workspace (panel included) via the separate `curr===0` branch,
  // proving nothing about this guard.
  test("deleting one of several sources while the 'データを追加' panel is open does not steal focus from the panel", async ({
    page,
  }) => {
    await registerTwoSources(page);
    // Registering closes the panel (existing behavior) -- reopen it so
    // deletion below happens WHILE it's open, the scenario under test.
    await page.getByRole("button", { name: "データを追加" }).click();
    const panel = page.locator('div[tabindex="-1"]:has(h2:text("データを追加"))');
    await expect(panel).toBeFocused();

    const addButton = page.getByRole("button", { name: "データを追加" });
    await page.getByRole("button", { name: "「06-shift_jis.csv」を削除", exact: true }).click();

    // One source remains (not the last one deleted) -- the workspace, and
    // this panel, stay mounted. The guard only PREVENTS the wrong redirect
    // (to "データを追加", behind the panel) -- it does not itself move
    // focus anywhere, so the deleted button's own removal from the DOM is
    // what determines where focus actually lands (browser default, not
    // this component's concern). What matters is that it did NOT land on
    // the add-source button.
    await expect(page.locator(".hyakkei-source-card")).toHaveCount(1);
    await expect(panel).toBeVisible();
    await expect(addButton).not.toBeFocused();
  });

  // code review P1 #1: before this, opening the panel was a dead end --
  // the only ways out were registering SOME source or reloading (which
  // discards every already-registered source, DuckDB-WASM being
  // in-memory). "閉じる" must abandon the panel without registering
  // anything and without disturbing the source already in the workspace.
  test("the 'データを追加' panel can be closed without registering anything, leaving the existing source untouched", async ({
    page,
  }) => {
    await page.locator('input[type="file"]').setInputFiles(fixturePath("06-shift_jis.csv"));
    await expect(page.getByRole("heading", { name: "データワークスペース" })).toBeVisible();

    const addButton = page.getByRole("button", { name: "データを追加" });
    await addButton.click();
    await expect(page.getByRole("heading", { name: "データを追加" })).toBeVisible();

    await page.getByRole("button", { name: "閉じる" }).click();

    await expect(page.getByRole("heading", { name: "データを追加" })).toHaveCount(0);
    await expect(page.locator(".hyakkei-source-card")).toHaveCount(1);
    await expect(page.getByRole("heading", { name: "データワークスペース" })).toBeVisible();
    await expect(addButton).toBeFocused();
  });

  // Post-implementation-review finding (ADR-0010's correction note): a
  // `data-layer-load` failure was originally assumed reachable with
  // sources already registered (motivating a discard-confirmation gate,
  // since removed) -- an architecture check proved it is not.
  // `loadDataLayer()` (data-layer.ts) memoizes permanently on success and
  // is never re-attempted after that, and the only way any source gets
  // registered at all is through a code path that already awaited it
  // successfully. This proves the premise directly: forcing the SAME
  // abort that fails a fresh page's data-layer load has no effect once a
  // source already exists -- the panel's OWN registration attempt (reusing
  // the already-resolved, cached layer) still succeeds.
  test("once a source is registered, a later data-layer chunk 'failure' no longer affects new registrations -- loadDataLayer()'s cache is permanent", async ({
    page,
  }) => {
    await registerFirstSourceAndOpenPanel(page);
    await page.route("**/assets/*.js", (route) => route.abort("failed"));
    await registerSecondSourceViaPanel(page);

    await expect(page.getByRole("heading", { name: "データを追加" })).toHaveCount(0);
    await expect(page.locator(".hyakkei-source-card")).toHaveCount(2);
    await expect(page.getByRole("alert")).toHaveCount(0);
  });
});

// issue #11b: column type detection UI + manual override, driving the
// real TRY_CAST-based validation/preview loop against actual DuckDB-WASM --
// none of this (real cast semantics, real HUGEINT-vs-plain-number surfacing,
// real DuckDB error text) is observable from a mocked/unit test.
test.describe("editor shell: column type override (issue 11b)", () => {
  const MIXED_CSV = Buffer.from(
    "name,amount,age\nAlice,1200,30\nBob,999,25\nCarol,非公開,40\n",
    "utf-8",
  );
  // A genuinely-empty cell (Bob's amount), distinct from a non-null but
  // uncastable one (Carol's) -- DuckDB's CSV reader parses an empty field
  // as NULL by default.
  const NULL_VS_UNCASTABLE_CSV = Buffer.from(
    "name,amount\nAlice,1200\nBob,\nCarol,非公開\n",
    "utf-8",
  );

  test("a mixed-content column auto-detects as 文字, and overriding it to 数値 surfaces the exact uncastable count with a trust-anchor warning (V-001/V-002/V-003)", async ({
    page,
  }) => {
    await page.locator('input[type="file"]').setInputFiles({
      name: "mixed.csv",
      mimeType: "text/csv",
      buffer: MIXED_CSV,
    });
    await expect(page.getByRole("heading", { name: "データワークスペース" })).toBeVisible();

    const amountSelect = page.getByLabel("「amount」の種類");
    await expect(amountSelect).toHaveValue("text");

    await amountSelect.selectOption("number");

    const warning = page.getByRole("status").filter({ hasText: "amount" });
    await expect(warning).toBeVisible();
    await expect(warning).toContainText("1件");
    await expect(warning).toContainText("非公開");
    // Trust anchor (T3/errorCopy.ts precedent): the user's underlying CSV
    // was never touched by this override -- must never look like data loss.
    await expect(warning).toContainText("元のファイルは変更されません");

    // The failed cell keeps its original raw value visible (not blanked),
    // marked non-color-dependently (WCAG 1.4.1).
    const failedCell = page.locator("td", { hasText: "非公開" });
    await expect(failedCell).toBeVisible();
    await expect(failedCell).toContainText("⚠");
  });

  test("overriding a clean numeric column to 文字 (VARCHAR) succeeds with zero uncastable values -- documented as expected, not a bug (Codex review finding)", async ({
    page,
  }) => {
    await page.locator('input[type="file"]').setInputFiles({
      name: "mixed.csv",
      mimeType: "text/csv",
      buffer: MIXED_CSV,
    });
    await expect(page.getByRole("heading", { name: "データワークスペース" })).toBeVisible();

    const ageSelect = page.getByLabel("「age」の種類");
    await expect(ageSelect).toHaveValue("number");
    await ageSelect.selectOption("text");

    // No warning region should appear for this column at all -- CAST AS
    // VARCHAR cannot fail on any value.
    await expect(page.getByRole("status").filter({ hasText: "age" })).toHaveCount(0);
    await expect(page.locator("td", { hasText: "⚠" })).toHaveCount(0);
  });

  test("deleting a source and re-registering the identical file resets the column-type UI to fresh auto-detection -- no stale override/warning survives (V-004/V-021)", async ({
    page,
  }) => {
    await page.locator('input[type="file"]').setInputFiles({
      name: "mixed.csv",
      mimeType: "text/csv",
      buffer: MIXED_CSV,
    });
    await expect(page.getByRole("heading", { name: "データワークスペース" })).toBeVisible();

    await page.getByLabel("「amount」の種類").selectOption("number");
    await expect(page.getByRole("status").filter({ hasText: "amount" })).toBeVisible();

    await page.getByRole("button", { name: "「mixed.csv」を削除" }).click();
    await expect(page.getByRole("heading", { name: "データ取り込み" })).toBeVisible();

    await page.locator('input[type="file"]').setInputFiles({
      name: "mixed.csv",
      mimeType: "text/csv",
      buffer: MIXED_CSV,
    });
    await expect(page.getByRole("heading", { name: "データワークスペース" })).toBeVisible();

    await expect(page.getByLabel("「amount」の種類")).toHaveValue("text");
    await expect(page.getByRole("status").filter({ hasText: "amount" })).toHaveCount(0);
    await expect(page.locator("td", { hasText: "⚠" })).toHaveCount(0);
  });

  // Codex review R1/R2 (P1 preview race): overriding two DIFFERENT columns
  // in close succession each kicks off their own validation + whole-row
  // preview refresh -- whichever is issued LAST is not necessarily the one
  // that resolves last. Fired via Promise.all (not sequential awaits) so
  // both onChange handlers actually overlap in-flight, rather than the
  // second only starting once the first has fully settled.
  test("overriding two different columns in quick succession applies BOTH overrides to the final preview, neither clobbering the other (Codex review R1/R2: preview race)", async ({
    page,
  }) => {
    await page.locator('input[type="file"]').setInputFiles({
      name: "mixed.csv",
      mimeType: "text/csv",
      buffer: MIXED_CSV,
    });
    await expect(page.getByRole("heading", { name: "データワークスペース" })).toBeVisible();

    await Promise.all([
      page.getByLabel("「amount」の種類").selectOption("number"),
      page.getByLabel("「age」の種類").selectOption("text"),
    ]);

    // Both selects reflect their own override, regardless of which
    // validation/preview round-trip happened to resolve first.
    await expect(page.getByLabel("「amount」の種類")).toHaveValue("number");
    await expect(page.getByLabel("「age」の種類")).toHaveValue("text");

    // "amount"'s warning (its one uncastable value) must still appear --
    // proves the FINAL preview reflects amount's override, not just its
    // own validation query in isolation.
    const amountWarning = page.getByRole("status").filter({ hasText: "amount" });
    await expect(amountWarning).toBeVisible();
    await expect(amountWarning).toContainText("1件");
    // "age" (cast to text) never fails, so no warning for it and no ⚠ in
    // its own column -- proves "age"'s override also landed in the SAME
    // final preview, not overwritten back to its pre-override state by
    // "amount"'s refresh (or vice versa).
    await expect(page.getByRole("status").filter({ hasText: "age" })).toHaveCount(0);

    // Codex review (Phase 6-B): the assertions above are all about
    // VALIDATION state, which is set independently of `previewRows` --
    // they would all still pass even if the actual rendered PREVIEW had
    // gone stale from the race (e.g. reverted to showing "amount" as if
    // never overridden). Assert the preview table itself: "amount"'s
    // failed cell must still show the raw value + ⚠ marker, and "age"
    // (now cast to text) must render left-aligned like a text column, not
    // still right-aligned as a number.
    const failedCell = page.locator("td", { hasText: "非公開" });
    await expect(failedCell).toContainText("⚠");
    // Scoped to this card's own table (see the V-002 test below for why an
    // unscoped `tbody tr` locator risks matching DashboardPreview's own
    // accessible-fallback table instead, in the same workspace DOM).
    const ageCells = page.locator(".hyakkei-source-card table tbody tr td:nth-child(3)");
    await expect(ageCells.first()).toHaveCSS("text-align", "left");
  });

  // Codex review (Phase 6-B): neither the unit tests (string-match the SQL
  // text only, never execute it) nor the other e2e tests above (whose
  // fixture has no genuinely-empty cell) actually prove V-002 end-to-end
  // against real DuckDB semantics: a genuinely-NULL original value must
  // never be counted as (or displayed as) a cast failure, distinct from a
  // non-null value that really does fail TRY_CAST.
  test("a genuinely-empty cell is never counted or displayed as a cast failure, distinct from a non-null value that really fails TRY_CAST (V-002)", async ({
    page,
  }) => {
    await page.locator('input[type="file"]').setInputFiles({
      name: "null-vs-uncastable.csv",
      mimeType: "text/csv",
      buffer: NULL_VS_UNCASTABLE_CSV,
    });
    await expect(page.getByRole("heading", { name: "データワークスペース" })).toBeVisible();

    await page.getByLabel("「amount」の種類").selectOption("number");

    // Exactly 1 -- if the empty cell were miscounted as uncastable
    // (e.g. `COUNT(*)` instead of `COUNT(col)`), this would read 2.
    const warning = page.getByRole("status").filter({ hasText: "amount" });
    await expect(warning).toContainText("1件");
    await expect(warning).not.toContainText("2件");

    // Carol's genuinely-uncastable cell: raw value + ⚠.
    await expect(page.locator("td", { hasText: "非公開" })).toContainText("⚠");
    // Bob's genuinely-empty cell: renders empty, with NO ⚠ marker -- proves
    // it was never treated as a cast failure. Scoped to this card's own
    // table (`.hyakkei-source-card`), not an unscoped `tbody tr`: the
    // workspace also has DashboardPreview's own accessible-fallback
    // `<table>` (the sample dashboard) in the same DOM, which an unscoped
    // locator would silently match instead (caught empirically -- an
    // earlier version of this assertion matched the sample's own "90" cell).
    const rows = page.locator(".hyakkei-source-card table tbody tr");
    const bobAmountCell = rows.nth(1).locator("td").nth(1);
    await expect(bobAmountCell).toHaveText("");
  });

  // /code-review Angle D (confirmed, follow-up fix): TRY_CAST succeeding is
  // not the same as preserving the exact value -- a 17-digit id overridden
  // to 数値 rounds silently past DOUBLE's 53-bit exact integer range, with
  // `uncastable_count` staying 0 the whole time. Real DuckDB-WASM only
  // (`buildNumberPrecisionCheckSql`'s unit tests string-match the SQL text,
  // never execute it).
  test("overriding a long integer-like id column to 数値 surfaces a precision-loss advisory, distinct from the uncastable-count warning (/code-review Angle D)", async ({
    page,
  }) => {
    await page.locator('input[type="file"]').setInputFiles({
      name: "precision.csv",
      mimeType: "text/csv",
      buffer: Buffer.from("name,national_id\nAlice,12345678901234567\nBob,42\n", "utf-8"),
    });
    await expect(page.getByRole("heading", { name: "データワークスペース" })).toBeVisible();

    await page.getByLabel("「national_id」の種類").selectOption("number");

    const advisory = page.getByRole("status").filter({ hasText: "精度が失われる可能性があります" });
    await expect(advisory).toBeVisible();
    await expect(advisory).toContainText("1件");
    // No uncastable-count warning: both values DO cast successfully -- the
    // advisory is an orthogonal axis, not a re-labeled uncastable count.
    await expect(page.getByRole("status").filter({ hasText: "変換不可" })).toHaveCount(0);
  });

  // QA finding (2026-07-22, live DuckDB-WASM run): the first version of
  // `buildNumberPrecisionCheckSql` flagged an ORDINARY decimal amount like
  // `1200.5` as precision-lossy, purely because `TRY_CAST('1200.5' AS
  // HUGEINT)` rounds ties in the OPPOSITE direction from the DOUBLE-cast
  // path -- despite `1200.5` losing nothing as a DOUBLE. Real DuckDB-WASM
  // only, on exactly the realistic content (mixed money/amount columns)
  // this feature's own headline scenario involves.
  test("overriding a decimal amount column to 数値 does not raise a false precision-loss advisory (QA finding: HUGEINT tie-rounding mismatch)", async ({
    page,
  }) => {
    await page.locator('input[type="file"]').setInputFiles({
      name: "decimals.csv",
      mimeType: "text/csv",
      buffer: Buffer.from("name,amount\nAlice,1200.5\nBob,999.99\nCarol,非公開\n", "utf-8"),
    });
    await expect(page.getByRole("heading", { name: "データワークスペース" })).toBeVisible();
    await expect(page.getByLabel("「amount」の種類")).toHaveValue("text");

    await page.getByLabel("「amount」の種類").selectOption("number");

    // The uncastable-count warning for "非公開" is expected (1件) --
    // decimals are not being asserted as uncastable, only as NOT
    // precision-lossy.
    const warning = page.getByRole("status").filter({ hasText: "amount" });
    await expect(warning).toContainText("1件");
    await expect(warning).not.toContainText("精度が失われる可能性があります");
  });

  // Sibling risk to RR-1 (date field-order misinterpretation, ADR-0011) but
  // a distinct, deterministic mechanism: TRY_CAST AS DATE discards any
  // embedded UTC offset without normalizing to it first. Mixed with a
  // non-date sentinel (same trick as MIXED_CSV's "非公開") so the column
  // auto-detects as 文字, not 日付 -- a column DuckDB's own CSV sniffer
  // already parses as a native TIMESTAMP has already lost any offset at
  // ingest time, before this override step runs at all (a real, distinct
  // limitation `buildDateOffsetCheckSql`'s own doc comment records; a real
  // PoC run against exactly that shape is what first surfaced the
  // `CAST(... AS VARCHAR)` fix this builder now applies).
  test("overriding a timestamp-with-offset text column to 日付 surfaces a timezone-discarded advisory (/code-review Angle D)", async ({
    page,
  }) => {
    await page.locator('input[type="file"]').setInputFiles({
      name: "offset.csv",
      mimeType: "text/csv",
      buffer: Buffer.from("name,logged_at\nAlice,2024-03-04T01:00:00+09:00\nBob,非公開\n", "utf-8"),
    });
    await expect(page.getByRole("heading", { name: "データワークスペース" })).toBeVisible();

    await expect(page.getByLabel("「logged_at」の種類")).toHaveValue("text");
    await page.getByLabel("「logged_at」の種類").selectOption("date");

    const advisory = page
      .getByRole("status")
      .filter({ hasText: "タイムゾーン情報が含まれていました" });
    await expect(advisory).toBeVisible();
    await expect(advisory).toContainText("1件");
  });

  // Edge case the fix above (CAST AS VARCHAR) exists for: overriding a
  // column DuckDB's OWN CSV sniffer already parsed as a native
  // TIMESTAMP/DATE type must not crash the validation query outright, even
  // though no NEW offset-discarding can be detected at this stage (it
  // already happened at ingest, invisibly, before any override UI exists).
  test("overriding an already-date-typed column to 日付 again does not crash validation, even for a value that originally had a UTC offset", async ({
    page,
  }) => {
    await page.locator('input[type="file"]').setInputFiles({
      name: "already-date.csv",
      mimeType: "text/csv",
      buffer: Buffer.from(
        "name,logged_at\nAlice,2024-03-04T01:00:00+09:00\nBob,2024-03-04\n",
        "utf-8",
      ),
    });
    await expect(page.getByRole("heading", { name: "データワークスペース" })).toBeVisible();
    const select = page.getByLabel("「logged_at」の種類");
    await expect(select).toHaveValue("date");

    // Round-trips through "text" first (selecting the value a native
    // <select> is already showing does not reliably fire a change event) so
    // the override to "date" genuinely re-triggers validation against this
    // already-native-TIMESTAMP column.
    await select.selectOption("text");
    await select.selectOption("date");

    await expect(page.getByRole("status").filter({ hasText: "検証に失敗しました" })).toHaveCount(0);
  });
});
