import { createHash } from "node:crypto";
import { writeFileSync } from "node:fs";
import { expect, test } from "@playwright/test";

const LARGE_CSV_ROW_COUNT = 4_000_000;
const LARGE_CSV_ROW = "2024-01-01,department,42,constant-value\n";
const LARGE_CSV = (() => {
  const header = Buffer.from("date,department,count,label\n");
  const row = Buffer.from(LARGE_CSV_ROW);
  const buffer = Buffer.alloc(header.length + row.length * LARGE_CSV_ROW_COUNT);
  header.copy(buffer);
  for (let offset = header.length; offset < buffer.length; offset += row.length) {
    row.copy(buffer, offset);
  }
  return buffer;
})();

// #43: measure the actual file-input -> DuckDB parse -> workspace completion
// interval. The fixed 160MB CSV is intentionally large enough to make the
// parse multi-second on the canonical CI image; changing it requires a new
// recorded fixture checksum and a review of the acceptance evidence.
test("multi-second CSV parse keeps the main thread responsive", async ({ page }, testInfo) => {
  test.slow();
  await page.goto("/index.html", { waitUntil: "domcontentloaded" });
  await page.getByLabel("ファイルを選択").waitFor();

  await page.evaluate(() => {
    const probe = {
      parseStartedAt: null as number | null,
      parseCompletedAt: null as number | null,
      longTaskSupported: false,
      longestLongTask: 0,
      longestHeartbeatGap: 0,
    };
    (window as unknown as { __hyakkeiParseProbe: typeof probe }).__hyakkeiParseProbe = probe;

    let lastHeartbeat = performance.now();
    const heartbeat = () => {
      const now = performance.now();
      if (probe.parseStartedAt !== null && probe.parseCompletedAt === null) {
        probe.longestHeartbeatGap = Math.max(probe.longestHeartbeatGap, now - lastHeartbeat);
      }
      lastHeartbeat = now;
      window.setTimeout(heartbeat, 50);
    };
    window.setTimeout(heartbeat, 50);

    const mutationObserver = new MutationObserver(() => {
      const workspaceReady = document.body.textContent?.includes("データワークスペース") ?? false;
      if (workspaceReady && probe.parseStartedAt !== null && probe.parseCompletedAt === null) {
        probe.parseCompletedAt = performance.now();
      }
    });
    mutationObserver.observe(document.body, {
      childList: true,
      subtree: true,
      characterData: true,
    });

    const input = document.querySelector('input[type="file"][accept=".csv,.xlsx,.parquet"]');
    input?.addEventListener(
      "change",
      () => {
        probe.parseStartedAt = performance.now();
      },
      { capture: true, once: true },
    );

    if (!("PerformanceObserver" in window)) return;
    const performanceObserver = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        const parseStart = probe.parseStartedAt;
        const parseEnd = probe.parseCompletedAt ?? performance.now();
        const overlapsParse =
          parseStart !== null &&
          entry.startTime + entry.duration >= parseStart &&
          entry.startTime <= parseEnd;
        if (!overlapsParse) continue;
        probe.longestLongTask = Math.max(probe.longestLongTask, entry.duration);
      }
    });
    try {
      performanceObserver.observe({ type: "longtask", buffered: true });
      probe.longTaskSupported = true;
    } catch {
      // Firefox/WebKit may not expose Long Task API; heartbeat is the
      // portable fallback used by the assertion below.
    }
  });
  const fixturePath = testInfo.outputPath("multi-second-parse.csv");
  writeFileSync(fixturePath, LARGE_CSV);
  // Playwright caps in-memory file buffers at 50MB. The generated file is
  // intentionally larger, so pass its deterministic path (unique per
  // retry/worker) instead of an in-memory buffer.
  await page
    .getByRole("button", { name: "ファイルを選択" })
    .locator('input[type="file"][accept=".csv,.xlsx,.parquet"]')
    .setInputFiles(fixturePath);
  await page.waitForFunction(
    () => {
      const probe = (
        window as unknown as {
          __hyakkeiParseProbe?: { parseCompletedAt: number | null };
        }
      ).__hyakkeiParseProbe;
      return probe !== undefined && probe.parseCompletedAt !== null;
    },
    undefined,
    { timeout: 30_000 },
  );

  const probe = await page.evaluate(
    () =>
      (
        window as unknown as {
          __hyakkeiParseProbe: {
            parseStartedAt: number | null;
            parseCompletedAt: number | null;
            longTaskSupported: boolean;
            longestLongTask: number;
            longestHeartbeatGap: number;
          };
        }
      ).__hyakkeiParseProbe,
  );
  const parseDuration = probe.parseCompletedAt! - probe.parseStartedAt!;
  const mainThreadGap = probe.longTaskSupported ? probe.longestLongTask : probe.longestHeartbeatGap;
  await testInfo.attach("intake-parse-metrics.json", {
    body: Buffer.from(
      JSON.stringify({
        browser: testInfo.project.name,
        fixtureBytes: LARGE_CSV.byteLength,
        fixtureRows: LARGE_CSV_ROW_COUNT,
        fixtureSha256: createHash("sha256").update(LARGE_CSV).digest("hex"),
        parseDuration,
        longTaskSupported: probe.longTaskSupported,
        mainThreadGap,
      }),
    ),
    contentType: "application/json",
  });
  expect(parseDuration).toBeGreaterThanOrEqual(2_000);
  expect(mainThreadGap).toBeLessThan(200);
});

// #115: measure the real browser main thread during a narrow viewport resize,
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
