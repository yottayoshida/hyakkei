import { expect, test } from "@playwright/test";

// PR-C golden layer ③ (plan §技術選定, "代表2キー色 × 2 appearance に限定").
// `guidebook-blue` + `guidebook-orange` are the representative keys, not
// `guidebook-red`/`guidebook-green`: those two palettes make a chart's
// primary series color byte-identical to the Semantic Error/Success color
// (tracked separately, issue #60) -- freezing that collision into a
// committed screenshot baseline would read as "this is the intended look,"
// which it is not.
const PALETTES = ["guidebook-blue", "guidebook-orange"] as const;
const APPEARANCES = ["light", "dark"] as const;
const SAMPLE = "applications"; // richest of the 3 (bar+line+stat) in one view

for (const palette of PALETTES) {
  for (const appearance of APPEARANCES) {
    test(`golden pixel: ${SAMPLE} / ${palette} / ${appearance}`, async ({ page }) => {
      await page.goto(`/golden.html?sample=${SAMPLE}&appearance=${appearance}&palette=${palette}`, {
        waitUntil: "networkidle",
      });
      await page.waitForSelector(".hyakkei-chart-canvas svg", { timeout: 10_000 });

      await expect(page.locator("body")).toHaveScreenshot(
        `${SAMPLE}-${palette}-${appearance}.png`,
        {
          maxDiffPixelRatio: 0,
        },
      );
    });
  }
}
