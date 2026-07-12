// PR-C (issue #8/#9 acceptance: "golden-image tests for 3 samples, both
// themes" / "goldens pass across all 7 key colors"). Not part of the
// renderer's viewer-safe surface -- lives at its own subpath
// (`@hyakkei/core/golden-fixtures`, package.json `exports`) so it never
// enters `renderer/bundle-isolation.test.ts`'s reachable graph, but stays
// importable by both this package's own golden tests and `packages/app`'s
// pixel-golden harness (single source, no fixture drift between the two).
//
// Content is public-open-data-shaped (行政手続き/予算/地域統計, the kind of
// monthly PDF report P1 is meant to replace), deliberately using CJK
// category labels, 和暦 (Japanese era) month labels, and 全角 digits in free
// text -- exactly the label shapes that motivated the PR-0 CJK-label-
// dropping fix and PR-B's `cellText`/`interval:0` handling. All three
// dashboards collectively cover all 7 `ChartVariant` types; each dashboard
// individually stays close to a single printed page.
import type { Dashboard } from "@hyakkei/schema";
import type { BakeMeta } from "../bake/bake.js";
import type { Row } from "../renderer/render-model.js";

export const GOLDEN_BAKE_META: BakeMeta = {
  generatedAt: "2026-07-11T00:00:00Z",
  sourceDataAsOf: "2026-07-10",
  hyakkeiVersion: "0.1.0",
};

export type GoldenSample = {
  id: string;
  doc: Dashboard;
  rowsByQuery: Record<string, Row[]>;
};

/** Administrative procedure application status (行政手続き申請状況): bar + line + stat. */
const applications: GoldenSample = {
  id: "applications",
  doc: {
    version: 1,
    meta: { title: "行政手続き申請状況（令和8年度）" },
    theme: { tokens: "@digital-go-jp/design-tokens@2.0.1", palette: "guidebook-blue" },
    sources: [],
    queries: [
      { id: "q-category", source: "apps", sql: "SELECT category, count FROM apps GROUP BY 1" },
      { id: "q-monthly", source: "apps", sql: "SELECT month, count FROM apps_monthly" },
      { id: "q-total", source: "apps", sql: "SELECT count FROM apps_total" },
    ],
    charts: [
      {
        id: "app-category",
        type: "bar",
        encoding: { x: "category", y: "count" },
        query: "q-category",
        options: { title: "区分別申請件数" },
      },
      {
        id: "app-monthly",
        type: "line",
        encoding: { x: "month", y: "count" },
        query: "q-monthly",
        options: { title: "月次申請件数推移" },
      },
      {
        id: "app-total",
        type: "stat",
        encoding: { value: "count" },
        query: "q-total",
        options: { title: "今月の申請総数" },
      },
    ],
    layout: {
      grid: "guidebook-12col",
      items: [
        { chart: "app-category", x: 0, y: 0, w: 6, h: 4 },
        { chart: "app-monthly", x: 6, y: 0, w: 6, h: 4 },
        { chart: "app-total", x: 0, y: 4, w: 4, h: 2 },
      ],
    },
  },
  rowsByQuery: {
    "q-category": [
      { category: "建築確認", count: 128 },
      { category: "農地転用", count: 47 },
      { category: "廃棄物処理", count: 63 },
      { category: "その他", count: 22 },
    ],
    "q-monthly": [
      { month: "令和8年4月", count: 51 },
      { month: "令和8年5月", count: 62 },
      { month: "令和8年6月", count: 58 },
      { month: "令和8年7月", count: 70 },
      { month: "令和8年8月", count: 44 },
      { month: "令和8年9月", count: 66 },
    ],
    "q-total": [{ count: 351 }],
  },
};

