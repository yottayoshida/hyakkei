# ADR-0021: The public gallery has its own samples, separate from the golden fixtures

- **Status:** accepted
- **Date:** 2026-08-10
- **Issues:** [#23](https://github.com/yottayoshida/hyakkei/issues/23), [#53](https://github.com/yottayoshida/hyakkei/issues/53)
- **Supersedes:** the "no new fixture directory" decision recorded in
  [ADR-0016](0016-guideline-nudge-scope.md) and in the header comment of
  `packages/core/src/guideline/guideline.acceptance.test.ts`

## Context

`packages/core/src/golden-fixtures/` held three dashboards serving two jobs at
once. As a **rendering pin** they must, between them, exercise all 7
`ChartVariant` types across 7 palettes and both appearances, so that any change
in the renderer surfaces as a snapshot diff. As the **M4 gallery seed** they are
published to GitHub Pages as the worked examples a reader opens to see what a
guidebook-conformant dashboard looks like.

ADR-0016 stated the reuse plainly — "the 3 existing GOLDEN_SAMPLES already serve
as the gallery, no new fixture directory is created for this" — and at the time
nothing distinguished the two jobs, because the fixtures carried invented data
shaped to fit their chart types.

That stopped holding when PR #151 replaced the invented rows with fixed
snapshots of three official e-Stat tables. The chart types stayed as coverage
had chosen them and the new data was fitted into them:

- a pie summing three percentages and one 万円 figure, in which 土地生産性
  (161.1万円) occupied 58% of a circle whose total, 275.68, means nothing;
- an area chart whose x axis was prefectures, drawing a progression from 全国
  through 北海道 to 宮城県;
- a line chart joining 男性 to 女性 as if the two were consecutive points;
- a bar chart placing 全国 (11194万人) beside 沖縄県 (104万人) on one axis,
  which flattened every other bar to nothing;
- a scatter chart whose `size` channel carried 投資的経費の割合 as a raw pixel
  radius, with no legend or alternative text saying so.

Every gate stayed green. Schema validation has nothing to say about units.
The reference lint checks ids, not meaning. `bake()` succeeds. The pixel goldens
compare each image only against the previous version of itself, so a wholesale
data swap simply became the new baseline. The single guideline rule with a
runtime predicate fires above 6 pie slices, and that pie had four. The defect
was found by opening the published page and reading it.

## Decision

Split the two jobs into two directories.

`packages/core/src/golden-fixtures/` returns to its pre-#151 contents and keeps
one job: pinning rendering. Its data is invented, its chart types are chosen for
coverage, and it is never published.

`packages/core/src/gallery-samples/` is new and holds what the gallery
publishes: `population`, `economy` and `administration`, built from the e-Stat
snapshots, exported as `@hyakkei/core/gallery-samples` and consumed by
`packages/app/scripts/build-gallery.mjs`.

A published sample uses only chart types its data supports. Today that is `bar`,
`stat` and `table`, enforced by an allowlist in
`gallery-samples.roundtrip.test.ts` rather than by a lint, because no check can
distinguish a line chart showing a trend from a line chart joining 男性 to 女性 —
only a person with the data in front of them can. Widening the allowlist is
meant to be a deliberate edit, with the reason for each currently-excluded type
recorded beside it.

## Consequences

The two directories can now move independently: coverage requirements cannot
reshape a public example, and a data refresh cannot silently drop a chart type
out of the renderer's snapshot coverage.

The gallery no longer demonstrates `line`, `area`, `pie` or `scatter`. That is
a real loss of shop-window breadth and it is honest: these three tables are a
single survey year across five regions, which supports none of those four. A
multi-year snapshot would let the gallery show a truthful line or area chart,
and is tracked as its own piece of work rather than approximated here.

Three guards specific to being a public example now exist, each falsified once
against the exact defect it names:

- chart types restricted to the allowlist above;
- no national total (`全国`) on a categorical axis beside individual regions,
  which tables are exempt from because a labelled 全国 row reads correctly;
- one consistent number of decimal places per table column. e-Stat publishes
  耕地面積比率 as `15.0` beside `13.7` and 財政力指数 as `0.500` beside `0.448`;
  a JSON number cannot hold a trailing zero, so these are carried as their
  published text. The first version of this guard measured only strings and let
  a value that had slipped back to a JSON number pass — the falsification pass
  is what found it.

Provenance moves with the data and gains what it was missing. Two of the three
snapshots recorded `surveyYear: "画面表示値"`, so a reader was told which e-Stat
table to consult but not which of its 50 survey years. All three pages were
opened: each defaults to 1975年度, and the committed rows for `population` and
`administration` match those pages value for value. `economy`'s data grid did
not render during that check, and `provenance.json` says so rather than
implying a verification that did not happen.

`BakedMeta.sourceDataAsOf` is stamped `1976-03-31` — the last day of the survey
year the rows describe. It had been `2026-02-20`, which is when e-Stat last
updated the *table*; that belongs in each document's `meta.updatedAt`, the
author's claim about the upstream dataset, and remains there. The two fields
are deliberately distinct (`packages/schema/src/common.ts`), and conflating
them had the published footer reading 「データ時点: 2026-02-20」 directly above a
summary beginning 「1975年度の…」.
