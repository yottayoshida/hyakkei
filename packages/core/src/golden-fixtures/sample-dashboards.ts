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
// issue #6/#10: each dashboard's authoring document is a canonical JSON
// exemplar (`applications.json`/`budget.json`/`regional.json`, this
// directory) -- these become the M4 gallery seed and the MCP contract's
// (issue #26) most-copied "what does a valid dashboard.json look like"
// reference, so they are loaded through `parseDashboard()` (the project's
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
import applicationsRows from "./data/applications-rows.json" with { type: "json" };
import budgetRows from "./data/budget-rows.json" with { type: "json" };
import regionalRows from "./data/regional-rows.json" with { type: "json" };
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
const applications = goldenSample("applications", applicationsDoc, applicationsRows);

/** Budget execution results (予算執行実績): area + pie + table. */
const budget = goldenSample("budget", budgetDoc, budgetRows);

/** Regional data analysis (地域データ分析): scatter + bar. */
const regional = goldenSample("regional", regionalDoc, regionalRows);

/** All 7 `ChartVariant` types appear at least once across these three. */
export const GOLDEN_SAMPLES: readonly GoldenSample[] = [applications, budget, regional];
