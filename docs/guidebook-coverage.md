# Guidebook coverage

What the Digital Agency dashboard guidebook asks for, and what hyakkei currently does about each item.

- **Guidebook version**: [ダッシュボードデザインの実践ガイドブック](https://www.digital.go.jp/resources/dashboard-guidebook) PDF v02 (2026-03-31), all 59 pages, plus the official 27-item checklist and the [カラーパレットの使い方](https://www.digital.go.jp/resources/dashboard-guidebook/color-palette) page (最終更新 2026-07-17)
- **Machine-checkable principles found**: **22**
- **Addressed by a named rule**: **3** — of which **1** has a runtime predicate
- **Guaranteed in practice** (rule-enforced *or* impossible to violate): **8**
- **Needs a new schema field before it can be satisfied at all**: **4** (a fifth, the vertical grid, needs a *breaking* change — see below)
- **Known defects** (implemented, and wrong): **2**

*These do not sum to 22 — some principles fall in two rows. See [Which number to quote](#which-number-to-quote) before citing any of them.*

> **Attestation**: reconciled against guidebook PDF v02 and the official checklist on **2026-07-27** by an inventory pass over the full document. Not yet re-read by a human against the source. Sign below when that happens.
>
> | Date | Reconciled by | Guidebook version | Notes |
> | --- | --- | --- | --- |
> | 2026-07-27 | (automated inventory, unreviewed) | PDF v02 | Initial pass |
> | 2026-07-27 | role layer re-read from all 7 official reference images (#122) | color-palette page, 最終更新 2026-07-17 | Row 8 moved defect → by construction. Retrieval date is pinned in code as `GUIDEBOOK_ROLE_SOURCE` (`packages/core/src/theme/palette.ts`); these two dates are meant to be reconciled together |

## Why this file exists

"Have we covered the guidebook?" cannot be answered by a test — what the guidebook contains is external knowledge. "Does this inventory match the code?" can be. This file makes that substitution: it is the denominator for every conformance claim hyakkei makes, and a test can pin the id set here against `guideline-rules.json`.

The claim form is therefore *"conforms to N of the 22 machine-checkable principles in guidebook version X"* — never "fully conformant" ([ADR-0017](./adr/0017-v1-is-agent-generated-dashboards.md) Decision 5).

## How principles were classified

- **A — machine-checkable**: decidable from a chart spec plus data rows (plus theme/layout JSON). Counted in the 22.
- **B — needs rendered output or visual judgement**: e.g. "give emphasis," "don't make people wait." Not counted.
- **C — needs understanding of purpose or context**: e.g. "define the objective with 5W1H," "reflect only requests with a clear rationale." Not counted.

The A/B/C line involves judgement. **22 is "checkable without inventing a threshold the guidebook does not state."** Allowing invented thresholds would push it to 28; a stricter reading gives 16. Cross-checked against the Digital Agency's own 27-item checklist, which yields 12 machine-checkable (44%) against this inventory's 46% — close enough to treat the counting method as sound.

## Status vocabulary

| Status | Meaning |
| --- | --- |
| **active** | A runtime predicate exists and fires. Counted as covered. |
| **by construction** | The schema cannot express a violation. Counted as covered — this is a *stronger* guarantee than a warning, not a weaker one ([ADR-0016](./adr/0016-guideline-nudge-scope.md), [ADR-0017](./adr/0017-v1-is-agent-generated-dashboards.md) Decision 7) |
| **not expressible** | The schema has no field for the thing the guidebook requires, so hyakkei cannot satisfy it at all. Needs an additive schema change |
| **not covered** | Expressible and checkable, just not done yet |
| **defect** | hyakkei implements this and gets it wrong. Tracked as a conformance issue |

## The 22

### Chapter 3 — Prototyping (p14–26)

| # | Principle | Source | Status | Notes |
| --- | --- | --- | --- | --- |
| 1 | Lay out on a 16:9 screen, grid-divided 2–6 ways **vertically and horizontally** | p23, p51 | **defect** | Horizontal is fine — `guidebook-12col` divides by 2/3/4/6. **Vertical is unconstrained**: `LayoutItem.y` allows 0–100,000 and `h` allows 1–10,000 (`MAX_LAYOUT_Y` / `MAX_LAYOUT_H`, `packages/schema/src/common.ts`). Those are numeric-safety ceilings, not the guidebook's vertical grid. Tracked as [#123](https://github.com/yottayoshida/hyakkei/issues/123) |
| 2 | Place filters at the top or left; place what they affect below or to the right | p25 | **not expressible** | No filter UI exists at view time by design (ADR-0005 — baked output has no live filtering). Revisit only if a connected viewer is ever decided |

### Chapter 4.2 — Choosing a chart type (p30–34)

| # | Principle | Source | Status | Notes |
| --- | --- | --- | --- | --- |
| 3 | A line chart's horizontal axis must be time; if it is not, consider a bar chart | p31 | **not covered** | Checkable — column type is available from DuckDB. Highest value-per-effort of the uncovered items |
| 4 | To compare quantities across time, use line or area, not bar | p32 | **not covered** | Same mechanism as #3 |
| 5 | Use a bar chart when an area chart has many series or does not convey change over time | p33 | **not covered** | Series count is in the spec |
| 6 | A pie chart suits a known total shown as compact proportions; otherwise a bar chart is more accurate | p34 | **active** + **defect** (`pie-too-many-slices`) | **The threshold is not from the guidebook.** `threshold: 6` fires at 7+ slices; a full-text search finds **no numeric limit on pie categories anywhere in the guidebook**. The only sourced number nearby is "roughly 1–5 colors" (p45/p54). Tracked as [#123](https://github.com/yottayoshida/hyakkei/issues/123) |

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
| 12 | Define the data — what it covers, what the numbers mean, when it was updated — reachably | p41 | **not expressible** | No schema field. Presence is trivially checkable once one exists |
| 13 | State metadata: source, update date, as-of time, notes, disclaimers | p41 | **not expressible** | `BakedDashboard.meta` carries `generatedAt` / `sourceDataAsOf` / `hyakkeiVersion`, but **the renderer never draws them** — verified: zero references to those fields anywhere in non-test `packages/core/src/renderer/`, and no `meta` reference in `mount.ts` at all. The data is in the artifact and invisible to whoever opens it. Authoring-side `sourceNote` has no field at all |

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
| 23 | Give charts alternative text | p56 | **not expressible** | No `altText` field. The renderer does emit an accessible data-table fallback per chart, which is adjacent but not the same thing |
| 24 | Publish a text summary of the dashboard (for public-facing dashboards) | p56 | **not expressible** | No schema field |

*(Numbering runs to 24 because #11/#21 are the same principle and #21 is a cross-reference; the count of distinct machine-checkable principles is 22.)*

## One rule in `guideline-rules.json` is not in this table

`guideline-rules.json` carries four rules; three appear above (`pie-too-many-slices` → #6, `truncated-axis` → #20, `3d-anything` → #17). **`palette-order` is deliberately absent, because it has no guidebook text behind it.**

A full-text search of the guidebook finds no statement about ramp-position ordering within a palette's roles. The rule's only source is the `dataColors` ordering in the official Power BI theme JSON — a real artifact, but not a principle the guidebook states, so it does not belong among the 22.

**This matters for any test that pins this file against `guideline-rules.json`**: the id sets are *not* equal and should not be asserted equal. The correct assertion is that every id in this table which names a rule appears in `guideline-rules.json`, plus an explicit allowance for `palette-order` as the one rule with a non-guidebook source. Asserting plain set equality will fail on a difference that is by design.

`palette-order` is separately affected by [#122](https://github.com/yottayoshida/hyakkei/issues/122) (the color-role correction) and [#123](https://github.com/yottayoshida/hyakkei/issues/123) (its citation currently points nowhere).

## Summary by status

| Status | Count | Items |
| --- | --- | --- |
| **active** | 2 | #6 (threshold unsourced), #9 |
| **by construction** | 6 | #7, #8, #11, #17 (partial), #18, #20 |
| **not covered** | 7 | #3, #4, #5, #10, #14, #15, #19 |
| **not expressible** | 5 | #2, #12, #13, #23, #24 |
| **defect** | 2 | #1 vertical grid, #6 threshold |

Rows overlap on purpose, so they do not sum to 22:

- **#6 is both `active` and a `defect`** — the rule runs, on a threshold the guidebook does not state
- **#16 and #22 are partial** (`partly by construction`, `partly covered`) and sit in neither column cleanly

### Which number to quote

Three defensible counts, so state which one is meant:

| Reading | Count | Use when |
| --- | --- | --- |
| Principles a **named rule** addresses | **3** (#6, #17, #20) | What `guideline-rules.json` actually claims |
| …of those, with a **runtime predicate** | **1** (#6) | Whenever "enforced" might be read as "checked at runtime" |
| **active + by construction** — the guarantee actually delivered | **8** | **The headline figure.** What a user gets, rather than what the rule engine does |

Two of the eight are enforced outside the rule engine and so do not appear in the "3": #9's 3:1 contrast check lives in the palette layer, and #11's decal is set unconditionally by the renderer. Both run on every render; neither is a nudge.

**The honest short form: 22 principles identified, 8 guaranteed, 3 addressed by named rules, 1 with a runtime predicate, 2 known defects.**

## The four that need schema fields

These fail differently from the doc-only rules. A doc-only rule means *the schema cannot express the violation* — a guarantee. These mean *the schema cannot express the requirement* — a gap. That distinction is why [ADR-0017](./adr/0017-v1-is-agent-generated-dashboards.md) Decision 7 extends the schema for these and not for the others.

| Field | Serves | Shape |
| --- | --- | --- |
| `altText` | #23 | Per chart |
| summary text | #24 | Per dashboard |
| `updatedAt` | #13 | Authoring-side, distinct from `BakedDashboard.meta.sourceDataAsOf` |
| `sourceNote` | #12, #13 | Per source or per dashboard |

All four are **additive** — new optional fields, nothing previously valid becomes invalid — and keep `"version": 1`. Tracked as [#124](https://github.com/yottayoshida/hyakkei/issues/124).

### Two that were on this list and should not have been

- **`decal`** — already implemented. `build-options.ts:207` sets `aria.decal.show` unconditionally; the M0 spike verified real `<pattern>` output in a browser. It was listed here on a code-reading inference that a one-line grep would have refuted. See #11 above.
- **The vertical grid constraint (#1)** — **not additive**, so it does not belong beside the four. Every other entry adds an optional field; this one would *narrow* `LayoutItem.y`/`h`, making documents that validate today fail tomorrow. That is a breaking schema change and would force `"version": 2` under the maintenance policy — which is reason enough to settle the prior question first: does a 16:9 vertical division even apply to a scrolling web dashboard? The guidebook does not say. Tracked in [#123](https://github.com/yottayoshida/hyakkei/issues/123), deliberately not in #124.

## Sources

- Guidebook PDF v02 — [ダッシュボードデザインの実践ガイドブック](https://www.digital.go.jp/resources/dashboard-guidebook)
- [カラーパレットの使い方](https://www.digital.go.jp/resources/dashboard-guidebook/color-palette) / [カラーコード一覧](https://www.digital.go.jp/resources/dashboard-guidebook/color-palette/color-code)
- Official 27-item checklist (xlsx, distributed with the guidebook)
- [digital-go-jp/policy-dashboard-assets](https://github.com/digital-go-jp/policy-dashboard-assets) — Power BI themes and boundary data

Guidebook content is licensed under [公共データ利用規約（第1.0版）](https://www.digital.go.jp/resources/open_data/public_data_license_v1.0) (PDL 1.0), which the license itself states is CC BY 4.0-compatible and permits commercial use. Quoting principles here and encoding them as data is within that grant; attribution and a note of modification are required where content is adapted (ADR-0006).
