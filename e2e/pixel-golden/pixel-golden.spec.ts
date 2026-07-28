import { expect, test } from "@playwright/test";

// PR-C golden layer ③ (plan §技術選定, "代表2キー色 × 2 appearance に限定").
// `guidebook-blue` + `guidebook-orange` are the representative keys, not
// `guidebook-red`/`guidebook-green`: those two palettes make a chart's
// primary series color byte-identical to the Semantic Error/Success color
// (tracked separately, issue #60) -- freezing that collision into a
// committed screenshot baseline would read as "this is the intended look,"
// which it is not.
//
// issue #122 added `guidebook-cyan` to that list for the same reason, from a
// different cause: its `secondary` role is now the guidebook's Green ramp, and
// design-tokens derives `Semantic.Success` from the same Green 800, so
// cyan/light and cyan/dark collide too (ADR-0018 §6). The selection is
// unchanged -- blue and orange were already the representatives and neither
// gained a collision -- but the stated reason now covers three palettes, not
// two. `packages/core/src/theme/palette.test.ts`'s `KNOWN_ROLE_COLLISIONS` is
// the authoritative list; this comment must not drift from it.
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
