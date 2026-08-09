import { expect, test } from "@playwright/test";

// #43: measure the real browser main thread during a narrow viewport resize,
// rather than inferring responsiveness from CSS source or jsdom.
test("narrow viewport resize has no main-thread task over 200ms", async ({ page }, testInfo) => {
  await page.goto("/golden.html?sample=applications&appearance=light", {
    waitUntil: "networkidle",
  });
  await page.waitForSelector(".hyakkei-chart-canvas");
  await page.evaluate(() => {
    const probe = { supported: false, durations: [] as number[] };
    (window as unknown as { __hyakkeiLongTaskProbe: typeof probe }).__hyakkeiLongTaskProbe = probe;
    if (!("PerformanceObserver" in window)) return;
    const durations: number[] = [];
    const observer = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) durations.push(entry.duration);
    });
    try {
      observer.observe({ type: "longtask", buffered: true });
      probe.supported = true;
    } catch {
      return;
    }
    probe.durations = durations;
  });
  // A real browser viewport change drives the renderer's ResizeObserver. A
  // synthetic window.resize event would not exercise that path.
  await page.setViewportSize({ width: 375, height: 900 });
  await page.waitForTimeout(250);
  const boxes = await page.locator(".hyakkei-chart-canvas").evaluateAll((elements) =>
    elements.map((element) => {
      const rect = element.getBoundingClientRect();
      return { width: rect.width, height: rect.height };
    }),
  );
  expect(boxes.length).toBeGreaterThan(0);
  expect(boxes.every((box) => box.width > 0 && box.height > 0)).toBe(true);
  const probe = await page.evaluate(() => {
    const value = (
      window as unknown as { __hyakkeiLongTaskProbe?: { supported: boolean; durations: number[] } }
    ).__hyakkeiLongTaskProbe;
    return value ? { supported: value.supported, longest: Math.max(0, ...value.durations) } : null;
  });
  if (!probe?.supported) {
    testInfo.annotations.push({
      type: "unsupported",
      description:
        "Long Task API is unavailable in this browser; layout boxes were still asserted after a real viewport change.",
    });
    return;
  }
  expect(probe.longest).toBeLessThan(200);
});
