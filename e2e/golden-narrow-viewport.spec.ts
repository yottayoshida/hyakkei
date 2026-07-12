import { expect, test } from "@playwright/test";

// PR-C narrow-viewport sanity (plan step 3, "narrow viewport（モバイル幅）の
// SVG/DOM sanity"). jsdom cannot compute real CSS Grid/Flexbox layout
// (packages/core/src/renderer/__golden__/golden-samples.test.ts's own
// narrow-viewport test can only pin DOM structure, not real pixel boxes)
// -- this is the real-browser counterpart that actually exercises
// `mount.ts`'s `gridAutoRows`/`resize()` fix at a genuinely narrow width.
// Runs against the plain host browser matrix (chromium/firefox/webkit),
// not Docker: this is DOM/box sanity, not a pixel-diff golden, so
// cross-platform font rendering differences don't matter here.
// Chart count per sample (packages/core/src/golden-fixtures/
// sample-dashboards.ts), asserted below so a URL/routing regression that
// silently served the WRONG page (e.g. index.html's fixed single-chart
// SAMPLE_DASHBOARD instead of golden.html's requested fixture -- exactly
// what happened here once already: this spec pointed at `/` instead of
// `/golden.html` and every iteration passed vacuously against the same one
// chart) fails loudly instead of passing for the wrong reason.
const SAMPLE_CHART_COUNTS = { applications: 3, budget: 3, regional: 2 } as const;
// ECharts-backed (bar/line/area/scatter/pie) charts only -- table/stat are
// plain DOM and never produce a `.hyakkei-chart-canvas svg` element.
// applications=bar+line (stat excluded), budget=area+pie (table excluded),
// regional=scatter+bar (no DOM-only chart in this sample).
const SAMPLE_ECHARTS_CANVAS_COUNTS = { applications: 2, budget: 2, regional: 2 } as const;

for (const [sample, expectedChartCount] of Object.entries(SAMPLE_CHART_COUNTS)) {
  test(`narrow viewport (375px): ${sample} mounts with non-zero chart boxes and no error tile`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: 375, height: 1200 });
    await page.goto(`/golden.html?sample=${sample}&appearance=light`, {
      waitUntil: "networkidle",
    });
    await page.waitForSelector(".hyakkei-chart-canvas svg", { timeout: 10_000 });

    expect(await page.locator(".hyakkei-error-tile").count()).toBe(0);

    const tileCount = await page.locator(".hyakkei-tile").count();
    expect(tileCount).toBe(expectedChartCount);
    const fallbackCount = await page.locator(".hyakkei-accessible-fallback").count();
    expect(fallbackCount).toBe(tileCount);

    // /code-review (xhigh) finding: the box-assertion loop below iterates
    // whatever `.locator(...).all()` happens to return -- if only SOME
    // (not all) of a sample's ECharts-backed charts fail to mount an <svg>,
    // `.all()` simply returns fewer elements and every per-element
    // assertion still passes. Asserting the expected count FIRST turns a
    // partial-render regression into a loud, specific failure.
    const svgLocator = page.locator(".hyakkei-chart-canvas svg");
    expect(await svgLocator.count()).toBe(
      SAMPLE_ECHARTS_CANVAS_COUNTS[sample as keyof typeof SAMPLE_ECHARTS_CANVAS_COUNTS],
    );

    for (const svg of await svgLocator.all()) {
      const box = await svg.boundingBox();
      expect(box?.width).toBeGreaterThan(0);
      expect(box?.height).toBeGreaterThan(0);
      // The collapsed-box regression this pins (mount.ts's gridAutoRows +
      // canvas flex fix): a chart box narrower than its 12-col grid slot
      // could allow would still be > 0, but a genuinely collapsed box
      // (the pre-fix bug) rendered at effectively 0 height.
    }
  });
}
