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

    await page
      .locator(".hyakkei-chart-card")
      .first()
      .getByRole("button", { name: /のグラフを削除/ })
      .click();

    await expect(grid.locator(".hyakkei-chart-canvas")).toHaveCount(1);
    await expect(grid.locator(".hyakkei-error-tile")).toHaveCount(0);
  });

  test("deleting the only chart returns to the static sample dashboard", async ({ page }) => {
    await setUpAggregatedQuery(page);
    await page.getByRole("button", { name: GRAPH_BUTTON }).click();
    await expect(gridPreview(page)).toBeVisible();

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
