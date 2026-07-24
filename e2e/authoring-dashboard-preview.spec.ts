import { join } from "node:path";
import { expect, test } from "@playwright/test";

// issue #70 + #12(B): the unified dashboard-grid preview (AuthoringDashboardPreview.tsx)
// is the first real multi-chart consumer of mount.ts's patch() differential-update
// path. Real DuckDB-WASM, real ECharts, real browser -- the diffing algorithm itself
// is thoroughly unit-tested (packages/core/src/renderer/mount.test.ts's own
// describe("patch()") block, V-001 through V-022); this suite exercises the
// app-level wiring (App.tsx state -> AuthoringDashboardPreview props -> patch())
// that a headless unit test can't observe.
const FIXTURES_DIR = join(import.meta.dirname, "..", "spikes", "excel-fidelity", "fixtures");
const fixturePath = (name: string) => join(FIXTURES_DIR, name);

test.beforeEach(async ({ page }) => {
  await page.goto("/index.html", { waitUntil: "domcontentloaded" });
});

async function setUpAggregatedQuery(page: import("@playwright/test").Page): Promise<void> {
  await page.locator('input[type="file"]').setInputFiles(fixturePath("06-shift_jis.csv"));
  await expect(page.getByRole("heading", { name: "データワークスペース" })).toBeVisible();
  await page.getByRole("button", { name: "「06-shift_jis.csv」を集計" }).click();

  await page.getByRole("button", { name: "＋ 単位を追加" }).click();
  await page.getByRole("button", { name: "＋ 値を追加" }).click();
  await page.getByLabel("集計する値1: 列").selectOption("件数");
  await page.getByLabel("集計する値1: 集計方法").selectOption("sum");
  await expect(page.locator(".hyakkei-query-card tbody tr")).toHaveCount(2);
}

const GRAPH_BUTTON = "「06-shift_jis.csv」の集計をグラフ化";

/** Scopes to the (B) grid preview specifically, distinct from any (A) ChartBuilder per-card preview showing the same underlying chart. */
function gridPreview(page: import("@playwright/test").Page) {
  return page.locator(".hyakkei-authoring-dashboard-preview");
}

/**
 * `boundingBox()` returns viewport-relative coordinates -- with 3+ charts
 * (two 6-wide tiles per 12-col row), the third tile wraps to a second row
 * that can sit below the default viewport's fold. Raw `page.mouse.*` calls
 * (unlike `locator.click()`) never auto-scroll, so a handle's bounding box
 * computed while it's off-screen produces coordinates a real mouse can't
 * usefully target. Scroll first, then measure.
 */
async function scrolledBoundingBox(locator: import("@playwright/test").Locator) {
  await locator.scrollIntoViewIfNeeded();
  const box = await locator.boundingBox();
  if (!box) throw new Error("bounding box not available after scrollIntoViewIfNeeded");
  return box;
}

