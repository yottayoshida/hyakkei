# M0/PR-0 spike: ECharts guidebook fidelity (issue #4)

**Status**: GO (ECharts) with one follow-up ask before PR-A locks palette structure.
**Scope**: ADR-0004's chart-library provisional row. Answers: can ECharts reproduce the
Digital Agency dashboard guidebook's 7 key-color palette exactly, with acceptable a11y and
performance, using the SVG renderer chosen for golden-test determinism (plan
§"技術選定")? Code lives in `spikes/charts/` (throwaway, gitignored except this report).

## Method

- **Palette source**: re-derived hex values, not the guidebook JSON/CSS bundled verbatim
  (ADR-0006). Transcribed from the Digital Agency's public color-palette pages
  (guidebook_02.pdf, published 2026-03-31):
  - <https://www.digital.go.jp/resources/dashboard-guidebook/color-palette>
  - <https://www.digital.go.jp/resources/dashboard-guidebook/color-palette/color-code>
- **Rendering**: ECharts 6.1.0 SSR mode — `echarts.init(null, null, {renderer:'svg', ssr:true})`
  + `chart.renderToSVGString()`. No browser/DOM needed for color-fidelity checks; this is the
  same mechanism PR-C's golden tests will use (`spikes/charts/render-svg.mjs`).
- **Contrast/color-vision**: WCAG 2.1 relative-luminance contrast ratio + a standard
  Viénot/Brettel dichromacy simulation, computed directly on palette values — not on
  rendered pixels, so results are renderer-independent (`spikes/charts/contrast.mjs`,
  `measure.mjs`).
- **ARIA/decal/perf**: real browser (Playwright chromium), since these are DOM-observable
  (`spikes/charts/aria-perf.html`, `run-aria-perf.mjs`).

## ⚠️ Source-data confidence caveat

