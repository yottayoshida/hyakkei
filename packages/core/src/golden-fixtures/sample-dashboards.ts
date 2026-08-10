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
//
// The data here is invented, and stays that way: covering 7 chart types means
// choosing rows that make each type render. What the public gallery publishes
// lives in `../gallery-samples/`, built from real e-Stat snapshots, and picks
// its chart types the other way round -- whatever the data supports. The two
// were one set of files until ADR-0021; merging them made one of the two jobs
// wrong, and in 2026-08 it was the published one that broke.
//
// issue #6/#10: each dashboard's authoring document is a canonical JSON
// exemplar (`applications.json`/`budget.json`/`regional.json`, this
// directory) -- these are the MCP contract's (issue #26) most-copied "what
// does a valid dashboard.json look like" reference, so they are loaded
// through `parseDashboard()` (the project's
// own contract function) rather than trusted as a bare TS literal. A JSON
// `import` widens every literal type (`version: 1` -> `number`, a chart's
// `type` -> `string`, discriminated unions collapse to their common shape),
// so `: Dashboard` / `satisfies Dashboard` cannot compile against the raw
// import -- `parseDashboard` is what actually re-narrows it, with a real
// schema check standing in for the type-checker's lost guarantee. The
// `golden-samples.roundtrip.test.ts` file in this directory is the CI-side
// half of that guarantee: it re-validates authoring form, bakes, and
// re-validates baked form for all three samples on every run.
import { formatParseFailure, parseDashboard, type Dashboard } from "@hyakkei/schema";
import applicationsDoc from "./applications.json" with { type: "json" };
import budgetDoc from "./budget.json" with { type: "json" };
import regionalDoc from "./regional.json" with { type: "json" };
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

/**
 * Fail-fast, narrowing load: a JSON import's type is always widened (see
 * this file's top comment), so `raw` arrives as `unknown` here rather than
 * an unchecked `as Dashboard` cast -- `parseDashboard` is the one place that
 * turns it back into a real `Dashboard`, with a thrown, actionable reason if
 * a fixture edit ever drifts out of schema. `removeAdditional: false`
 * (validate.ts) means the returned `.value` is the same object reference,
 * not a stripped copy, so this adds a checkpoint without changing what
 * downstream `bake()`/render calls actually see.
 *
 * `id` is taken here (not just by the caller) so it's written once per
 * sample, not once for the `GoldenSample.id` field and again for this call's
 * error-message argument (/simplify, simplification finding: two hand-typed
 * copies of the same id could silently diverge).
 */
function goldenSample(id: string, raw: unknown, rowsByQuery: Record<string, Row[]>): GoldenSample {
  const result = parseDashboard(raw);
  if (!result.ok) {
    throw new Error(
      `golden sample '${id}' is not a valid Dashboard: ${formatParseFailure(result)}`,
    );
  }
  return { id, doc: result.value, rowsByQuery };
}

/** Administrative procedure application status (行政手続き申請状況): bar + line + stat. */
const applications = goldenSample("applications", applicationsDoc, {
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
});

/** Budget execution results (予算執行実績): area + pie + table. */
const budget = goldenSample("budget", budgetDoc, {
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
});

/** Regional data analysis (地域データ分析): scatter + bar. */
const regional = goldenSample("regional", regionalDoc, {
  "q-density": [
    // `size` is a marker-diameter hint in pixels (build-options.ts's
    // scatterOption() passes it straight through as ECharts `symbolSize`,
    // unscaled) -- a raw population count here would render markers tens
    // of thousands of pixels wide, filling the entire chart as a solid
    // block (found by screenshotting this exact sample during
    // /code-review). `markerSize` is population pre-scaled to a small
    // pixel-appropriate range. Rows carry exactly q-density's own SELECT
    // list (density/agingRate/markerSize, per regional.json's SQL) -- a
    // raw `population` field does NOT belong here (/code-review finding):
    // this chart's accessible fallback table only reads its own encoding
    // columns [density, agingRate, markerSize], never population, and the
    // sibling bar chart reads population from its own independent
    // `q-population` query below, not from this one. A `population` field
    // added here would be dead weight that could silently drift from
    // q-population's numbers on a future data refresh.
    { density: 1240, agingRate: 31.2, markerSize: 10 },
    { density: 3980, agingRate: 24.8, markerSize: 30 },
    { density: 620, agingRate: 38.5, markerSize: 4 },
    { density: 5510, agingRate: 21.1, markerSize: 42 },
  ],
  "q-population": [
    { name: "中央地区", population: 48000 },
    { name: "湾岸地区", population: 152000 },
    { name: "山間地区", population: 19000 },
    { name: "港北地区", population: 210000 },
  ],
});

/** All 7 `ChartVariant` types appear at least once across these three. */
export const GOLDEN_SAMPLES: readonly GoldenSample[] = [applications, budget, regional];
