import { expect, test } from "@playwright/test";

// issue #64: this was a `page.setContent()` placeholder that only proved
// Playwright itself works, not the app -- the real-browser chart-collapse
// bug (grid rows unsized, detached-container `echarts.init`, fixed by
// mount.ts's gridAutoRows/resize()) passed this spec's full 3-browser
// matrix because nothing here ever loaded the built app. This now
// navigates to the actual index route (App.tsx's single fixed sample
// dashboard) via the webServer this config already wires up, and pins the
// same expected-count-first pattern golden-narrow-viewport.spec.ts uses:
// asserting a count before iterating per-element avoids a partial-render
// regression silently passing because `.locator(...).all()` just returns
// fewer elements.
test("index route (App.tsx sample dashboard) mounts a real chart with a laid-out box, a11y fallback, and no error tile", async ({
  page,
}) => {
  // `/index.html`, not `/` -- `serve.json`'s `cleanUrls: false` (required
  // for the other served pages' exact filenames) means this webServer does
  // not resolve a bare `/` to `index.html`; it returns a directory
  // listing instead (confirmed empirically). Every other spec in this
  // directory already navigates to an explicit `.html` path for the same
  // reason (golden.html/intake.html/register-harness.html).
  await page.goto("/index.html", { waitUntil: "networkidle" });
  await page.waitForSelector(".hyakkei-chart-canvas svg", { timeout: 10_000 });

  expect(await page.locator(".hyakkei-error-tile").count()).toBe(0);

  // App.tsx's SAMPLE_DASHBOARD declares exactly one chart (bar, ECharts-
  // backed) -- every count below is 1 for that reason, not an arbitrary
  // choice.
  expect(await page.locator(".hyakkei-tile").count()).toBe(1);
  const svgLocator = page.locator(".hyakkei-chart-canvas svg");
  expect(await svgLocator.count()).toBe(1);
  expect(await page.locator(".hyakkei-accessible-fallback table").count()).toBe(1);

  // The chart-collapse regression this pins (mount.ts's gridAutoRows +
  // canvas flex fix, same as golden-narrow-viewport.spec.ts): a collapsed
  // box rendered at effectively 0 height even though the <svg> existed.
  const box = await svgLocator.boundingBox();
  expect(box?.width).toBeGreaterThan(0);
  expect(box?.height).toBeGreaterThan(0);
});