Hex values were extracted via automated page fetches (summarization tool), not by reading raw
HTML/CSS or the PDF directly (the PDF exceeds this tooling's fetch size limit). The 7 keys' main
6-step chart ramps and the Success/Error semantic constants were **cross-checked across two
independent fetches and were internally consistent both times** — treated as reliable.

**One structural point is NOT resolved**: whether each colored key's categorical "accent" is a
shared Yellow ramp (as one fetch pass reported for Blue/Light Blue/Orange/Red), or whether
Cyan and Green specifically accent *each other* (as a different fetch pass reported), or both.
**Ask before PR-A locks `palette.ts`'s accent-color source of truth**: a two-minute visual
check of the live color-code page's Cyan and Green sections would settle this. Everything else
in this report does not depend on the answer.

## Findings

### 1. Exact hex fidelity — PASS (70/70)

7 key colors × 2 appearances × 5 ECharts-rendered chart types (bar/line/area/scatter/pie —
table/stat are direct-DOM per PR-B, not ECharts) = 70 combinations. Every requested hex code
appears byte-for-byte (case-normalized) in the rendered SVG output. **ECharts' SVG renderer
does not round or convert color values** — this is the core ADR-0004 question, answered yes.

*(Caught in Codex review, not the first pass: an earlier draft of `render-svg.mjs` computed
`buildThemeColors()`'s corrected, appearance-aware colors but then discarded them, rendering
and verifying against a second, still-buggy inline copy of the same insertion-order fallback
that finding 2 below describes fixing. The 70/70 result reported here is from the corrected
wiring — `chartOption()` now takes its primary/secondary/accent directly as parameters from
`buildThemeColors()`'s output, with no independent fallback logic of its own.)*

### 2. Contrast — 3 corrections made during the spike, 0 residual failures

Initial pass (naive theme derivation) found **11/70 checks below the 3:1 graphic-object
minimum** (WCAG SC1.4.11). Root-caused and fixed three of them structurally, not as one-off
color swaps:

- **Yellow accent step 600 (#D2A400) fails 3:1 against light background universally
  (2.19:1)**. Step 800 (#A58000) clears light-background contrast; step 400 (#FFC700) clears
  dark-background contrast. Step 600 is not usable as a standalone accent against either
  standard background — `derive-theme.mjs` now selects step by appearance, not a single
  constant.
- **Semantic Error's guidebook values against the dark background (#1A1A1A) — measured
  precisely, not assumed**: #850000 (used by the orange/red themes specifically) fails badly
  at **1.66:1**. #CE0000 (used by the other 5 themes) technically clears the 3:1 minimum, but
  only barely, at **3.00:1** — a hairline pass with essentially no margin. Since the guidebook
  defines no dark mode at all (confirmed absent from both source-page fetches), dark-mode
  semantic error is a **hyakkei extension** applied uniformly across all 7 themes rather than
  leaving 5 of them at a bare 3.00:1 with zero tolerance for rendering variance: borrows the Red
  ramp's lighter 400 step (#FF7171, measured **6.51:1** against the dark background — clears
  both the 3:1 graphic and 4.5:1 text thresholds with real margin), not a guidebook value.
- A third bug surfaced during root-causing: the naive `ramp[600] ?? Object.values(ramp)[1]`
  fallback (for gray's non-standard ramp, which has no "600" step) picked the wrong step,
  because **JS silently reorders all-numeric-string object keys to ascending numeric order
  regardless of insertion order** — `Object.values(ramp)[1]` was gray's 200-step, not the
  intended ~700-step neighbor. Fixed with an explicit `nearestStep()` lookup by numeric
  distance rather than insertion-order fallback (this is exactly the class of bug a shared
  `palette.ts` needs to be immune to for every future ramp that omits an expected step).

**After the first two fixes: 69/70 pass.** The one residual was cyan's own: its 600-step
secondary (#00A3BF vs #F8F8FB = 2.83:1) is inherently mid-saturation and marginally
low-contrast against near-white.

**Fixed during `/code-review` (2026-07-10), not left as a PR-A recommendation**: the first
instinct — promote cyan's secondary to its 900-step, "darker, comfortably clears 3:1" — was
measured before landing and found to be a worse regression than the failure it fixed: cyan's
900-step is *exactly* what `nearestStep(ramp, 900)` already picks as **primary**, so promoting
secondary to 900 would make primary and secondary the literal same color for every viewer, not
merely close under simulated color-blindness. Cyan's 1200-step (#003741) measures **12.21:1**
against the light background — clears 3:1 with wide margin and is a distinct color from
primary — and is what `derive-theme.mjs`'s `SECONDARY_STEP_OVERRIDE` now uses. **After all
three fixes: 70/70 pass, 0 residual WCAG failures.** `buildThemeColors()` also now asserts
(throws, not just documents) that every derived primary/secondary/accent clears 3:1 against
its background at the point of use — a future key, ramp, or background change that
reintroduces a sub-3:1 combination fails loudly instead of shipping silently.

Full 70-row contrast table and 126-row dichromacy table: `spikes/charts/output/measurements.json`.

### 3. Dichromacy (color-blindness) — decal is load-bearing, not decorative

6 of 126 checked pairs (primary/secondary/accent trio, 3 CVD types, 7 keys × 2 appearances)
flagged as likely indistinguishable (simulated-RGB distance < 40, a coarse spike-level
threshold — not a validated psychophysical cutoff; table re-measured after the cyan secondary
fix in finding 2 — full data: `spikes/charts/output/measurements.json`):

| Key | Appearance | CVD type | Pair | Distance |
|-----|-----------|----------|------|----------|
| orange | light | **deuteranopia** | secondary vs accent | **1** (near-total collision) |
| orange | light | protanopia | secondary vs accent | 33 |
| orange | light | tritanopia | secondary vs accent | 34 |
| orange | dark | tritanopia | primary vs secondary | 38 |
| red | light | tritanopia | secondary vs accent | 11 |
| lightBlue | light | tritanopia | primary vs secondary | 38 |

**Orange under deuteranopia (the most common color-vision deficiency) is a near-total
collision** — its 600-step orange and the shared yellow accent become almost the same
simulated color. For a pie chart using orange's own ramp plus the yellow accent (the exact
combination `render-svg.mjs` uses), a deuteranope cannot distinguish those two slices by color
alone. **Decal (pattern fill) is required for the orange theme's pie/categorical charts, not
optional** — confirmed the mechanism works (finding 5 below), so this is a config requirement
for PR-B (`aria.decal.show: true` unconditionally, not theme-conditional), not a missing
capability.

### 4. Contrast + dichromacy together: data-table fallback decision

Given finding 3, color alone is an insufficient encoding for at least the orange theme under
common CVD. **Decision (not yet implemented — PR-B scope)**: every chart type ships an
accessible data-table fallback carrying the same rows as the chart, associated via
`aria-describedby`, visually de-emphasized (e.g. visually-hidden or a collapsible disclosure)
but always present in the DOM — not conditional on theme or CVD detection (which the browser
cannot reliably report anyway). This was the plan's UX-flagged requirement
(`buildAccessibleDataTable(chart, rows)`); this spike confirms it's necessary rather than
precautionary.

### 5. ARIA — functional, correct with CJK data

`aria: {enabled: true}` produces a real, readable `aria-label` on the chart's DOM element,
including Japanese category names and values correctly:

> "This is a chart with type Pie chart.The data is as follows: the data for 申請受理 is 120,
> the data for 審査中 is 45, the data for 却下 is 12."
>
> (verbatim, including the missing space after "chart." — that's ECharts' own AriaComponent
> output, not a transcription artifact; persisted in `spikes/charts/output/aria-perf.json`)

No mangling of CJK text observed. This is ECharts' built-in `AriaComponent` (not custom code) —
free to use, needs to be turned on explicitly (`aria.enabled` defaults to off).

### 6. Decal — functional

`aria.decal.show: true` produces real `<pattern>` fill elements in the SVG output — verified
present in the orange-theme pie chart used for finding 3's worst case. Mechanism works; PR-B
needs to enable it unconditionally per finding 3/4, not leave it opt-in.

### 7. SVG performance — fast at typical chart scale

5,000-point scatter chart: **29.8–37.4ms (mean 32.1ms) across 5 repeated local runs** —
persisted as actual samples, not a single number (`spikes/charts/output/aria-perf.json`,
written by `run-aria-perf.mjs`, which now runs the measurement 5× per invocation after
`/code-review` found the original "~37-39ms across repeated runs" claim was backed by only one
persisted sample) — from `setOption()` call to ECharts' own `finished` event (actual
render-complete signal, not just the synchronous call returning). Well within an interactive
budget; the run-to-run variance is expected for real-browser timing and doesn't change the
conclusion. This was sampled at 5,000 points as representative of a plausible
single-chart row count, not as an exhaustive stress test — full large-data behavior (closer to
the M0 DuckDB spike's 100MB-CSV scale) is a production-perf question for M3, out of this
spike's scope.

### 8. CJK axis-label handling — real bug found and fixed (not just a UX nicety)

**ECharts' default `axisLabel.interval: 'auto'` silently drops category labels it judges would
overlap** — not ellipsis, not rotation, just complete omission from the rendered SVG with zero
visual indication anything is missing. Confirmed directly: rendering 3 long Japanese fiscal-
quarter labels ("令和6年度第1四半期" / "第2" / "第3") at a typical 480px chart width produced
only 2 of the 3 labels in the SVG's `<text>` elements — the middle one vanished entirely.

**Fix verified**: `axisLabel: {interval: 0, rotate: 45}` (schema already exposes rotation as
`ChartOptions.xAxisLabelRotate`, common.ts) restores all 3 labels. `render-svg.mjs` now applies
this for every category-axis chart type; all 70 fidelity checks still pass with it applied.

**Regression-guarded, not just documented (added in `/code-review`, 2026-07-10)**: the initial
version of this spike verified only that requested *hex colors* appeared in the rendered SVG
— it never checked that expected *label text* appeared, so a regression that silently dropped
the `interval: 0` fix would still have reported "70/70 pass." `render-svg.mjs` now also asserts
every expected category-label string is present in the SVG's `<text>` content for every
category-axis chart. Verified this actually catches the bug it's meant to catch: reverting the
fix locally reproduced 42/70 label failures (exactly the bar/line/area category-axis variants,
exactly the silently-dropped-label bug), confirming the guard is load-bearing, not decorative.

**Requirement for PR-B**: `buildOptions` must always set `axisLabel.interval` explicitly
(never inherit ECharts' `'auto'` default) for any category axis that can carry CJK text — this
is not a cosmetic preference, it's the difference between "long labels wrap or rotate" and
"long labels silently disappear with no error." PR-B's own golden/unit tests should carry
forward an equivalent label-presence assertion, not just a config-value assertion.

### 9. Font — system stack for product, bundled font for CI only

`@fontsource/noto-sans-jp` exists on npm (v5.2.9) but the full unpacked package is ~81MB —
far too large to bundle even a fraction of into a single-file export under ADR-0004's
"minimize surface" principle and ADR-0005's file-size discipline. **Decision**: ship the
product with a system font stack (`-apple-system, "Hiragino Sans", "Yu Gothic", "Meiryo",
sans-serif` — the standard cross-OS CJK-capable stack), zero bytes, zero network requests,
matching ADR-0005's `file://`-zero-network invariant by construction rather than by
CSP enforcement.

**Consequence for PR-C's golden CI**: a bare CI container may lack any CJK-capable system
font, which would make golden SVG text render differently (or as tofu boxes) than on a
developer's machine — this is a **Docker/CI-environment concern** (install a CJK font package
in the golden-generation container), not a product runtime dependency. Flagging explicitly so
PR-C doesn't rediscover this as a golden-flake mystery.

## GO / NO-GO

**(a) ECharts capability — GO.** Exact hex fidelity 70/70, contrast 70/70 (0 residual — the
cyan finding in §2 was fixed, not just documented), CJK labels correctly render without
clipping *given the config fix in finding 8*, which is now itself regression-guarded — see
finding 8's update — not just a PR-B reminder. ADR-0004's chart-library row moves from
provisional to **Accepted**, no Vega-Lite evaluation triggered.

**(b) Palette semantics — CONDITIONAL GO.** The 7-key-template structure (not "7-color
categorical", not "single-hue ramp + red accent" — see amendments below) is confirmed with
good source-data confidence, sufficient to unblock PR-A. **One point remains genuinely open,
not yet resolved by anything in this report or its `/code-review` follow-up**: whether Cyan
and Green's categorical accent is a shared Yellow ramp or whether they accent each other (§
"Source-data confidence caveat" above) — this needs a two-minute human visual check of the
live color-code page before `palette.ts` locks in its accent-color source of truth. Downstream
docs (ROADMAP, PRD, ADR-0006) must not describe this point as settled until that check happens
— an earlier draft of those three did exactly that and was corrected in `/code-review`.

## Required document corrections (this PR's scope)

- **ADR-0004**: chart-library row → Accepted (SVG renderer, ECharts 6.1.0; findings 1–9 above
  as the evidentiary basis). `packages/core`'s `echarts` dependency range is currently
  `^6.1.0` — PR-B (issue #8) changes this to an exact pin, since that's the version this spike
  validated against.
- **ADR-0006 amendment**: palette structure corrected from "single-hue ramp + red accent per
  theme" to "7 key-color templates (Solid Gray/Blue/Light Blue/Cyan/Green/Orange/Red), each a
  6-step monochromatic chart ramp plus a shared Yellow accent ramp and Semantic
  Success/Error, re-derived (not guidebook-JSON-verbatim) per this spike's palette-source.mjs".
- **PRD F6/§6.3**: `palette-order` nudge caveat resolved — palette is not a multi-hue
  categorical set (rule as originally written doesn't apply) nor a single-hue-ramp-plus-red
  (also wrong); it is a **7-choice key-color system where categorical distinction beyond 2–3
  series depends on decal, not hue alone** (finding 3/4). `palette-order` is re-scoped to
  "primary/secondary ordering within one key's ramp" and no longer claims a 7-color categorical
  semantic.
- **Issue #9 body**: "Guidebook 7-color palette as the default palette" corrected to "the 7
  key-color templates, each a monochromatic ramp + shared accent + semantic pair (not 7
  categorical series colors)"; acceptance criterion updated to include the light/dark
  `appearance` schema field (plan's user-confirmed decision) since design-tokens itself
  ships no dark-mode values (confirmed absent — dark is a hyakkei extension, documented in
  `derive-theme.mjs`).
