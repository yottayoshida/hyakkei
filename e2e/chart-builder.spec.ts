import { join } from "node:path";
import { expect, test } from "@playwright/test";

// issue #12 (M2 chart builder, F3): drives the editor shell's "グラフ化"
// flow through actual clicks against real DuckDB-WASM, exercising the
// wiring (chart-row generation-guard, cascade delete, re-fetch chaining)
// that a headless/unit test can't observe -- same convention as
// e2e/intake-harness.spec.ts's "query builder" describe block, one layer up.
const FIXTURES_DIR = join(import.meta.dirname, "..", "spikes", "excel-fidelity", "fixtures");
const fixturePath = (name: string) => join(FIXTURES_DIR, name);

test.beforeEach(async ({ page }) => {
  await page.goto("/index.html", { waitUntil: "domcontentloaded" });
});

/** Registers `06-shift_jis.csv` and builds an aggregated query (部署 group-by + sum(件数)) -- same setup `intake-harness.spec.ts`'s own "group-by + sum measure" test uses, so this reaches the same known 2-row result (住民課: 45, 税務課: 30). */
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

test.describe("editor shell: chart builder (issue #12)", () => {
  test("グラフ化 opens a chart builder card as a sibling to the query card, and the default bar chart renders real data", async ({
    page,
  }) => {
    await setUpAggregatedQuery(page);
    await expect(page.locator(".hyakkei-chart-card")).toHaveCount(0);

    await page.getByRole("button", { name: GRAPH_BUTTON }).click();

    await expect(page.locator(".hyakkei-chart-card")).toHaveCount(1);
    await expect(page.locator(".hyakkei-chart-card .hyakkei-chart-canvas")).toBeVisible();
    await expect(page.locator(".hyakkei-chart-card .hyakkei-error-tile")).toHaveCount(0);
  });

  // UX review (Phase 8, Major finding C-3/C-6): "グラフ化" previously gave a
  // keyboard/screen-reader user no signal the operation happened, and no way
  // to reach the new card except tabbing past everything above it.
  test("グラフ化 announces the new chart and moves focus to its card", async ({ page }) => {
    await setUpAggregatedQuery(page);
    await page.getByRole("button", { name: GRAPH_BUTTON }).click();

    await expect(
      page.getByRole("status").filter({ hasText: "グラフを追加しました。" }),
    ).toBeVisible();
    await expect(page.locator(".hyakkei-chart-card")).toBeFocused();
  });

  test("グラフ化 is disabled until the underlying query has resolved", async ({ page }) => {
    await page.locator('input[type="file"]').setInputFiles(fixturePath("06-shift_jis.csv"));
    await expect(page.getByRole("heading", { name: "データワークスペース" })).toBeVisible();
    await page.getByRole("button", { name: "「06-shift_jis.csv」を集計" }).click();
    // Once the query's own (unfiltered) preview resolves, the button becomes enabled.
    await expect(page.locator(".hyakkei-query-card tbody tr").first()).toBeVisible();
    await expect(page.getByRole("button", { name: GRAPH_BUTTON })).toBeEnabled();
  });

  test("switching through all 7 chart types renders each without an error tile", async ({
    page,
  }) => {
    await setUpAggregatedQuery(page);
    await page.getByRole("button", { name: GRAPH_BUTTON }).click();
    const card = page.locator(".hyakkei-chart-card");

    for (const label of [
      "棒グラフ",
      "折れ線グラフ",
      "面グラフ",
      "散布図",
      "円グラフ",
      "ドーナツグラフ",
      "表",
      "単一の値",
    ]) {
      await card.getByRole("button", { name: label }).click();
      await expect(card.locator(".hyakkei-error-tile")).toHaveCount(0);
    }
    // The loop's last selection is "単一の値" (stat) -- a DOM-only tile, not a canvas.
    await expect(card.locator(".hyakkei-stat")).toBeVisible();
  });

  test("editing the underlying query (adding a filter) refreshes the chart's OWN rows too, not just the query preview (silent-stale prevention, this PR's core invariant)", async ({
    page,
  }) => {
    await setUpAggregatedQuery(page);
    await page.getByRole("button", { name: GRAPH_BUTTON }).click();
    await page.locator(".hyakkei-chart-card").getByRole("button", { name: "表" }).click();

    const card = page.locator(".hyakkei-chart-card");
    await expect(card).toContainText("住民課");
    await expect(card).toContainText("税務課");

    await page.getByRole("button", { name: "＋ 条件を追加" }).click();
    await page.getByLabel("条件1: 列").selectOption("部署");
    await page.getByLabel("条件1: 演算子").selectOption("eq");
    await page.getByLabel("条件1: 値").fill("住民課");
    await page.getByLabel("条件1: 値").press("Tab");

    await expect(page.locator(".hyakkei-query-card tbody tr")).toHaveCount(1);
    await expect(card).toContainText("住民課");
    await expect(card).not.toContainText("税務課");
  });

  test("changing a column's type-override ELSEWHERE (the source card, not the query/chart) refreshes an existing chart's rows too, not silently stale (Codex Round 1/2 convergent finding)", async ({
    page,
  }) => {
    await setUpAggregatedQuery(page);
    await page.getByRole("button", { name: GRAPH_BUTTON }).click();
    const card = page.locator(".hyakkei-chart-card");
    await card.getByRole("button", { name: "表" }).click();
    await expect(card).toContainText("住民課");
    await expect(card).toContainText("45"); // sum(件数) for 住民課, this fixture's known aggregate

    // Overriding 件数 away from 数値 makes the sum measure invalid; ADR-0012's
    // resolver silently excludes it from the query's own output columns, so
    // this chart's OWN (unchanged) encoding now names a column ("sum_件数")
    // its freshly-refetched rows no longer carry. The renderer's own
    // missing-column tile ("データに列が見つかりません") is the actual, and
    // arguably stronger, proof this PR's own thesis calls for: the chart
    // visibly reacted to the override (rows genuinely re-resolved) instead
    // of silently keeping the stale "住民課 45 / 税務課 30" table on screen.
    await page.getByLabel("「件数」の種類").selectOption("文字");

    await expect(card).toContainText("データに列が見つかりません");
    await expect(card).not.toContainText("45");
    await expect(card).not.toContainText("30");
  });

  test("rapid, overlapping query edits leave the chart showing the LAST edit's result, never a stale intermediate one (race safety)", async ({
    page,
  }) => {
    await setUpAggregatedQuery(page);
    await page.getByRole("button", { name: GRAPH_BUTTON }).click();
    const card = page.locator(".hyakkei-chart-card");
    await card.getByRole("button", { name: "表" }).click();
    await expect(card).toContainText("住民課");

    await page.getByRole("button", { name: "＋ 条件を追加" }).click();
    await page.getByLabel("条件1: 列").selectOption("部署");
    await page.getByLabel("条件1: 演算子").selectOption("eq");

    // Two rapid, overlapping edits to the SAME filter value -- fired without
    // awaiting the first's own DuckDB round-trip in between, so both
    // refreshQueryPreview calls (and, via the chaining trigger, both
    // refreshChartRows calls) genuinely overlap in-flight. Same technique
    // as intake-harness.spec.ts's own "overriding two different columns in
    // quick succession" race test (Codex R1/R2 precedent).
    await page.getByLabel("条件1: 値").fill("住民課");
    await page.getByLabel("条件1: 値").press("Tab");
    await page.getByLabel("条件1: 値").fill("税務課");
    await page.getByLabel("条件1: 値").press("Tab");

    await expect(page.locator(".hyakkei-query-card tbody tr")).toHaveCount(1);
    await expect(card).toContainText("税務課");
    await expect(card).not.toContainText("住民課");
  });

  test("deleting a chart directly removes only its own card, leaving a sibling chart on the SAME query intact with its real data still visible (V-014, Codex Round 2 strengthening)", async ({
    page,
  }) => {
    await setUpAggregatedQuery(page);
    await page.getByRole("button", { name: GRAPH_BUTTON }).click();
    await page.getByRole("button", { name: GRAPH_BUTTON }).click();
    await expect(page.locator(".hyakkei-chart-card")).toHaveCount(2);
    // Both to table -- their own rendered TEXT (not just "no error tile")
    // is what proves chartRowsByQuery/chartGenerationRef weren't wrongly
    // pruned by the other chart's deletion (a flipped `!chartsRef.current.
    // some(...)` guard would still pass a card-count/error-tile-only check).
    for (const card of await page.locator(".hyakkei-chart-card").all()) {
      await card.getByRole("button", { name: "表" }).click();
    }
    await expect(page.locator(".hyakkei-chart-card").first()).toContainText("住民課");

    // issue #102: 2 charts on the same query -> both get a disambiguating
    // ordinal, so the first card's own delete label is now "...グラフ1を削除".
    page.on("dialog", (d) => d.accept());
    await page
      .locator(".hyakkei-chart-card")
      .first()
      .getByRole("button", { name: "「06-shift_jis.csv」のグラフ1を削除" })
      .click();

    await expect(page.locator(".hyakkei-chart-card")).toHaveCount(1);
    await expect(page.locator(".hyakkei-query-card")).toHaveCount(1);
    const survivor = page.locator(".hyakkei-chart-card");
    await expect(survivor.locator(".hyakkei-error-tile")).toHaveCount(0);
    await expect(survivor).toContainText("住民課");
    await expect(survivor).toContainText("税務課");
  });

  test("deleting the only chart on a query, then adding a NEW chart on that SAME (still-alive) query shows fresh, correct data (code review, Angle E: chartGenerationRef query-id reuse regression)", async ({
    page,
  }) => {
    await setUpAggregatedQuery(page);
    await page.getByRole("button", { name: GRAPH_BUTTON }).click();
    await page.locator(".hyakkei-chart-card").getByRole("button", { name: "表" }).click();
    await expect(page.locator(".hyakkei-chart-card")).toContainText("住民課");

    // Delete the only chart -- the query itself survives (only the chart
    // and its layout item are removed), so its id remains live and reusable.
    // Single sibling -> no ordinal, label unchanged from pre-#102.
    page.on("dialog", (d) => d.accept());
    await page
      .locator(".hyakkei-chart-card")
      .getByRole("button", { name: "「06-shift_jis.csv」のグラフを削除" })
      .click();
    await expect(page.locator(".hyakkei-chart-card")).toHaveCount(0);
    await expect(page.locator(".hyakkei-query-card")).toHaveCount(1);

    // Narrow the query BEFORE re-adding a chart, so the new chart's fresh
    // fetch must reflect this narrower result, not any stale prior state.
    await page.getByRole("button", { name: "＋ 条件を追加" }).click();
    await page.getByLabel("条件1: 列").selectOption("部署");
    await page.getByLabel("条件1: 演算子").selectOption("eq");
    await page.getByLabel("条件1: 値").fill("税務課");
    await page.getByLabel("条件1: 値").press("Tab");
    await expect(page.locator(".hyakkei-query-card tbody tr")).toHaveCount(1);

    await page.getByRole("button", { name: GRAPH_BUTTON }).click();
    await page.locator(".hyakkei-chart-card").getByRole("button", { name: "表" }).click();

    const card = page.locator(".hyakkei-chart-card");
    await expect(card.locator(".hyakkei-error-tile")).toHaveCount(0);
    await expect(card).toContainText("税務課");
    await expect(card).not.toContainText("住民課");
  });

  test("deleting the query cascades to delete its chart (no dangling layout reference)", async ({
    page,
  }) => {
    await setUpAggregatedQuery(page);
    await page.getByRole("button", { name: GRAPH_BUTTON }).click();
    await expect(page.locator(".hyakkei-chart-card")).toHaveCount(1);

    page.on("dialog", (d) => d.accept());
    await page.getByRole("button", { name: "「06-shift_jis.csv」の集計を削除" }).click();

    await expect(page.locator(".hyakkei-query-card")).toHaveCount(0);
    await expect(page.locator(".hyakkei-chart-card")).toHaveCount(0);
  });

  test("deleting the SOURCE cascades through its query to delete the chart too (no dangling layout reference)", async ({
    page,
  }) => {
    await setUpAggregatedQuery(page);
    await page.getByRole("button", { name: GRAPH_BUTTON }).click();
    await expect(page.locator(".hyakkei-chart-card")).toHaveCount(1);

    page.on("dialog", (d) => d.accept());
    await page.getByRole("button", { name: "「06-shift_jis.csv」を削除" }).click();

    await expect(page.locator(".hyakkei-query-card")).toHaveCount(0);
    await expect(page.locator(".hyakkei-chart-card")).toHaveCount(0);
  });

  // issue #102 (V-001): Cancel returns false from window.confirm() -- the
  // handler's own guard (`if (!window.confirm(...)) return;`) must fire
  // BEFORE any state mutation, DROP TABLE, or announcement.
  test("cancelling the source-delete confirm leaves everything untouched (no DROP, no state change, no announcement)", async ({
    page,
  }) => {
    await setUpAggregatedQuery(page);
    await page.getByRole("button", { name: GRAPH_BUTTON }).click();
    await expect(page.locator(".hyakkei-chart-card")).toHaveCount(1);

    page.on("dialog", (d) => d.dismiss());
    await page.getByRole("button", { name: "「06-shift_jis.csv」を削除" }).click();

    await expect(page.locator(".hyakkei-source-card")).toHaveCount(1);
    await expect(page.locator(".hyakkei-query-card")).toHaveCount(1);
    await expect(page.locator(".hyakkei-chart-card")).toHaveCount(1);
    await expect(page.getByRole("status").filter({ hasText: "削除しました" })).toHaveCount(0);
  });

  // Codex Round 1 (P1): the source-delete cancel path above was covered,
  // but the other 2 top-level confirm() sites were not -- each handler
  // guards independently, so each needs its own cancel proof.
  test("cancelling the query-delete confirm leaves the query and its chart untouched", async ({
    page,
  }) => {
    await setUpAggregatedQuery(page);
    await page.getByRole("button", { name: GRAPH_BUTTON }).click();
    await expect(page.locator(".hyakkei-chart-card")).toHaveCount(1);

    page.on("dialog", (d) => d.dismiss());
    await page.getByRole("button", { name: "「06-shift_jis.csv」の集計を削除" }).click();

    await expect(page.locator(".hyakkei-query-card")).toHaveCount(1);
    await expect(page.locator(".hyakkei-chart-card")).toHaveCount(1);
  });

  test("cancelling the chart-delete confirm leaves the chart untouched, no delete announcement", async ({
    page,
  }) => {
    await setUpAggregatedQuery(page);
    await page.getByRole("button", { name: GRAPH_BUTTON }).click();
    await expect(page.locator(".hyakkei-chart-card")).toHaveCount(1);

    page.on("dialog", (d) => d.dismiss());
    await page.getByRole("button", { name: "「06-shift_jis.csv」のグラフを削除" }).click();

    await expect(page.locator(".hyakkei-chart-card")).toHaveCount(1);
    await expect(page.getByRole("status").filter({ hasText: "グラフを削除しました" })).toHaveCount(
      0,
    );
  });

  // issue #102 (V-002): a source with N charts on its one query must still
  // prompt exactly ONCE -- confirm() lives in `handleSourceDelete` alone,
  // never in the shared `cascadeDeleteQuery`/`handleChartDelete` primitives
  // the cascade also calls per-chart.
  test("deleting a source with 2 charts on its query prompts confirm exactly once", async ({
    page,
  }) => {
    await setUpAggregatedQuery(page);
    await page.getByRole("button", { name: GRAPH_BUTTON }).click();
    await page.getByRole("button", { name: GRAPH_BUTTON }).click();
    await expect(page.locator(".hyakkei-chart-card")).toHaveCount(2);

    let dialogCount = 0;
    page.on("dialog", (d) => {
      dialogCount++;
      void d.accept();
    });
    await page.getByRole("button", { name: "「06-shift_jis.csv」を削除" }).click();

    await expect(page.locator(".hyakkei-chart-card")).toHaveCount(0);
    expect(dialogCount).toBe(1);
  });

  // QA Phase 8 (Minor M-1): the source-delete case above was covered, but
  // `handleQueryDelete` guards its OWN cascade (`cascadeDeleteQuery` ->
  // `handleChartDelete` per chart) independently -- this proves that path
  // also prompts once, not once per chart.
  test("deleting a query with 2 charts prompts confirm exactly once", async ({ page }) => {
    await setUpAggregatedQuery(page);
    await page.getByRole("button", { name: GRAPH_BUTTON }).click();
    await page.getByRole("button", { name: GRAPH_BUTTON }).click();
    await expect(page.locator(".hyakkei-chart-card")).toHaveCount(2);

    let dialogCount = 0;
    page.on("dialog", (d) => {
      dialogCount++;
      void d.accept();
    });
    await page.getByRole("button", { name: "「06-shift_jis.csv」の集計を削除" }).click();

    await expect(page.locator(".hyakkei-chart-card")).toHaveCount(0);
    expect(dialogCount).toBe(1);
  });

  // issue #102 (V-008): ordinals are recomputed from array position on every
  // render, not stored/stable -- deleting query 1 of 2 leaves exactly 1
  // survivor, which is a single-sibling case again (no ordinal), not "the
  // surviving query is now labeled 2".
  test("deleting one of two queries on the same source renumbers the survivor back to no ordinal", async ({
    page,
  }) => {
    await page.locator('input[type="file"]').setInputFiles(fixturePath("06-shift_jis.csv"));
    await expect(page.getByRole("heading", { name: "データワークスペース" })).toBeVisible();
    await page.getByRole("button", { name: "「06-shift_jis.csv」を集計" }).click();
    await page.getByRole("button", { name: "「06-shift_jis.csv」を集計" }).click();
    await expect(page.locator(".hyakkei-query-card")).toHaveCount(2);

    page.on("dialog", (d) => d.accept());
    await page
      .locator(".hyakkei-query-card")
      .first()
      .getByRole("button", { name: "「06-shift_jis.csv」の集計1を削除" })
      .click();

    await expect(page.locator(".hyakkei-query-card")).toHaveCount(1);
    await expect(
      page.getByRole("button", { name: "「06-shift_jis.csv」の集計を削除", exact: true }),
    ).toBeVisible();
  });

  // issue #102 (V-004, accepted-risk verification): `handleSourceDelete`'s
  // card removal happens in a `finally` after an `await`, leaving a brief
  // window where the same button is still clickable. DROP TABLE IF EXISTS
  // is idempotent by design (plan: no extra re-entry guard added) -- this
  // only needs to prove the app reaches a consistent, uncorrupted end state,
  // not that the second click was rejected outright.
  test("clicking source delete twice in quick succession still ends in a clean, single deletion (no crash, no duplicate state)", async ({
    page,
  }) => {
    await setUpAggregatedQuery(page);
    page.on("dialog", (d) => d.accept());
    const deleteButton = page.getByRole("button", { name: "「06-shift_jis.csv」を削除" });
    await deleteButton.click();
    // Best-effort second click into the same async gap -- if the card is
    // already gone by the time this runs, the locator simply times out and
    // this catch absorbs it; either outcome is consistent with a correct
    // (idempotent) implementation.
    await deleteButton.click({ timeout: 500 }).catch(() => {});

    await expect(page.getByRole("heading", { name: "データ取り込み" })).toBeVisible();
    await expect(page.locator(".hyakkei-source-card")).toHaveCount(0);
  });

  test("assigning a text column to a numeric channel shows a non-blocking type-mismatch warning, and the chart still renders", async ({
    page,
  }) => {
    await setUpAggregatedQuery(page);
    await page.getByRole("button", { name: GRAPH_BUTTON }).click();
    const card = page.locator(".hyakkei-chart-card");
    await card.getByRole("button", { name: "円グラフ" }).click();

    await card.getByLabel("値", { exact: true }).selectOption("部署");

    // `role="status"` (polite), not `"alert"` (UX review Phase 8 Minor,
    // finding C-5): this warning is non-blocking advisory, not an interrupt.
    await expect(card.locator('[role="status"]')).toContainText("数値として認識できませんでした");
    await expect(card.locator(".hyakkei-error-tile")).toHaveCount(0);
  });

  // SEC-1 (plan §型不一致encodingの検知/セキュリティ要件): the chart title flows
  // through to the SAME normalizeAuthoring+mount() pipeline every other
  // chart field does -- no new, unescaped DOM-construction path for this
  // PR's one new free-text input. Same payload convention as core's own
  // `renderer/xss.test.ts`.
  test("an XSS payload typed into the chart title never executes and never creates a live <script>/<img onerror> element", async ({
    page,
  }) => {
    const payload = "<img src=x onerror=alert(1)>";
    let dialogFired = false;
    page.on("dialog", () => {
      dialogFired = true;
    });

    await setUpAggregatedQuery(page);
    await page.getByRole("button", { name: GRAPH_BUTTON }).click();
    const card = page.locator(".hyakkei-chart-card");

    await card.getByLabel("グラフのタイトル").fill(payload);
    await card.getByLabel("グラフのタイトル").blur();

    await expect(card).toContainText(payload);
    expect(await card.locator("script").count()).toBe(0);
    expect(await card.locator("img[onerror]").count()).toBe(0);
    expect(dialogFired, "onerror payload executed (alert() fired)").toBe(false);
  });

  test("a column named __proto__/constructor works as a chart's table encoding and renders without polluting Object.prototype", async ({
    page,
  }) => {
    const before = await page.evaluate(() => Object.getOwnPropertyNames(Object.prototype));

    await page.locator('input[type="file"]').setInputFiles(fixturePath("18-proto-column.xlsx"));
    await expect(page.getByRole("heading", { name: "データワークスペース" })).toBeVisible();
    await page.getByRole("button", { name: "「18-proto-column.xlsx」を集計" }).click();
    await expect(page.locator(".hyakkei-query-card tbody tr").first()).toBeVisible();

    await page.getByRole("button", { name: "「18-proto-column.xlsx」の集計をグラフ化" }).click();
    await page.locator(".hyakkei-chart-card").getByRole("button", { name: "表" }).click();

    const card = page.locator(".hyakkei-chart-card");
    await expect(card.locator(".hyakkei-error-tile")).toHaveCount(0);
    await expect(card).toContainText("polluted?");
    await expect(card).toContainText("also polluted?");

    const after = await page.evaluate(() => Object.getOwnPropertyNames(Object.prototype));
    expect(
      after,
      "Object.prototype gained an own property while building/rendering the chart",
    ).toEqual(before);
  });
});
