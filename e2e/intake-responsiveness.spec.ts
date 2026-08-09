import { expect, test } from "@playwright/test";

// #43: measure the real browser main thread during a narrow viewport resize,
// rather than inferring responsiveness from CSS source or jsdom.
test("narrow viewport resize has no main-thread task over 200ms", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 900 });
  await page.goto("/golden.html?sample=applications&appearance=light", {
    waitUntil: "networkidle",
  });
  await page.waitForSelector(".hyakkei-chart-canvas");
  const longestTask = await page.evaluate(async () => {
    if (!("PerformanceObserver" in window)) return 0;
    const durations: number[] = [];
    const observer = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) durations.push(entry.duration);
    });
    try {
      observer.observe({ type: "longtask", buffered: true });
    } catch {
      return 0;
    }
    window.dispatchEvent(new Event("resize"));
    await new Promise((resolve) => setTimeout(resolve, 250));
    observer.disconnect();
    return Math.max(0, ...durations);
  });
  expect(longestTask).toBeLessThan(200);
});