test.describe("editor shell: unified dashboard-grid preview (issue #70/#12(B))", () => {
  test("0 charts shows the static sample; the first real chart replaces it with a live grid showing real data", async ({
    page,
  }) => {
    await setUpAggregatedQuery(page);
    await expect(
      page.getByText("サンプル表示です。取り込んだデータではありません。"),
    ).toBeVisible();

    await page.getByRole("button", { name: GRAPH_BUTTON }).click();

    await expect(page.getByText("サンプル表示です。取り込んだデータではありません。")).toHaveCount(
      0,
    );
    const grid = gridPreview(page);
    await expect(grid).toBeVisible();
    await expect(grid.locator(".hyakkei-chart-canvas")).toHaveCount(1);
    await expect(grid.locator(".hyakkei-error-tile")).toHaveCount(0);
    // Phase 6-B (Codex adversarial test review, Medium finding): a canvas
    // count alone is satisfiable by an empty/zero-size ECharts instance --
    // assert the ACTUAL aggregated values reached the chart (via its
    // accessible-fallback table, real DOM text) and that ECharts genuinely
    // measured and rendered into a non-empty box (real pixel geometry, not
    // jsdom's structural-only check).
    await expect(grid).toContainText("住民課");
    await expect(grid).toContainText("税務課");
    const box = await grid.locator(".hyakkei-chart-canvas").boundingBox();
    expect(box?.width).toBeGreaterThan(0);
    expect(box?.height).toBeGreaterThan(0);
  });

  test("a second chart on the same query appears alongside the first in the SAME grid, both showing real data", async ({
    page,
  }) => {
    await setUpAggregatedQuery(page);
    await page.getByRole("button", { name: GRAPH_BUTTON }).click();
    await page.getByRole("button", { name: GRAPH_BUTTON }).click();

    const grid = gridPreview(page);
    await expect(grid.locator(".hyakkei-chart-canvas")).toHaveCount(2);
    await expect(grid.locator(".hyakkei-error-tile")).toHaveCount(0);
    // Real aggregated values, not just non-empty canvases (see finding above).
    const tables = grid.locator(".hyakkei-accessible-data-table");
    await expect(tables).toHaveCount(2);
    for (let i = 0; i < 2; i++) {
      await expect(tables.nth(i)).toContainText("住民課");
      await expect(tables.nth(i)).toContainText("税務課");
    }
  });

  test("switching one chart's type in its (A) card updates only that tile in the (B) grid, the sibling chart's data is untouched", async ({
    page,
  }) => {
    await setUpAggregatedQuery(page);
    await page.getByRole("button", { name: GRAPH_BUTTON }).click();
    await page.getByRole("button", { name: GRAPH_BUTTON }).click();
    const grid = gridPreview(page);
    await expect(grid.locator(".hyakkei-chart-canvas")).toHaveCount(2);

    // Switch the FIRST (A) card's type to table -- this exercises the grid's
    // own kind-change (ECharts -> DOM) branch for exactly one tile.
    const firstCard = page.locator(".hyakkei-chart-card").first();
    await firstCard.getByRole("button", { name: "表" }).click();

    // The grid still has 2 tiles total (nothing added/removed), but only 1
    // canvas now (the switched chart became a table tile, DOM not ECharts),
    // and the untouched chart's real data is still correct -- proof the
    // diff didn't disturb its sibling. (`table` alone is ambiguous here --
    // every "ok" tile, canvas or table, also carries its own accessible-
    // fallback `<table>`, so counting `<table>` elements conflates the two.)
    await expect(grid.locator(".hyakkei-tile")).toHaveCount(2);
    await expect(grid.locator(".hyakkei-chart-canvas")).toHaveCount(1);
    await expect(grid).toContainText("住民課");
    await expect(grid).toContainText("税務課");
    await expect(grid.locator(".hyakkei-error-tile")).toHaveCount(0);
  });

  test("deleting one chart removes only its tile from the grid, the sibling chart remains with its real data", async ({
    page,
  }) => {
    await setUpAggregatedQuery(page);
    await page.getByRole("button", { name: GRAPH_BUTTON }).click();
    await page.getByRole("button", { name: GRAPH_BUTTON }).click();
    const grid = gridPreview(page);
    await expect(grid.locator(".hyakkei-chart-canvas")).toHaveCount(2);

    // issue #102: 2 charts on the same query -> both get a disambiguating
    // ordinal, so the first card's own delete label is now "...グラフ1を削除".
    page.on("dialog", (d) => d.accept());
    await page
      .locator(".hyakkei-chart-card")
      .first()
      .getByRole("button", { name: "「06-shift_jis.csv」のグラフ1を削除" })
      .click();

    await expect(grid.locator(".hyakkei-chart-canvas")).toHaveCount(1);
    await expect(grid.locator(".hyakkei-error-tile")).toHaveCount(0);
  });

  test("deleting the only chart returns to the static sample dashboard", async ({ page }) => {
    await setUpAggregatedQuery(page);
    await page.getByRole("button", { name: GRAPH_BUTTON }).click();
    await expect(gridPreview(page)).toBeVisible();

    // Single chart -> no ordinal, label unchanged from pre-#102.
    page.on("dialog", (d) => d.accept());
    await page
      .locator(".hyakkei-chart-card")
      .getByRole("button", { name: /のグラフを削除/ })
      .click();

    await expect(
      page.getByText("サンプル表示です。取り込んだデータではありません。"),
    ).toBeVisible();
    await expect(page.getByRole("button", { name: "配置ビューを再構築" })).toHaveCount(0);
  });

  test("the manual reset button rebuilds the grid from scratch without breaking it", async ({
    page,
  }) => {
    await setUpAggregatedQuery(page);
    await page.getByRole("button", { name: GRAPH_BUTTON }).click();
    const grid = gridPreview(page);
    await expect(grid.locator(".hyakkei-chart-canvas")).toHaveCount(1);

    await page.getByRole("button", { name: "配置ビューを再構築" }).click();

    await expect(grid.locator(".hyakkei-chart-canvas")).toHaveCount(1);
    await expect(grid.locator(".hyakkei-error-tile")).toHaveCount(0);
    // Phase 8 (Codex/QA fan-out, Major finding): the reset button's whole
    // reason to exist is confirming a rebuild to a user who suspects a
    // silent-wrong render -- a real browser click, not just the mocked
    // unit test, must actually surface the confirmation text.
    await expect(grid.getByText("配置ビューを再構築しました。")).toBeVisible();
  });
});

