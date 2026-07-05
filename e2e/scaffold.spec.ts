import { expect, test } from "@playwright/test";

// Placeholder confirming the Playwright/browser-matrix harness itself works.
// Real specs (query-layer goldens, export artifact file:// launch checks)
// land in M1/M3 — see ROADMAP.md and ARCHITECTURE.md §8.
test("browser matrix harness is wired up", async ({ page }) => {
  await page.setContent("<h1>Hyakkei</h1>");
  await expect(page.locator("h1")).toHaveText("Hyakkei");
});
