# Guidebook coverage

What the Digital Agency dashboard guidebook asks for, and what hyakkei currently does about each item.

- **Guidebook version**: [ダッシュボードデザインの実践ガイドブック](https://www.digital.go.jp/resources/dashboard-guidebook) PDF v02 (2026-03-31), all 59 pages, plus the official 27-item checklist and the [カラーパレットの使い方](https://www.digital.go.jp/resources/dashboard-guidebook/color-palette) page (最終更新 2026-07-17)
- **Machine-checkable principles found**: **22**
- **Addressed by a named rule**: **3** — of which **1** has a runtime predicate
- **Guaranteed in practice** (rule-enforced *or* impossible to violate): **9**
- **Needs a new schema field before it can be satisfied at all**: **0**
- **Known defects** (implemented, and wrong): **0** — the one runtime rule fires on a threshold hyakkei chose, disclosed in its own citation; the guidebook states no numeric limit. Separately, `getGuidelineRules()` fails open, which [ADR-0016](./adr/0016-guideline-nudge-scope.md) records as a false-compliance risk on any path that reports "0 nudges" as a guarantee — that is a property of the engine, not of a guidebook principle, so it is not counted here and is not fixed by a zero in this row

*These do not sum to 22 — some principles fall in two rows. See [Which number to quote](#which-number-to-quote) before citing any of them.*

> **Attestation**: reconciled against guidebook PDF v02 and the official checklist on **2026-07-27** by an inventory pass over the full document. Not yet re-read by a human against the source. Sign below when that happens.
>
> | Date | Reconciled by | Guidebook version | Notes |
> | --- | --- | --- | --- |
> | 2026-07-27 | (automated inventory, unreviewed) | PDF v02 | Initial pass |
> | 2026-07-27 | role layer re-read from all 7 official reference images (#122) | color-palette page, 最終更新 2026-07-17 | Row 8 moved defect → by construction. Retrieval date is pinned in code as `GUIDEBOOK_ROLE_SOURCE` (`packages/core/src/theme/palette.ts`); these two dates are meant to be reconciled together |
> | 2026-07-29 | citation pages read individually with `pdftotext -f N -l N`, each checked against the page's own printed footer (#123) | PDF v02, retrieved 2026-07-29 | p34 / p41 / p44 / p47 confirmed; the PDF's page index and its printed page number coincide. Two things worth carrying forward: p44 *opens* on a different Do/Don't item, so "p44" alone does not identify the 3D one; and the file served at that URL has `Last-Modified: 2026-07-17` while its filename, cover and download page all still say v02 / 2026-03-31 — **the same URL and the same version label have already served more than one byte stream**, so page numbers can move without the version changing. Re-verification is tracked separately |
> | 2026-08-02 | p41 re-read and **p56 read for the first time**, same `pdftotext -f N -l N` method, URL taken from `guideline-rules.json` rather than retyped (#124) | PDF v02, retrieved 2026-08-02, `Last-Modified: Fri, 17 Jul 2026 07:48:20 GMT` — **unchanged since the 2026-07-29 row**, 22,955,744 bytes | p41 and p56 both confirmed; PDF page index equals printed footer, as on the pages above. p41 lists データの更新日 and いつ時点の数値なのか as **two separate items**, which is why `meta.updatedAt` and `BakedMeta.sourceDataAsOf` are separate fields rather than one. p56's three items map to rows #22 / #24 / #23 in that order. **Carry forward: p56's body text reads 「グラフやグラフに代替テキストを付与し」— the duplicated word is in the source**, presumably for 「グラフや表に」. Quote the heading 「代替テキストを付与する」, not the body: correcting the body would put the citation at odds with the document it cites |

## Why this file exists

"Have we covered the guidebook?" cannot be answered by a test — what the guidebook contains is external knowledge. "Does this inventory match the code?" can be. This file makes that substitution: it is the denominator for every conformance claim hyakkei makes, and a test can pin the id set here against `guideline-rules.json`.

The claim form is therefore *"conforms to N of the 22 machine-checkable principles in guidebook version X"* — never "fully conformant" ([ADR-0017](./adr/0017-v1-is-agent-generated-dashboards.md) Decision 5).

## How principles were classified

- **A — machine-checkable**: decidable from a chart spec plus data rows (plus theme/layout JSON). Counted in the 22.
- **B — needs rendered output or visual judgement**: e.g. "give emphasis," "don't make people wait." Not counted.
- **C — needs understanding of purpose or context**: e.g. "define the objective with 5W1H," "reflect only requests with a clear rationale." Not counted.

The A/B/C line involves judgement. **22 is "checkable without inventing a threshold the guidebook does not state."** Allowing invented thresholds would push it to 28; a stricter reading gives 16. Cross-checked against the Digital Agency's own 27-item checklist, which yields 12 machine-checkable (44%) against this inventory's 46% — close enough to treat the counting method as sound.

That test applies to **the principle**, not to hyakkei's current implementation of it — the two come apart, and row #6 is where. p34 is checkable without inventing a number (a pie whose slices do not sum to a known whole, or that carries negative values, is decidable from the rows alone), which is why it counts toward the 22. What hyakkei actually ships for it is a slice-count heuristic on a threshold hyakkei chose; the threshold-free reading is not implemented. Row #6 records both, and its citation discloses the second to the user.

## Status vocabulary

| Status | Meaning |
| --- | --- |
| **active** | A runtime predicate exists and fires. Counted as covered. |
| **by construction** | The schema cannot express a violation. Counted as covered — this is a *stronger* guarantee than a warning, not a weaker one ([ADR-0016](./adr/0016-guideline-nudge-scope.md), [ADR-0017](./adr/0017-v1-is-agent-generated-dashboards.md) Decision 7) |
| **not expressible** | The schema has no field for the thing the guidebook requires, so hyakkei cannot satisfy it at all. Needs an additive schema change |
| **supported** | The schema can express it, the renderer publishes it, and a test pins that it is drawn — but no rule requires an author to fill it in, and nothing checks whether what they wrote is true. Presence is satisfied; content is unverified. **Not counted toward "guaranteed in practice"** (that row is `active` + `by construction` only), so this status moves no headline figure |
| **not covered** | Expressible and checkable, just not done yet |
| **defect** | hyakkei implements this and gets it wrong. Tracked as a conformance issue |

## The 22

### Chapter 3 — Prototyping (p14–26)

| # | Principle | Source | Status | Notes |
| --- | --- | --- | --- | --- |
| 1 | Place elements **along the layout grid** | p23, p51 | **by construction** | **This row previously read "Lay out on a 16:9 screen, grid-divided 2–6 ways vertically and horizontally" and was marked a defect. That was a misreading of the guidebook, corrected 2026-07-29 ([#123](https://github.com/yottayoshida/hyakkei/issues/123)).** p51 says the supplied grid *is designed so that* a 16:9 screen **can** be divided 2–6 ways, "flexibly, to suit the purpose" — a description of what the template affords, not a rule that a layout must use one of those divisions. The instruction is p23's: place components "along the grid" (グリッドに沿って配置します). That is what the schema cannot express a violation of: `Grid` is `Type.Union([Type.Literal("guidebook-12col")])` — a single grid, not selectable — and `x`/`y`/`w`/`h` are all integers (`packages/schema/src/common.ts`), so no document can place anything off-grid. What is *not* enforced is any particular division: `w` is an integer 1–12, so `w: 5` validates. Narrowing it was considered and rejected — it would be a breaking schema change, and the guidebook does not ask for it. The 16:9 framing itself does not transfer: a scrolling web dashboard has no fixed-height viewport to divide, which is why `MAX_LAYOUT_Y` / `MAX_LAYOUT_H` stay as numeric-safety ceilings |
| 2 | Place filters at the top or left; place what they affect below or to the right | p25 | **not expressible** | No filter UI exists at view time by design (ADR-0005 — baked output has no live filtering). Revisit only if a connected viewer is ever decided |

### Chapter 4.2 — Choosing a chart type (p30–34)

| # | Principle | Source | Status | Notes |
| --- | --- | --- | --- | --- |
| 3 | A line chart's horizontal axis must be time; if it is not, consider a bar chart | p31 | **not covered** | Checkable — column type is available from DuckDB. Highest value-per-effort of the uncovered items |
| 4 | To compare quantities across time, use line or area, not bar | p32 | **not covered** | Same mechanism as #3 |
| 5 | Use a bar chart when an area chart has many series or does not convey change over time | p33 | **not covered** | Series count is in the spec |
| 6 | A pie chart suits a known total shown as compact proportions; otherwise a bar chart is more accurate | p34 | **active** (`pie-too-many-slices`) | `threshold: 6` fires at 7+ slices, and **that number is hyakkei's, not the guidebook's** — a full-text search finds no numeric limit on pie categories anywhere in it. The only sourced number nearby is "roughly 1–5 colors" (p45/p54), which is about **colors, not categories**, so re-anchoring to 5 was considered and rejected. The threshold was kept at 6 and **the rule's own citation now says so, in the one string the nudge UI renders** — so a user reading the advisory sees whose judgement it is (2026-07-29, [#123](https://github.com/yottayoshida/hyakkei/issues/123)). No longer a defect: the defect was presenting an invented threshold as a guidebook rule, not the threshold itself. What the rule does **not** check is p34's actual principle — whether the total is known, whether proportions read compactly — and that gap is why "1 runtime predicate" should not be read as "1 principle verified" |

### Chapter 4.3 — Color palette (p35–38)

| # | Principle | Source | Status | Notes |
| --- | --- | --- | --- | --- |
| 7 | Choose from the 7 palettes (Blue / LightBlue / Cyan / Green / Orange / Red / SolidGray) | p35 | **by construction** | `Palette` is a closed schema enum |
| 8 | Chart colors follow the Primary / Secondary / Neutral + semantic role structure | p36, [color-palette page](https://www.digital.go.jp/resources/dashboard-guidebook/color-palette) | **by construction** (was **defect**, fixed 2026-07-27) | Not `active`: no runtime predicate checks this, and none is needed — `ChartOptions` has no color field and `theme` carries only `palette`/`appearance`, so a user cannot author a wrong role assignment. All seven palettes verified against the official reference images. The Secondary ramp is per-palette and takes three hues (Yellow ×5, Cyan→Green, Green→Cyan); `Neutral` now exists as a role. Two guidebook roles remain unimplemented — **Positive/Negative** (Cyan's Positive has no step meeting 3:1, deferred with a trigger) — and Orange/Red's per-palette **Error** `#850000` is not adopted (it reopens ADR-0009's palette-independence invariant). [ADR-0018](./adr/0018-chart-color-roles-follow-the-guidebook-role-layer.md); evidence `docs/spikes/guidebook-color-roles.md`. **The earlier framing of this defect ("`secondary` is another step of the primary's ramp") was itself wrong** — see the spike's dated correction |
| 9 | Contrast between background and chart color area must be ≥3:1 | p38 | **active** (not a nudge) | Enforced by `assertGraphicContrast` in the palette layer rather than surfaced as a per-document nudge |
| 10 | If 3:1 cannot be met, place the value next to the color area (value text ≥4.5:1 against background) | p38 | **not covered** | **Cheapest uncovered item** — cross-reference existing `getContrastWarnings()` against `showDataLabels` |
| 11 | Provide a non-color means of distinguishing categories | p38, p47 (D10) | **by construction** | `build-options.ts:207` sets `aria: { enabled: true, decal: { show: true } }` on the shared base every ECharts-backed variant spreads over, so bar/line/area/scatter/pie all get it and **no schema field can turn it off**. The M0 chart spike verified in a real browser that this emits genuine `<pattern>` fills, and called decal "load-bearing, not decorative" after finding color alone insufficient for the orange palette under deuteranopia. Caveat for future edits: the guarantee is against *users*, not against the code — `aria` sits before `...built`, so a variant that returned its own `aria` would silently win. None does today, and no test pins that |

### Chapter 4.4 — Chart design principles (p39–41)

| # | Principle | Source | Status | Notes |
| --- | --- | --- | --- | --- |
| 12 | Define the data — what it covers, what the numbers mean, when it was updated — reachably | p41 | **supported** | `meta.sourceNote` and `meta.updatedAt` ([#124](https://github.com/yottayoshida/hyakkei/issues/124)), drawn by the dashboard footer. The guidebook asks for the definition to be 参照できる rather than inline, which free text satisfies. Presence is checkable; whether the text is accurate is not |
| 13 | State metadata: source, update date, as-of time, notes, disclaimers | p41 | **partly by construction** | The three the artifact records itself — `sourceDataAsOf` / `generatedAt` / `hyakkeiVersion` — are `required` on `BakedMeta` and the footer draws them without a conditional, so a baked artifact that shows no as-of date is not a representable state. The rest (source, notes, disclaimers) live in the optional `sourceNote`, so a document can still omit them: that half is `supported`, not guaranteed. Counted in neither column, like #16 and #22 |

### Chapter 4.5 — Do's & Don'ts (p42–47)

All ten carry Do/Don't illustrations in the guidebook.

| # | Principle | Source | Status | Notes |
| --- | --- | --- | --- | --- |
| 14 | D1 — Show both an overall indicator and detail charts | p43 | **not covered** | Checkable via presence of a `stat` variant |
| 15 | D2 — Give chart item order meaning (by magnitude, by date, …) | p43 | **not covered** | Row order is inspectable |
| 16 | D3 — Remove unnecessary elements; keep background gridlines minimal | p44 | **partly by construction** | `ChartOptions` has no gridline setting to over-configure. The "information duplication" half is not checkable |
| 17 | D4 — No unnecessary decoration: no 3D, no drop shadows | p44 | **by construction** (partial) | `ChartVariant` has no 3D variant. **Drop shadows and gratuitous images are also in scope for D4** and are not covered — `3d-anything` matches only part of this principle |
| 18 | D5 — Limit the number of colors in a chart | p45 (the "roughly 1–5" figure appears only on p54) | **by construction** | Colors are derived deterministically from `(palette, appearance)`; a user cannot add more |
| 19 | D8 — Put the legend next to the chart; order it to match the chart | p46 | **not covered** | `ChartOptions.legend.position` already exists — checkable today |
| 20 | D9 — A chart's origin should be zero | p47 | **by construction** (`truncated-axis`, doc-only) | `ChartOptions` has no axis-minimum field and `build-options.ts` hardcodes `yAxis: { type: "value" }`. **Exact match with the guidebook's wording.** Making this "active" would require first adding the field that lets a user violate it |
| 21 | D10 — Do not rely on color alone to distinguish categories | p47 | see #11 | Same principle, counted once |

### Chapter 5 — Implementation (p48–56)

| # | Principle | Source | Status | Notes |
| --- | --- | --- | --- | --- |
| 22 | Publish the data file (Excel / CSV / HTML table) | p56 | **partly covered** | Export produces the dashboard; a downloadable data file alongside it is not part of the output |
| 23 | Give charts alternative text | p56 | **supported** | Optional top-level `Chart.altText` / `BakedChart.altText` survives bake; ECharts receives `aria.description`, and table/stat charts render one sanitized visually-hidden paragraph. The adjacent data-table fallback remains a separate affordance |
| 24 | Publish a text summary of the dashboard (for public-facing dashboards) | p56 | **supported** | `meta.summary` ([#124](https://github.com/yottayoshida/hyakkei/issues/124)), drawn at the top of the dashboard footer. Distinct from `description`, which is a one-line label. The three gallery samples carry real ones, and `golden-samples.roundtrip.test.ts` rejects a summary that only paraphrases `description` or cites a figure absent from the sample's own rows. Placement is a compromise: p56 frames the summary as something to read *instead of* the charts, so the top of the page would serve that reader better — a header row means shifting every tile down one row (`gridStyle`/`tileStyle` plus the editor's overlay coordinates), which is out of scope here. Revisit when M3 gives the artifact an outer shell |

*(Numbering runs to 24 because #11/#21 are the same principle and #21 is a cross-reference; the count of distinct machine-checkable principles is 22.)*

## One rule in `guideline-rules.json` is not in this table

`guideline-rules.json` carries four rules; three appear above (`pie-too-many-slices` → #6, `truncated-axis` → #20, `3d-anything` → #17). **`palette-order` is deliberately absent, because it has no guidebook text behind it.**

A full-text search of the guidebook finds no statement about ramp-position ordering within a palette's roles. The rule's only source is the `dataColors` ordering in the official Power BI theme JSON — a real artifact, but not a principle the guidebook states, so it does not belong among the 22.

**This matters for any test that pins this file against `guideline-rules.json`**: the id sets are *not* equal and should not be asserted equal. The correct assertion is that every id in this table which names a rule appears in `guideline-rules.json`, plus an explicit allowance for `palette-order` as the one rule with a non-guidebook source. Asserting plain set equality will fail on a difference that is by design.

`palette-order` was separately affected by [#122](https://github.com/yottayoshida/hyakkei/issues/122) (the color-role correction) and [#123](https://github.com/yottayoshida/hyakkei/issues/123). The latter is resolved: its citation used to claim a guidebook section that does not exist and carried no URL, and now names the Power BI theme JSON's `dataColors` ordering — the artifact this rule actually rests on — pinned to a commit, and says outright that the guidebook states no such rule.

## Summary by status

| Status | Count | Items |
| --- | --- | --- |
| **active** | 2 | #6 (threshold is hyakkei's, disclosed), #9 |
| **by construction** | 7 | #1, #7, #8, #11, #17 (partial), #18, #20 |
| **supported** | 2 | #12, #24 — expressible, drawn, and pinned, but unrequired and unverified. Counted toward neither `guaranteed` nor `not covered` |
| **not covered** | 7 | #3, #4, #5, #10, #14, #15, #19 |
| **not expressible** | 1 | #2 |
| **defect** | 0 | — |

Rows overlap on purpose, so they do not sum to 22:

- **#13, #16 and #22 are partial** (`partly by construction`, `partly by construction`, `partly covered`) and sit in neither column cleanly. The bold marks which reading applies: `**partly by construction**` is its own status and is not counted, while `**by construction** (partial)` — #17 — is counted with a caveat attached

The `defect` row stays at 0 rather than being deleted: the status is defined in the vocabulary above and will be needed again, and a row that disappears takes with it the record that two principles were once listed here (#1, on a misreading of the guidebook, and #6, for presenting hyakkei's threshold as the guidebook's). Both were resolved on 2026-07-29 by [#123](https://github.com/yottayoshida/hyakkei/issues/123) — see those rows.

### Which number to quote

Three defensible counts, so state which one is meant:

| Reading | Count | Use when |
| --- | --- | --- |
| Principles a **named rule** addresses | **3** (#6, #17, #20) | What `guideline-rules.json` actually claims |
| …of those, with a **runtime predicate** | **1** (#6) | Whenever "enforced" might be read as "checked at runtime" |
| **active + by construction** — principles hyakkei acts on rather than merely notes | **9** | **The headline figure.** What the product does, rather than what the rule engine does |

Three of the nine are enforced outside the rule engine and so do not appear in the "3": #9's 3:1 contrast check lives in the palette layer, #11's decal is set unconditionally by the renderer, and #1's on-grid placement is enforced by the schema itself. The first two run on every render; neither is a nudge.

**The nine are not nine equally strong guarantees, and this row is deliberately no longer labelled "the guarantee actually delivered."** Eight of them are `by construction` or enforced outside the engine — for those, a violation is unrepresentable, which is the strongest form available. The ninth, #6, is the weakest entry in the count: its predicate fires on a slice count against a threshold hyakkei chose, and p34's actual test — is the total known, do the proportions read compactly — is not implemented. It is counted because hyakkei acts on the principle rather than only recording it, and because a user authoring a 7-slice pie is told something true and useful; it is not counted as evidence that p34 has been verified. The disclosure that reaches the user lives in the rule's own citation.

**Read the "1 with a runtime predicate" narrowly** for the same reason: it counts the principles that have a predicate attached, not the principles a predicate verifies.

**The honest short form: 22 principles identified, 9 guaranteed, 3 addressed by named rules, 1 with a runtime predicate (on hyakkei's own threshold, disclosed), 0 known defects.**

## The four schema fields for Do-side principles

These fail differently from the doc-only rules. A doc-only rule means *the schema cannot express the violation* — a guarantee. These mean *the schema cannot express the requirement* — a gap. That distinction is why [ADR-0017](./adr/0017-v1-is-agent-generated-dashboards.md) Decision 7 extends the schema for these and not for the others.

| Field | Serves | Shape | Status |
| --- | --- | --- | --- |
| `meta.summary` | #24 | Per dashboard | **Landed** 2026-08-02 |
| `meta.updatedAt` | #12, #13 | Per dashboard, `format: "date"`, distinct from `BakedMeta.sourceDataAsOf` | **Landed** 2026-08-02 |
| `meta.sourceNote` | #12, #13 | Per dashboard | **Landed** 2026-08-02 |
| `Chart.altText` | #23 | Per chart | **Landed** 2026-08-06 |

All four are **additive** — optional fields, nothing previously valid becomes invalid — and keep `"version": 1`. The four-field batch is now landed under [#124](https://github.com/yottayoshida/hyakkei/issues/124).

Two shapes were settled when the first three landed ([ADR-0019](./adr/0019-guidebook-do-side-fields-and-dashboard-chrome.md)), and both differ from what this table said beforehand:

- **`sourceNote` is per dashboard, not per source.** `BakedDashboard` forbids `sources` outright (ADR-0005), so a per-source field is structurally unable to reach the artifact a third party opens — which is the only place the requirement has an audience.
- **The count above is no longer hand-maintained.** `citation-count-consistency.test.ts` derives "needs a new schema field" by looking each of these four up in the schema itself, because the change that moves this number is the change that adds the fields: a hand-typed count and a matching document edit would have turned every mirror green without a single field existing.

### Two that were on this list and should not have been

- **`decal`** — already implemented. `build-options.ts:207` sets `aria.decal.show` unconditionally; the M0 spike verified real `<pattern>` output in a browser. It was listed here on a code-reading inference that a one-line grep would have refuted. See #11 above.
- **The vertical grid constraint (#1)** — **the guidebook does not ask for it.** This entry read, until 2026-07-29, that a vertical constraint was owed but was *not additive* (it would narrow `LayoutItem.y`/`h`, breaking documents that validate today and forcing `"version": 2`), so the prior question had to be settled first: does a 16:9 vertical division apply to a scrolling web dashboard at all? [#123](https://github.com/yottayoshida/hyakkei/issues/123) settled it by reading the source instead of the summary. p51 describes what the supplied grid **affords** — a 16:9 screen *can* be divided 2–6 ways, "flexibly, to suit the purpose" — and p23's actual instruction is to place components **along the grid**, which the schema already makes unviolatable (see #1). So no field is owed here, and the breaking-change argument, while true, was never the reason. Deliberately not in #124.

## Sources

- Guidebook PDF v02 — [ダッシュボードデザインの実践ガイドブック](https://www.digital.go.jp/resources/dashboard-guidebook)
- [カラーパレットの使い方](https://www.digital.go.jp/resources/dashboard-guidebook/color-palette) / [カラーコード一覧](https://www.digital.go.jp/resources/dashboard-guidebook/color-palette/color-code)
- Official 27-item checklist (xlsx, distributed with the guidebook)
- [digital-go-jp/policy-dashboard-assets](https://github.com/digital-go-jp/policy-dashboard-assets) — Power BI themes and boundary data

Guidebook content is licensed under [公共データ利用規約（第1.0版）](https://www.digital.go.jp/resources/open_data/public_data_license_v1.0) (PDL 1.0), which the license itself states is CC BY 4.0-compatible and permits commercial use. Quoting principles here and encoding them as data is within that grant; attribution and a note of modification are required where content is adapted (ADR-0006).