// issue #14 (grid layout editor, F5, drag reorder): pointer drag hit-testing
// depends on real layout geometry (getBoundingClientRect()) that jsdom never
// computes -- packages/app/src/chart/AuthoringDashboardPreview.test.tsx and
// packages/app/src/chart/layout-reorder.test.ts cover the reducer/component
// wiring; this suite is the only place the pointer/keyboard interaction
// itself is exercised at all.
test.describe("editor shell: grid layout editor drag reorder (issue #14)", () => {
  test("the edit toggle is disabled with a reason when fewer than 2 charts exist", async ({
    page,
  }) => {
    await setUpAggregatedQuery(page);
    await page.getByRole("button", { name: GRAPH_BUTTON }).click();

    const toggle = page.getByRole("button", { name: "並び順を編集" });
    await expect(toggle).toBeDisabled();
    await expect(toggle).toHaveAttribute("title", "並び替えるにはグラフが2つ以上必要です");
  });

  test("entering edit mode announces the operating instructions once and shows move controls per tile", async ({
    page,
  }) => {
    await setUpAggregatedQuery(page);
    await page.getByRole("button", { name: GRAPH_BUTTON }).click();
    await page.getByRole("button", { name: GRAPH_BUTTON }).click();

    const toggle = page.getByRole("button", { name: "並び順を編集" });
    await expect(toggle).toBeEnabled();
    await toggle.click();

    // Multiple `role="status"` regions coexist on this page (chart-add
    // announcement, CSV row-count status, this one) -- matching by exact
    // text, not role alone, same convention as this file's existing
    // "配置ビューを再構築しました。" assertion.
    await expect(page.getByText("並び順編集モードに入りました。")).toBeVisible();
    const grid = gridPreview(page);
    await expect(grid.getByRole("button", { name: "前へ移動" })).toHaveCount(2);
    await expect(grid.getByRole("button", { name: "後ろへ移動" })).toHaveCount(2);
    // First tile can't move earlier, last tile can't move later.
    await expect(grid.getByRole("button", { name: "前へ移動" }).first()).toBeDisabled();
    await expect(grid.getByRole("button", { name: "後ろへ移動" }).last()).toBeDisabled();
  });

  // Codex R1 finding (P1, fixed): the overlay's `position: relative` used to
  // live on the SAME padded (`padding: 8`) element as the real core-rendered
  // grid, so the overlay's `inset: 0` resolved 8px further out on every side
  // than the real grid's content box -- the two grids only look aligned by
  // coincidence at zero padding. This pins real, measured geometry (not a
  // mocked patch()) so the regression can't silently reappear.
  test("the edit overlay's per-tile controls line up with the real rendered tile underneath (no padding-offset drift)", async ({
    page,
  }) => {
    await setUpAggregatedQuery(page);
    await page.getByRole("button", { name: GRAPH_BUTTON }).click();
    await page.getByRole("button", { name: GRAPH_BUTTON }).click();
    await page.getByRole("button", { name: "並び順を編集" }).click();

    const grid = gridPreview(page);
    const tiles = grid.locator(".hyakkei-tile");
    const controlGroups = grid.locator("[data-layout-item-chart-id]");
    await expect(tiles).toHaveCount(2);
    await expect(controlGroups).toHaveCount(2);

    for (let i = 0; i < 2; i++) {
      const tileBox = await tiles.nth(i).boundingBox();
      const groupBox = await controlGroups.nth(i).boundingBox();
      if (!tileBox || !groupBox) throw new Error("bounding box not available");
      // The control group is styled `top: 4, left: 4` within its slot, which
      // must be the SAME slot the real tile occupies -- an 8px padding
      // offset bug would put this delta at 12 instead of 4.
      expect(Math.abs(groupBox.x - tileBox.x - 4)).toBeLessThan(2);
      expect(Math.abs(groupBox.y - tileBox.y - 4)).toBeLessThan(2);
    }
  });

  test("clicking 「後ろへ」 moves the first tile after the second, announces the result, and moves focus to it", async ({
    page,
  }) => {
    await setUpAggregatedQuery(page);
    await page.getByRole("button", { name: GRAPH_BUTTON }).click();
    await page.getByRole("button", { name: GRAPH_BUTTON }).click();
    await page.getByRole("button", { name: "並び順を編集" }).click();

    const grid = gridPreview(page);
    const firstChartId = await grid
      .locator("[data-layout-item-chart-id]")
      .first()
      .getAttribute("data-layout-item-chart-id");

    await grid.getByRole("button", { name: "後ろへ移動" }).first().click();

    await expect(page.getByText(/グラフの並び順を変更しました/)).toBeVisible();
    // Focus follows the MOVED CHART (its group container, tabIndex=-1) --
    // not the index slot it used to occupy -- to the tile's new position.
    await expect(page.locator(`[data-layout-item-chart-id="${firstChartId}"]`)).toBeFocused();
    await expect(grid.locator("[data-layout-item-chart-id]").last()).toHaveAttribute(
      "data-layout-item-chart-id",
      firstChartId ?? "",
    );
  });

  // Phase 8 QA finding (V-004): App.tsx's handleReorderLayout reads
  // `layoutRef.current` (a synchronous mirror kept current inside
  // `updateLayout` itself), not the possibly-batched `layout` state -- this
  // pins that the second of two rapid calls sees the first move's result,
  // not a stale pre-move order.
  test("clicking 「後ろへ」 twice in rapid succession on the same tile applies BOTH moves, not a stale single one", async ({
    page,
  }) => {
    await setUpAggregatedQuery(page);
    await page.getByRole("button", { name: GRAPH_BUTTON }).click();
    await page.getByRole("button", { name: GRAPH_BUTTON }).click();
    await page.getByRole("button", { name: GRAPH_BUTTON }).click();
    await page.getByRole("button", { name: "並び順を編集" }).click();

    const grid = gridPreview(page);
    const slots = grid.locator("[data-layout-item-chart-id]");
    await expect(slots).toHaveCount(3);
    const firstChartId = await slots.first().getAttribute("data-layout-item-chart-id");

    // Scoped by the chart's own stable id (not position), so the same
    // locator still resolves to the same chart's own button after the first
    // click repositions it in the DOM.
    const moveBack = grid
      .locator(`[data-layout-item-chart-id="${firstChartId}"]`)
      .getByRole("button", { name: "後ろへ移動" });
    await moveBack.click();
    await moveBack.click();

    // Two single-step "back" moves from index 0 land at index 2 (last), not
    // index 1 -- a stale/lost second move would leave it at index 1 instead.
    await expect(slots.last()).toHaveAttribute("data-layout-item-chart-id", firstChartId ?? "");
  });

  test("keyboard-only operation: Tab to a move button and activate it with Enter reorders exactly like a click", async ({
    page,
    browserName,
  }) => {
    await setUpAggregatedQuery(page);
    await page.getByRole("button", { name: GRAPH_BUTTON }).click();
    await page.getByRole("button", { name: GRAPH_BUTTON }).click();

    const toggle = page.getByRole("button", { name: "並び順を編集" });
    await toggle.focus();
    await toggle.press("Enter");

    const grid = gridPreview(page);
    const slots = grid.locator("[data-layout-item-chart-id]");
    const firstChartId = await slots.first().getAttribute("data-layout-item-chart-id");

    if (browserName === "webkit") {
      // Playwright's WebKit does not advance focus to <button> elements on
      // Tab at all -- verified in isolation with a bare 3-plain-button page
      // (no app code involved): pressing Tab from a focused button lands
      // nowhere. This mirrors real Safari's default ("Full Keyboard Access"
      // off), a known engine/driver limitation, not a defect in these
      // buttons (they carry no tabIndex override and Tab-traverse normally
      // in chromium/firefox, asserted below). Fall back to proving the
      // Enter-activation half of WCAG 2.1.1 via direct focus instead of
      // asserting a Tab hop this engine cannot perform.
      await grid.getByRole("button", { name: "前へ移動" }).nth(1).focus();
    } else {
      // Codex 6-B (test adversarial review, false-confidence finding): reach
      // the second tile's "前へ" purely by repeated real Tab presses from the
      // already-focused toggle -- not `.focus()` -- so this actually proves
      // Tab-reachability (WCAG 2.1.1), not just that the element CAN accept
      // programmatic focus. Bounded, not an exact tab-count, so it doesn't
      // break if unrelated focusable elements are added/removed upstream.
      let reached = false;
      for (let i = 0; i < 20; i++) {
        await page.keyboard.press("Tab");
        const label = await page.evaluate(() => document.activeElement?.getAttribute("aria-label"));
        if (label === "前へ移動") {
          reached = true;
          break;
        }
      }
      expect(reached).toBe(true);
    }
    // The second tile's own "前へ" is reached first when Tabbing forward
    // from the toggle (first tile's "前へ" is disabled and not focusable
    // via Tab in the same sense -- disabled buttons are skipped).
    await page.keyboard.press("Enter");

    await expect(page.getByText(/グラフの並び順を変更しました/)).toBeVisible();
    await expect(slots).toHaveCount(2); // still exactly 2 tiles, nothing crashed
    // The move actually changed the order (not a no-op): the tile that used
    // to be first is no longer first.
    await expect(slots.first()).not.toHaveAttribute(
      "data-layout-item-chart-id",
      firstChartId ?? "",
    );
  });

  test("real pointer drag: dragging the first tile's handle past the second reorders them", async ({
    page,
  }) => {
    await setUpAggregatedQuery(page);
    await page.getByRole("button", { name: GRAPH_BUTTON }).click();
    await page.getByRole("button", { name: GRAPH_BUTTON }).click();
    await page.getByRole("button", { name: "並び順を編集" }).click();

    const grid = gridPreview(page);
    const slots = grid.locator("[data-layout-item-chart-id]");
    const firstChartId = await slots.first().getAttribute("data-layout-item-chart-id");
    const handles = grid.locator('span[aria-hidden="true"]');
    const src = await scrolledBoundingBox(handles.first());
    const dst = await scrolledBoundingBox(handles.nth(1));

    await page.mouse.move(src.x + src.width / 2, src.y + src.height / 2);
    await page.mouse.down();
    await page.mouse.move(dst.x + dst.width / 2, dst.y + dst.height / 2, { steps: 10 });
    await page.mouse.up();

    await expect(page.getByText(/グラフの並び順を変更しました/)).toBeVisible();
    await expect(slots.last()).toHaveAttribute("data-layout-item-chart-id", firstChartId ?? "");
  });

  // Codex 6-B (test adversarial review, blind spot) -- investigated via a
  // debug reproduction, not assumed: a native `window.confirm()` dialog
  // (issue #102's delete confirmation) implicitly releases any active
  // pointer capture as soon as it opens (verified directly: `beginDrag`
  // fires and captures the pointer, but a `confirm()` triggered mid-drag
  // fires `lostpointercapture` -- `cancelDrag` -- before the drag ever
  // completes; the SAME mouse-down+keyboard-delete sequence with NO dialog
  // in between behaves identically to a plain click, per an isolated
  // reproduction). A held drag can therefore never survive a delete
  // confirmation to complete with a "stale index" -- the browser itself
  // cancels the gesture first. This pins that ACTUAL behavior (clean
  // cancellation via the R1/P2 `onLostPointerCapture` fix, not a phantom
  // reorder from stale drag state) and that the component recovers to a
  // fully working state afterward, rather than asserting the originally
  // hypothesized "completes with a fresh index" outcome, which turned out
  // to be unreachable through this app's own UI (every delete path uses
  // `confirm()`).
  test("a delete confirmation opening mid-drag cancels the drag cleanly (no phantom reorder, no stuck state)", async ({
    page,
  }) => {
    await setUpAggregatedQuery(page);
    await page.getByRole("button", { name: GRAPH_BUTTON }).click();
    await page.getByRole("button", { name: GRAPH_BUTTON }).click();
    await page.getByRole("button", { name: GRAPH_BUTTON }).click();
    await page.getByRole("button", { name: "並び順を編集" }).click();

    const grid = gridPreview(page);
    const slots = grid.locator("[data-layout-item-chart-id]");
    await expect(slots).toHaveCount(3);
    const draggedChartId = await slots.nth(2).getAttribute("data-layout-item-chart-id");
    const survivorChartId = await slots.nth(1).getAttribute("data-layout-item-chart-id");

    // 3 charts wrap to a second row (two 6-wide tiles per 12-col row) --
    // the third tile's handle can sit below the default viewport fold, so
    // handles are explicitly scrolled into view before measuring.
    const handles = grid.locator('span[aria-hidden="true"]');
    const src = await scrolledBoundingBox(handles.nth(2));
    const dst = await scrolledBoundingBox(handles.nth(1));

    // Start dragging the LAST tile (mouse channel, held down).
    await page.mouse.move(src.x + src.width / 2, src.y + src.height / 2);
    await page.mouse.down();

    // While still mid-drag, delete the FIRST chart via keyboard (a
    // separate input channel from the held mouse button): focus its
    // already-rendered delete button and activate with Enter. The
    // resulting confirm() dialog cancels the pointer capture as a side
    // effect of the browser opening a native modal, not anything this
    // component does.
    page.on("dialog", (d) => d.accept());
    const firstCardDelete = page
      .locator(".hyakkei-chart-card")
      .first()
      .getByRole("button", { name: "「06-shift_jis.csv」のグラフ1を削除" });
    await firstCardDelete.focus();
    await page.keyboard.press("Enter");
    await expect(grid.locator(".hyakkei-chart-canvas")).toHaveCount(2);

    // Attempt to "complete" the drag anyway -- since the browser already
    // released capture when the dialog opened, this must be a harmless
    // no-op (no crash), not a phantom reorder using stale drag identities.
    await page.mouse.move(dst.x + dst.width / 2, dst.y + dst.height / 2, { steps: 10 });
    await page.mouse.up();

    // No reorder happened: deletion alone doesn't re-pack survivors, so the
    // two remaining charts keep their original relative order.
    await expect(slots).toHaveCount(2);
    await expect(slots.first()).toHaveAttribute("data-layout-item-chart-id", survivorChartId ?? "");
    await expect(slots.last()).toHaveAttribute("data-layout-item-chart-id", draggedChartId ?? "");

    // Not stuck: an ordinary button-based move (simpler and already proven
    // reliable elsewhere in this file) still works normally afterward --
    // this only needs to prove the component recovered, not re-exercise
    // pointer-drag mechanics a second time.
    await grid.getByRole("button", { name: "前へ移動" }).nth(1).click();
    await expect(page.getByText(/グラフの並び順を変更しました/)).toBeVisible();
    await expect(slots.first()).toHaveAttribute("data-layout-item-chart-id", draggedChartId ?? "");
  });

  test("deleting a chart, then re-entering edit mode with the survivor and a new chart works without a stale index", async ({
    page,
  }) => {
    await setUpAggregatedQuery(page);
    await page.getByRole("button", { name: GRAPH_BUTTON }).click();
    await page.getByRole("button", { name: GRAPH_BUTTON }).click();
    await page.getByRole("button", { name: "並び順を編集" }).click();

    // Leave edit mode, delete the first chart (gap-closing re-pack, issue
    // #14 plan §異サイズ混在時の連鎖リフロー), then confirm edit mode still
    // works cleanly on the reduced set.
    await page.getByRole("button", { name: "並び順を編集" }).click();
    page.on("dialog", (d) => d.accept());
    await page
      .locator(".hyakkei-chart-card")
      .first()
      .getByRole("button", { name: "「06-shift_jis.csv」のグラフ1を削除" })
      .click();

    const grid = gridPreview(page);
    await expect(grid.locator(".hyakkei-chart-canvas")).toHaveCount(1);
    // Only 1 chart now -- edit toggle disabled again.
    await expect(page.getByRole("button", { name: "並び順を編集" })).toBeDisabled();

    await page.getByRole("button", { name: GRAPH_BUTTON }).click();
    await expect(grid.locator(".hyakkei-chart-canvas")).toHaveCount(2);
    const toggle = page.getByRole("button", { name: "並び順を編集" });
    await expect(toggle).toBeEnabled();
    await toggle.click();
    await expect(grid.getByRole("button", { name: "前へ移動" })).toHaveCount(2);
  });
});
