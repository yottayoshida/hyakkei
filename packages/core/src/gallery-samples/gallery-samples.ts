// The public gallery's seed dashboards (issue #23/#53), kept separate from
// `../golden-fixtures/` on purpose.
//
// Those two directories answer different questions and had been sharing one
// set of files. The golden fixtures exist to pin RENDERING: three dashboards
// that between them exercise all 7 `ChartVariant` types across 7 palettes and
// both appearances, so a change in the renderer shows up as a snapshot diff.
// This directory exists to show a READER what a well-formed dashboard looks
// like, built from data a third party can go and check.
//
// Merging the two makes one of them wrong. Chart-type coverage wants whatever
// data makes each of the 7 types render; a public sample wants whatever chart
// type the data actually supports. When the e-Stat snapshots were dropped into
// the golden fixtures (PR #151) the coverage requirement won by default and
// the samples inherited chart types their new data does not fit: a pie summing
// three percentages and one 万円 figure, an area chart whose x axis is
// prefectures, a line chart connecting 男性 to 女性, and a bar chart placing
// 全国 (11194) beside 沖縄県 (104) on one axis.
//
// So these samples use only the chart types their data supports -- bar, stat
// and table. `line` and `area` need a time axis, which none of these three
// tables carry at the single survey year committed here; `pie` needs parts of
// one whole in one unit; `scatter` cannot label its points (its encoding is
// x/y/size only), which makes it unreadable for five named regions. Adding a
// multi-year snapshot so the gallery can show a truthful line/area chart is
// tracked separately, not faked here.
//
// Everything else follows `../golden-fixtures/sample-dashboards.ts`: each
// document is a canonical `dashboard.json` exemplar loaded through
// `parseDashboard()` rather than trusted as a bare literal, because a JSON
// import widens every literal type and only the schema check narrows it back.
import { formatParseFailure, parseDashboard, type Dashboard } from "@hyakkei/schema";
import populationDoc from "./population.json" with { type: "json" };
import economyDoc from "./economy.json" with { type: "json" };
import administrationDoc from "./administration.json" with { type: "json" };
import populationRows from "./data/population-rows.json" with { type: "json" };
import economyRows from "./data/economy-rows.json" with { type: "json" };
import administrationRows from "./data/administration-rows.json" with { type: "json" };
import type { BakeMeta } from "../bake/bake.js";
import type { Row } from "../renderer/render-model.js";

/**
 * `sourceDataAsOf` is what `bake()` records about WHEN THE FROZEN ROWS WERE
 * CURRENT (schema `common.ts`), and every row here comes from the 1975年度
 * column of its e-Stat table -- confirmed by reading the three pages, whose
 * period selector defaults to 1975年度 and whose 全国 row matches the committed
 * CSV value for value. A fiscal year is a range and this field is a `date`, so
 * it is stamped with that year's last day rather than with the day the table
 * was published: 2026-02-20 is when e-Stat last updated the TABLE, and that
 * belongs in each document's own `meta.updatedAt`, which is the author's claim
 * about the upstream dataset. Stamping the publication date here would say the
 * rows are current as of 2026, which the same page's 要約 openly contradicts.
 */
export const GALLERY_BAKE_META: BakeMeta = {
  generatedAt: "2026-08-10T00:00:00Z",
  sourceDataAsOf: "1976-03-31",
  hyakkeiVersion: "0.1.0",
};

export type GallerySample = {
  id: string;
  doc: Dashboard;
  rowsByQuery: Record<string, Row[]>;
};

/** Fail-fast, narrowing load -- see `golden-fixtures/sample-dashboards.ts`. */
function gallerySample(
  id: string,
  raw: unknown,
  rowsByQuery: Record<string, Row[]>,
): GallerySample {
  const result = parseDashboard(raw);
  if (!result.ok) {
    throw new Error(
      `gallery sample '${id}' is not a valid Dashboard: ${formatParseFailure(result)}`,
    );
  }
  return { id, doc: result.value, rowsByQuery };
}

/** Population by prefecture, 1975年度 (e-Stat 0000010201): bar + stat + table. */
const population = gallerySample("population", populationDoc, populationRows);

/** Economic base, 1975年度 (e-Stat 0000010203): bar + table. */
const economy = gallerySample("economy", economyDoc, economyRows);

/** Administrative base, 1975年度 (e-Stat 0000010204): bar + table. */
const administration = gallerySample("administration", administrationDoc, administrationRows);

export const GALLERY_SAMPLES: readonly GallerySample[] = [population, economy, administration];
