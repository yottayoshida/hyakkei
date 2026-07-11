// @vitest-environment jsdom
// V-101 (extended) + V-103: does the authoring path (Dashboard + rows -->
// normalizeAuthoring --> buildOptions/DOM builders) produce the same output
// as the bake path (Dashboard + rows --> bake --> BakedDashboard -->
// normalizeBaked --> buildOptions/DOM builders), across all 7 ChartVariant
// types? This is the PR thesis's core claim (plan §PR thesis, PR-B).
import type { Dashboard } from "@hyakkei/schema";
import { describe, expect, it } from "vitest";
import { bake } from "../bake/bake.js";
import { buildAccessibleDataTable } from "./accessible-table.js";
import { buildOptions } from "./build-options.js";
import { buildStatElement } from "./dom/stat.js";
import { buildTableElement } from "./dom/table.js";
import { normalizeAuthoring, normalizeBaked } from "./render-model.js";

const doc: Dashboard = {
  version: 1,
  meta: { title: "convergence fixture" },
  theme: {
    tokens: "@digital-go-jp/design-tokens@2.0.1",
    palette: "guidebook-blue",
    appearance: "light",
  },
  sources: [],
  queries: [
    { id: "q-bar", source: "apps", sql: "SELECT category, total FROM apps" },
    { id: "q-line", source: "apps", sql: "SELECT month, count FROM apps" },
    { id: "q-area", source: "apps", sql: "SELECT month, count FROM apps" },
    { id: "q-scatter", source: "apps", sql: "SELECT x, y, size FROM apps" },
    { id: "q-pie", source: "apps", sql: "SELECT segment, amount FROM apps" },
    { id: "q-table", source: "apps", sql: "SELECT name, value FROM apps" },
    { id: "q-stat", source: "apps", sql: "SELECT count FROM apps" },
  ],
  charts: [
    {
      id: "c-bar",
      type: "bar",
      encoding: { x: "category", y: "total" },
      query: "q-bar",
      options: { title: "棒" },
    },
    {
      id: "c-line",
      type: "line",
      encoding: { x: "month", y: "count" },
      query: "q-line",
      options: {},
    },
    {
      id: "c-area",
      type: "area",
      encoding: { x: "month", y: "count" },
      query: "q-area",
      options: {},
    },
    {
      id: "c-scatter",
      type: "scatter",
      encoding: { x: "x", y: "y", size: "size" },
      query: "q-scatter",
      options: {},
    },
    {
      id: "c-pie",
      type: "pie",
      encoding: { category: "segment", value: "amount" },
      query: "q-pie",
      options: { donut: true },
    },
    {
      id: "c-table",
      type: "table",
      encoding: { columns: ["name", "value"] },
      query: "q-table",
      options: {},
    },
    {
      id: "c-stat",
      type: "stat",
      encoding: { value: "count" },
      query: "q-stat",
      options: { title: "件数" },
    },
  ],
  layout: {
    grid: "guidebook-12col",
    items: [
      { chart: "c-bar", x: 0, y: 0, w: 4, h: 4 },
      { chart: "c-line", x: 4, y: 0, w: 4, h: 4 },
      { chart: "c-area", x: 8, y: 0, w: 4, h: 4 },
      { chart: "c-scatter", x: 0, y: 4, w: 4, h: 4 },
      { chart: "c-pie", x: 4, y: 4, w: 4, h: 4 },
      { chart: "c-table", x: 8, y: 4, w: 4, h: 4 },
      { chart: "c-stat", x: 0, y: 8, w: 4, h: 2 },
    ],
  },
};

const resolvedRows = {
  "q-bar": [
    { category: "A", total: 120 },
    { category: "B", total: 90 },
  ],
  "q-line": [
    { month: "1月", count: 5 },
    { month: "2月", count: 8 },
  ],
  "q-area": [
    { month: "1月", count: 5 },
    { month: "2月", count: 8 },
  ],
  "q-scatter": [
    { x: 1, y: 2, size: 5 },
    { x: 3, y: 4, size: 8 },
  ],
  "q-pie": [
    { segment: "A", amount: 30 },
    { segment: "B", amount: 70 },
  ],
  "q-table": [
    { name: "X", value: 10 },
    { name: "Y", value: 20 },
  ],
  "q-stat": [{ count: 42 }],
};

const meta = {
  generatedAt: "2026-07-11T00:00:00Z",
  sourceDataAsOf: "2026-07-10",
  hyakkeiVersion: "0.1.0",
};

describe("authoring path and bake path converge for all 7 ChartVariant types", () => {
  const authoringModel = normalizeAuthoring(doc, resolvedRows);
  const baked = bake(doc, resolvedRows, meta);
  const bakedModel = normalizeBaked(baked);

  it("bake() carries all 7 charts through (none are query-未設定)", () => {
    expect(baked.charts.map((c) => c.id).sort()).toEqual(
      ["c-area", "c-bar", "c-line", "c-pie", "c-scatter", "c-stat", "c-table"].sort(),
    );
  });

  it("the 5 ECharts-backed variants (bar/line/area/scatter/pie) produce deep-equal EChartsOption", () => {
    const authoringOptions = buildOptions(authoringModel);
    const bakedOptions = buildOptions(bakedModel);
    for (const id of ["c-bar", "c-line", "c-area", "c-scatter", "c-pie"]) {
      expect(bakedOptions[id], `${id} option`).toEqual(authoringOptions[id]);
    }
  });

  it("table/stat DOM output is identical byte-for-byte between the two paths", () => {
    const authoringTable = authoringModel.charts.find((c) => c.id === "c-table")!;
    const bakedTable = bakedModel.charts.find((c) => c.id === "c-table")!;
    expect(buildTableElement(bakedTable.chart, bakedTable.rows).outerHTML).toEqual(
      buildTableElement(authoringTable.chart, authoringTable.rows).outerHTML,
    );

    const authoringStat = authoringModel.charts.find((c) => c.id === "c-stat")!;
    const bakedStat = bakedModel.charts.find((c) => c.id === "c-stat")!;
    expect(buildStatElement(bakedStat.chart, bakedStat.rows).outerHTML).toEqual(
      buildStatElement(authoringStat.chart, authoringStat.rows).outerHTML,
    );
  });

  it("every variant produces a non-empty accessible data table fallback", () => {
    for (const entry of authoringModel.charts) {
      const table = buildAccessibleDataTable(entry.chart, entry.rows);
      expect(table.querySelectorAll("tbody tr").length, `${entry.id} accessible rows`).toBe(
        entry.rows.length,
      );
    }
  });
});
