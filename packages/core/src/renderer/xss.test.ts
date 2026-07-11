// @vitest-environment jsdom
// V-102: rows/meta/column-name-derived strings must never execute as
// markup. Two independent checks per plan §設計方針 6: (1) a snapshot over
// the produced EChartsOption confirming no dangerous API key is ever
// present, (2) real DOM construction (table/stat/accessible-table/message
// tile) with an actual payload, asserting the payload survives only as
// literal text.
import type { BakedDashboard } from "@hyakkei/schema";
import * as echarts from "echarts";
import { describe, expect, it } from "vitest";
import { buildAccessibleDataTable } from "./accessible-table.js";
import { buildOptions } from "./build-options.js";
import { buildMessageTile } from "./dom/message-tile.js";
import { buildStatElement } from "./dom/stat.js";
import { buildTableElement } from "./dom/table.js";
import { mount } from "./mount.js";
import { normalizeBaked } from "./render-model.js";

const PAYLOAD = "<img src=x onerror=alert(1)>";
const SCRIPT_PAYLOAD = "</td><script>alert(2)</script>";

const DANGEROUS_KEYS = ["formatter", "renderMode", "link", "dataView", "saveAsImage", "transform"];

function findDangerousKeys(value: unknown, path = ""): string[] {
  if (value === null || typeof value !== "object") return [];
  const hits: string[] = [];
  for (const [key, child] of Object.entries(value)) {
    if (DANGEROUS_KEYS.includes(key)) hits.push(`${path}.${key}`);
    hits.push(...findDangerousKeys(child, `${path}.${key}`));
  }
  return hits;
}

function bakedFixture(overrides: Partial<BakedDashboard["charts"][number]>): BakedDashboard {
  return {
    version: 1,
    meta: {
      title: PAYLOAD,
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
        options: {},
        rows: [],
        ...overrides,
      } as never,
    ],
    layout: { grid: "guidebook-12col", items: [{ chart: "c1", x: 0, y: 0, w: 6, h: 4 }] },
  };
}

describe("V-102: XSS containment", () => {
  it("buildOptions never emits a dangerous ECharts API key, even with a malicious title", () => {
    const baked = bakedFixture({
      options: { title: PAYLOAD },
      rows: [{ cat: PAYLOAD, val: 1 }],
    });
    const options = buildOptions(normalizeBaked(baked));
    expect(findDangerousKeys(options)).toEqual([]);
  });

  it("buildTableElement renders a malicious cell/column as literal text, never as a tag", () => {
    const chart = {
      id: "c1",
      type: "table" as const,
      encoding: { columns: [PAYLOAD] },
      options: {},
    };
    const table = buildTableElement(chart, [{ [PAYLOAD]: SCRIPT_PAYLOAD }]);
    expect(table.outerHTML).not.toContain("<img");
    expect(table.outerHTML).not.toContain("<script");
    expect(table.querySelector("th")?.textContent).toBe(PAYLOAD);
    expect(table.querySelector("td")?.textContent).toBe(SCRIPT_PAYLOAD);
  });

  it("buildStatElement renders a malicious title/value as literal text", () => {
    const chart = {
      id: "c1",
      type: "stat" as const,
      encoding: { value: "v" },
      options: { title: PAYLOAD },
    };
    const stat = buildStatElement(chart, [{ v: SCRIPT_PAYLOAD }]);
    expect(stat.outerHTML).not.toContain("<img");
    expect(stat.outerHTML).not.toContain("<script");
    expect(stat.querySelector(".hyakkei-stat-value")?.textContent).toBe(SCRIPT_PAYLOAD);
  });

  it("buildAccessibleDataTable renders a malicious row value as literal text", () => {
    const chart = {
      id: "c1",
      type: "bar" as const,
      encoding: { x: "cat", y: "val" },
      options: { title: PAYLOAD },
    };
    const table = buildAccessibleDataTable(chart, [{ cat: SCRIPT_PAYLOAD, val: 1 }]);
    expect(table.outerHTML).not.toContain("<img");
    expect(table.outerHTML).not.toContain("<script");
    expect(table.querySelector("caption")?.textContent).toBe(PAYLOAD);
  });

  it("buildMessageTile renders an interpolated identifier (e.g. a chart id) as literal text", () => {
    const tile = buildMessageTile(`unknown chart '${SCRIPT_PAYLOAD}'`, "error");
    expect(tile.outerHTML).not.toContain("<script");
    expect(tile.textContent).toContain(SCRIPT_PAYLOAD);
  });

  it("Codex R1 P1: mount()'s real ECharts tooltip (dispatchAction('showTip')) escapes a malicious category name", () => {
    const container = document.createElement("div");
    // ECharts needs a non-zero layout box even under jsdom's stubbed
    // getBoundingClientRect; without explicit px sizing here the SVG
    // renders at 0x0 and the tooltip never gets a position to attach at.
    container.style.width = "400px";
    container.style.height = "300px";
    document.body.appendChild(container);

    const model = normalizeBaked(bakedFixture({ options: {}, rows: [{ cat: PAYLOAD, val: 1 }] }));
    mount(container, model);

    const canvas = container.querySelector(".hyakkei-chart-canvas") as HTMLElement;
    const instance = echarts.getInstanceByDom(canvas);
    // Fail loudly, not vacuously (Codex R2): if the canvas selector or
    // ECharts' own instance registry ever stopped matching, `instance`
    // would be `undefined` and a `instance?.dispatchAction(...)` optional
    // chain would silently no-op -- the assertions below would then only
    // be checking the always-present accessible-fallback table (which also
    // contains PAYLOAD as literal text), proving nothing about the tooltip.
    expect(
      instance,
      "expected mount() to have created an ECharts instance on .hyakkei-chart-canvas",
    ).toBeTruthy();
    instance!.dispatchAction({ type: "showTip", seriesIndex: 0, dataIndex: 0 });

    // ECharts' tooltip div carries no distinguishing class, only this
    // hardcoded z-index (its own source, stable across the exact-pinned
    // 6.1.0) -- the one reliable way to select "the tooltip that just
    // appeared" rather than the chart's own SVG or the always-present
    // accessible-fallback table (both of which also legitimately contain
    // PAYLOAD as text, so asserting against `container.textContent` alone
    // would pass even if the tooltip never rendered at all).
    const tooltip = container.querySelector('[style*="z-index: 9999999"]');
    expect(
      tooltip,
      "expected a tooltip element to appear after dispatchAction('showTip')",
    ).not.toBeNull();
    expect(tooltip!.textContent).toContain(PAYLOAD);

    // Real DOM elements, not a raw-markup substring check: ECharts' own
    // `aria: {enabled: true}` (PR-0) sets a descriptive `aria-label`
    // *attribute* whose serialized value legitimately contains the literal
    // string "<img" as plain attribute-value text (HTML attribute values
    // don't need `<` escaped to stay unambiguous on reparse -- only text
    // NODE content does). Asserting on `innerHTML.includes("<img")` would
    // false-positive on that safe attribute; asserting on actual `<img>`/
    // `<script>` ELEMENTS is what actually distinguishes "executed as
    // markup" from "present as an attribute value or text node."
    expect(container.querySelectorAll("img, script").length).toBe(0);
  });
});
