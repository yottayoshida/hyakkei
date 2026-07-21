import { join } from "node:path";
import { expect, test } from "@playwright/test";

const FIXTURES_DIR = join(import.meta.dirname, "..", "spikes", "excel-fidelity", "fixtures");
const fixturePath = (name: string) => join(FIXTURES_DIR, name);

// PR-M2-1 (issues #69/#68): mount.ts resilience. jsdom does no real layout
// (mount.test.ts's own ResizeObserver tests fire the callback manually and
// can only assert bookkeeping -- observe/disconnect call counts, debounce
// timing) -- this is the real-browser counterpart that actually resizes a
// window and observes a genuine re-measured box, plus the error-boundary
// path end-to-end through the real built app (App.tsx's DashboardErrorBoundary).

test("issue #68: a container resize re-measures the chart (real ResizeObserver, real layout)", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1200, height: 900 });
  await page.goto("/golden.html?sample=applications&appearance=light", {
    waitUntil: "networkidle",
  });
  await page.waitForSelector(".hyakkei-chart-canvas svg", { timeout: 10_000 });

  // /code-review (xhigh) finding: without this, a routing/build regression
  // that silently served a different page (e.g. index.html's fixed
  // single-chart SAMPLE_DASHBOARD instead of golden.html's requested
  // "applications" fixture) would still pass vacuously -- `.first()` finds
  // SOME chart on almost any page and any resizable chart shrinks with the
  // viewport, so the assertions below can't tell "the right page" from "a
  // page with a chart." e2e/golden-narrow-viewport.spec.ts pins the same
  // fixture's ECharts-backed chart count for the identical reason.
  const svgLocator = page.locator(".hyakkei-chart-canvas svg");
  expect(await svgLocator.count()).toBe(2);

  const svg = svgLocator.first();
  const boxBefore = await svg.boundingBox();
  expect(boxBefore?.width).toBeGreaterThan(0);

  // Narrowing the viewport shrinks the CSS grid's `1fr` columns, which
  // must shrink each chart's box too -- but ECharts never re-measures on
  // its own (mount.ts's own comment); only the ResizeObserver this PR adds
  // makes that happen. The debounce (100ms, mount.ts's
  // RESIZE_DEBOUNCE_MS) is why this waits before re-reading the box.
  await page.setViewportSize({ width: 500, height: 900 });
  await page.waitForTimeout(300);

  const boxAfter = await svg.boundingBox();
  expect(boxAfter?.width).toBeGreaterThan(0);
  expect(boxAfter?.width).toBeLessThan(boxBefore!.width);
});

// Not an injected-failure test -- unlike mount.test.ts/App.test.tsx (which
// mock echarts.init/mount() to prove the catch/boundary DOES trigger on a
// real throw), forcing ECharts to fail inside the real, statically-bundled
// app is not practically reachable from Playwright (no monkey-patchable
// seam once bundled). A normal load produces the same DOM whether or not
// the catch/boundary exist, so this can't prove either is wired in -- it's
// a regression guard against false positives: a normal load through the
// real built app must never itself trip the per-tile catch or the error
// boundary.
//
// issue #11a (single-SPA editor): index.html no longer shows a chart on
// its OWN first paint (e2e/scaffold.spec.ts covers that initial onboarding
// state) -- the workspace (and its DashboardPreview) only exists once at
// least one source is registered, so reaching it here means driving a real
// file registration first, same as e2e/intake-harness.spec.ts's flows.
test("issue #69: registering a source and entering the workspace never falsely trips the per-tile catch or error boundary (real built app)", async ({
  page,
}) => {
  await page.goto("/index.html", { waitUntil: "networkidle" });
  await page.locator('input[type="file"]').setInputFiles(fixturePath("06-shift_jis.csv"));

  // The workspace's own heading appears only after a successful
  // registration auto-enters it (issue #11a: no "確定" click needed).
  await expect(page.getByRole("heading", { name: "データワークスペース" })).toBeVisible();
  await page.waitForSelector(".hyakkei-chart-canvas svg", { timeout: 10_000 });

  expect(await page.locator(".hyakkei-error-tile").count()).toBe(0);
  expect(await page.locator('[role="alert"]', { hasText: "表示できませんでした" }).count()).toBe(0);
  expect(await page.locator(".hyakkei-chart-canvas svg").count()).toBe(1);
});