/** Budget execution results (予算執行実績): area + pie + table. */
const budget: GoldenSample = {
  id: "budget",
  doc: {
    version: 1,
    meta: { title: "予算執行実績（第１四半期）" },
    theme: { tokens: "@digital-go-jp/design-tokens@2.0.1", palette: "guidebook-orange" },
    sources: [],
    queries: [
      { id: "q-rate", source: "budget", sql: "SELECT month, rate FROM execution_rate" },
      { id: "q-breakdown", source: "budget", sql: "SELECT item, amount FROM budget_items" },
      { id: "q-detail", source: "budget", sql: "SELECT item, budget, actual FROM budget_detail" },
    ],
    charts: [
      {
        id: "budget-rate",
        type: "area",
        encoding: { x: "month", y: "rate" },
        query: "q-rate",
        options: { title: "執行率推移（％）" },
      },
      {
        id: "budget-breakdown",
        type: "pie",
        encoding: { category: "item", value: "amount" },
        query: "q-breakdown",
        options: { title: "費目別内訳", legend: { show: true, position: "right" } },
      },
      {
        id: "budget-detail",
        type: "table",
        encoding: { columns: ["item", "budget", "actual"] },
        query: "q-detail",
        options: { title: "第１四半期 明細" },
      },
    ],
    layout: {
      grid: "guidebook-12col",
      items: [
        { chart: "budget-rate", x: 0, y: 0, w: 6, h: 4 },
        { chart: "budget-breakdown", x: 6, y: 0, w: 6, h: 4 },
        { chart: "budget-detail", x: 0, y: 4, w: 12, h: 3 },
      ],
    },
  },
  rowsByQuery: {
    "q-rate": [
      { month: "令和8年4月", rate: 18.5 },
      { month: "令和8年5月", rate: 34.2 },
      { month: "令和8年6月", rate: 49.8 },
    ],
    "q-breakdown": [
      { item: "人件費", amount: 4200 },
      { item: "委託費", amount: 3100 },
      { item: "物件費", amount: 1800 },
      { item: "その他", amount: 900 },
    ],
    "q-detail": [
      { item: "人件費（第１四半期分）", budget: 4200, actual: 2075 },
      { item: "委託費（第１四半期分）", budget: 3100, actual: 1490 },
      { item: "物件費（第１四半期分）", budget: 1800, actual: 823 },
    ],
  },
};

/** Regional data analysis (地域データ分析): scatter + bar. */
const regional: GoldenSample = {
  id: "regional",
  doc: {
    version: 1,
    meta: { title: "地域データ分析（人口動態）" },
    theme: { tokens: "@digital-go-jp/design-tokens@2.0.1", palette: "guidebook-neutral" },
    sources: [],
    queries: [
      {
        id: "q-density",
        source: "regions",
        sql: "SELECT density, aging_rate AS agingRate, population / 5000 AS markerSize FROM regions",
      },
      { id: "q-population", source: "regions", sql: "SELECT name, population FROM regions" },
    ],
    charts: [
      {
        id: "regional-density",
        type: "scatter",
        // `size` is a marker-diameter hint in pixels (build-options.ts's
        // scatterOption() passes it straight through as ECharts
        // `symbolSize`, unscaled) -- a raw population count here would
        // render markers tens of thousands of pixels wide, filling the
        // entire chart as a solid block (found by screenshotting this
        // exact sample during /code-review). `markerSize` is population
        // pre-scaled to a small pixel-appropriate range; `population`
        // itself stays a plain row field for the accessible fallback
        // table and the sibling bar chart, which have no such constraint.
        encoding: { x: "density", y: "agingRate", size: "markerSize" },
        query: "q-density",
        options: { title: "人口密度と高齢化率" },
      },
      {
        id: "regional-population",
        type: "bar",
        encoding: { x: "name", y: "population" },
        query: "q-population",
        options: { title: "地域別人口" },
      },
    ],
    layout: {
      grid: "guidebook-12col",
      items: [
        { chart: "regional-density", x: 0, y: 0, w: 7, h: 5 },
        { chart: "regional-population", x: 7, y: 0, w: 5, h: 5 },
      ],
    },
  },
  rowsByQuery: {
    "q-density": [
      { density: 1240, agingRate: 31.2, population: 48000, markerSize: 10 },
      { density: 3980, agingRate: 24.8, population: 152000, markerSize: 30 },
      { density: 620, agingRate: 38.5, population: 19000, markerSize: 4 },
      { density: 5510, agingRate: 21.1, population: 210000, markerSize: 42 },
    ],
    "q-population": [
      { name: "中央地区", population: 48000 },
      { name: "湾岸地区", population: 152000 },
      { name: "山間地区", population: 19000 },
      { name: "港北地区", population: 210000 },
    ],
  },
};

/** All 7 `ChartVariant` types appear at least once across these three. */
export const GOLDEN_SAMPLES: readonly GoldenSample[] = [applications, budget, regional];
