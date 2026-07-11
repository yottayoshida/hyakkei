// V-102 (ECharts leg): SSR mode needs no DOM at all (PR-0's own chosen
// renderer, docs/spikes/m0-charts.md) -- kept out of xss.test.ts's jsdom
// environment so a `document` global isn't present to tempt ECharts into a
// canvas-measurement fallback path this test doesn't want to exercise.
import type { BakedDashboard } from "@hyakkei/schema";
import * as echarts from "echarts";
import { describe, expect, it } from "vitest";
import { buildOptions } from "./build-options.js";
import { normalizeBaked } from "./render-model.js";

const PAYLOAD = "<img src=x onerror=alert(1)>";
const SCRIPT_PAYLOAD = "</td><script>alert(2)</script>";

describe("V-102: ECharts SVG renderer escapes malicious title/category text (SSR, real pipeline)", () => {
  it("does not emit a raw <img> or <script> tag for a malicious title/category label", () => {
    const baked: BakedDashboard = {
      version: 1,
      meta: {
        title: "t",
        generatedAt: "2026-07-11T00:00:00Z",
        sourceDataAsOf: "2026-07-10",
        hyakkeiVersion: "0.1.0",
      },
      theme: { tokens: "@digital-go-jp/design-tokens@2.0.1", palette: "guidebook-blue" },
      charts: [
        {
          id: "c1",
          type: "bar",
          encoding: { x: "cat", y: "val" },
          options: { title: PAYLOAD },
          rows: [{ cat: SCRIPT_PAYLOAD, val: 1 }],
        },
      ],
      layout: { grid: "guidebook-12col", items: [{ chart: "c1", x: 0, y: 0, w: 6, h: 4 }] },
    };

    const option = buildOptions(normalizeBaked(baked)).c1!;
    const chart = echarts.init(null, null, { ssr: true, renderer: "svg", width: 200, height: 200 });
    chart.setOption(option);
    const svg = chart.renderToSVGString();

    // Positive sentinel first (issue #72): prove the payload text actually
    // reached the SVG -- without this, a mutant that drops the title (or
    // blanks all strings) passes the negative assertions while guarding
    // nothing about escaping.
    expect(svg).toContain("onerror");
    expect(svg).not.toContain("<img");
    expect(svg).not.toContain("<script");
  });

  it("Codex R1 P1: pie chart category name (legend + slice label) is equally escaped", () => {
    const baked: BakedDashboard = {
      version: 1,
      meta: {
        title: "t",
        generatedAt: "2026-07-11T00:00:00Z",
        sourceDataAsOf: "2026-07-10",
        hyakkeiVersion: "0.1.0",
      },
      theme: { tokens: "@digital-go-jp/design-tokens@2.0.1", palette: "guidebook-blue" },
      charts: [
        {
          id: "c1",
          type: "pie",
          encoding: { category: "cat", value: "val" },
          options: { title: PAYLOAD, legend: { show: true } },
          rows: [{ cat: SCRIPT_PAYLOAD, val: 1 }],
        },
      ],
      layout: { grid: "guidebook-12col", items: [{ chart: "c1", x: 0, y: 0, w: 6, h: 4 }] },
    };

    const option = buildOptions(normalizeBaked(baked)).c1!;
    const chart = echarts.init(null, null, { ssr: true, renderer: "svg", width: 200, height: 200 });
    chart.setOption(option);
    const svg = chart.renderToSVGString();

    // Same positive-sentinel-then-negative pattern as the bar test above
    // (issue #72).
    expect(svg).toContain("onerror");
    expect(svg).not.toContain("<img");
    expect(svg).not.toContain("<script");
  });
});
