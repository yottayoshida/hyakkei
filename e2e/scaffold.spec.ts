import { expect, test } from "@playwright/test";

// issue #11a (single-SPA editor, ADR-0010): index.html no longer shows
// App.tsx's fixed SAMPLE_DASHBOARD immediately -- the editor shell's first
// render is onboarding (data intake) until at least one source is
// registered. The former "index route mounts a real chart" assertion this
// spec used to make now belongs to a real registered-source flow
// (e2e/mount-resilience.spec.ts's "workspace renders the sample dashboard"
// test) or golden.html (e2e/golden-narrow-viewport.spec.ts already pins the
// chart-collapse/laid-out-box regression this file used to guard, via the
// SAME mount()/gridAutoRows code path -- golden.html and the workspace's
// DashboardPreview call the identical `mount()`).
test("index route starts in the onboarding state (no source registered yet) -- no chart, no error tile, the real intake UI is visible", async ({
  page,
}) => {
  // `/index.html`, not `/` -- `serve.json`'s `cleanUrls: false` (required
  // for the other served pages' exact filenames) means this webServer does
  // not resolve a bare `/` to `index.html`; it returns a directory listing
  // instead (confirmed empirically). Every other spec in this directory
  // already navigates to an explicit `.html` path for the same reason.
  await page.goto("/index.html", { waitUntil: "networkidle" });

  // The real onboarding UI (IntakeApp in "onboard" mode) renders, not a
  // blank shell or a stale cached view.
  await expect(page.getByLabel("ファイルを選択")).toBeVisible();
  await expect(page.getByLabel("データのURL")).toBeVisible();

  // Nothing to preview before any source exists -- no chart, no per-tile
  // error state, no crashed boundary.
  expect(await page.locator(".hyakkei-chart-canvas svg").count()).toBe(0);
  expect(await page.locator(".hyakkei-error-tile").count()).toBe(0);
  expect(await page.locator('[role="alert"]').count()).toBe(0);
});
