# ADR-0006: Separate license tracks for code (MIT) and Digital Agency design reference assets (PDL 1.0)

- **Status**: Accepted (2026-07-05, amended 2026-07-10, 2026-07-11 — chart-color re-derivation superseded, see below)
- **Deciders**: yotta

## Amendment (2026-07-11) — chart colors are consumed from design-tokens directly, not re-derived

PR-A (issue #9) installed `@digital-go-jp/design-tokens@2.0.1` and inspected its contents
directly (`node_modules/.../dist/tokens.d.ts` and `tokens.js`), rather than relying on the
2026-07-05 `/plan`-time research this ADR's Context section cites. **That research's central
factual claim — "that package has no categorical/chart color tokens, confirmed by inspecting
its contents: 177 color tokens are UI tokens, not chart palettes" — is wrong.** The installed
package contains:

- `Color.Primitive.{Blue, LightBlue, Cyan, Green, Lime, Yellow, Orange, Red, Magenta, Purple}`
  — full 13-step ramps (50–1200) per hue
- `Color.Neutral.SolidGray` — 12 steps, **including the "536" step** the M0 spike (issue #4)
  found on the guidebook's public color-palette pages and flagged as an "oddly-placed" value
  possibly specific to that page's own presentation — confirmed here as a real design-tokens
  value (`#767676`), not a transcription artifact
- `Color.Semantic.{Success, Error}` — 2 steps each, shared across every key color (no
  per-key variant exists — the M0 spike's `#850000` "orange/red-specific error" appears to
  have been a transcription artifact of that spike's WebFetch-sourced data; it does not
  correspond to anything in the authoritative package)

Every hex value spot-checked against the M0 spike's independently-transcribed table matched
exactly (Blue.900=#0017c1, Blue.600=#3460fb, Cyan.900=#006f83, SolidGray.536=#767676) — the
spike's manual transcription was accurate, but the underlying premise that transcription was
*necessary* was not.

**Consequence for this ADR**: `packages/core/src/theme/palette.ts` (PR-A) imports
`@digital-go-jp/design-tokens` and resolves `Color.Primitive`/`Color.Neutral`/`Color.Semantic`
values at runtime — there is no hand-transcribed hex table, and no re-derivation from
`policy-dashboard-assets`. This ADR's central question (is re-deriving PDL-1.0-sourced facts
into an MIT-licensed file legally sound?) **does not arise for chart colors in the actual
implementation** — design-tokens is unambiguously MIT (verified in its own repo and
`package.json`), with no PDL-covered source involved at any point. Decision §3's licensing
risk treatment, and Consequences' "(−) manual re-transcription" cost, are both **moot for
chart colors** as of PR-A; they may still apply to a genuinely PDL-sourced asset in the future
(e.g. the v1.0 administrative-boundary GeoJSON this ADR's Decision §2 already flags), which is
why this ADR is amended rather than superseded outright.

*(This is the third dated amendment on this ADR — a future documentation pass should consider
consolidating Context/Decision into the corrected state directly rather than accreting a
fourth; not done here since PR-A's thesis is the schema/theme implementation, not an ADR
rewrite.)*

## Amendment (2026-07-10)

The M0 chart-fidelity spike (issue #4; `docs/spikes/m0-charts.md`) re-derived the palette's
actual hex values directly from the Digital Agency's **public color-palette web pages**
(`digital.go.jp/resources/dashboard-guidebook/color-palette` and its `/color-code` subpage),
not from the `policy-dashboard-assets` repo referenced below. Neither this diff nor the
original Context section cites explicit license terms for the public web pages specifically
(the PDL 1.0 finding below was established for the `policy-dashboard-assets` repo, not the web
pages) — but this ADR's compliance conclusion doesn't depend on which of the two sources was
actually used: Decision §3's argument ("hex values are facts, not copyrightable expression")
is source-independent, and the risk treatment (low but non-zero, comply if challenged) is
unchanged either way. What *is* wrong in the Context section below is the **shape** of what's
re-derived: it is not simply "categorical color values." Each of the guidebook's 7 key-color
templates (Solid
Gray/Blue/Light Blue/Cyan/Green/Orange/Red) is a 6-step monochromatic chart ramp plus a shared
Yellow accent ramp and Semantic Success/Error colors — see the spike report and PRD F6
(corrected 2026-07-10) for the full structure. "8 hex values per theme" in the Alternatives
section below is likewise superseded: it's **8 values per key** (6 ramp steps + 1 Semantic
Success + 1 Semantic Error), **plus one shared Yellow accent ramp** (3 values: steps 800/600/
400) reused across all 7 keys rather than re-derived per key.

## Context

ADR-0004's Consequences section claimed "all chosen licenses (MIT/Apache-2.0) are compatible with Hyakkei's MIT" — true for every *code* dependency, but incomplete. `/plan` investigation (Architect + Market Research, independently) found that the actual source of the guidebook's categorical color values is not `@digital-go-jp/design-tokens` (npm, MIT — that package has no categorical/chart color tokens, confirmed by inspecting its contents: 177 color tokens are UI tokens, not chart palettes) but the **theme JSON files in `digital-go-jp/policy-dashboard-assets`** (the Power BI theme exports behind the dashboard guidebook), which are published under the **Digital Agency's Public Data License (PDL) 1.0** — a CC BY 4.0-equivalent license, not MIT. PDL 1.0 permits modification without attribution, but verbatim redistribution requires attribution.

Getting this wrong is exactly the kind of fact a public, MIT-licensed repo cannot afford to get wrong quietly — a LICENSE file that says "MIT" while silently bundling PDL-licensed assets is a real compliance problem, not a formality.

## Decision

Hyakkei tracks two separate license lineages and keeps them from bleeding into each other:

1. **All code is MIT** (per the repo `LICENSE`). This includes the renderer, editor, schema, bake function, guideline-rule *evaluation logic*, and every hand-written token/config value derived from public facts (see below).
2. **Digital Agency design reference assets consumed as data are PDL 1.0**, not MIT:
   - `policy-dashboard-assets` theme JSON (categorical/sequential color values, chart style facts) — PDL 1.0.
   - Administrative boundary GeoJSON from 国土数値情報 (v0.5 map charts) — separately licensed; decide precisely at v0.5, flagged here so it isn't forgotten.
   - `@digital-go-jp/design-tokens` and the React/HTML example-component repos remain **MIT** (verified directly in their repos) — these are not affected by this ADR; listed here only to make the boundary explicit.
3. **Hyakkei re-derives color values as its own independent token set** rather than bundling the theme JSON verbatim. The reasoning — hex values are facts, not copyrightable expression, so transcribing `#0017C1` into Hyakkei's own `packages/core/theme/palette.ts` is not a PDL redistribution — is a **reasonable position, not a settled legal conclusion**. Codex review (2026-07-05) correctly flagged that PDL 1.0 generally requires attribution for covered content, and while "simple numeric data/simple tables" being outside copyright protection supports this position, that's this project's interpretation, not confirmed legal advice. Treat this as **low but non-zero compliance risk**: if the Digital Agency or anyone else contests it, comply immediately (add attribution, or switch to an independently-sourced palette) rather than defend the position — this is a Semi One-way Door decision that should be revisited if challenged, not a hill to defend. What Hyakkei must not do regardless is ship `policy-dashboard-assets`' theme JSON *files* unmodified inside the MIT-licensed package tree without a PDL notice — that would be a clear violation, not a judgment call.
4. If a future feature needs to bundle a PDL asset **verbatim** (e.g. a bundled GeoJSON boundary file for v0.5 maps, if no independently-licensed source is used instead), it ships in a clearly separated location (e.g. `assets/pdl/`) with a `NOTICE` file citing the Digital Agency PDL 1.0 attribution requirement, and the top-level `LICENSE` gains a pointer to it. This is not needed for v0.1 (no verbatim PDL assets are bundled).

## Alternatives considered

1. **Bundle the theme JSON verbatim, add a NOTICE** — rejected for v0.1: adds a second license lineage to the repo for no benefit, since re-deriving 8 hex values per theme is trivial and carries zero attribution burden. Revisit if a future feature needs the *full* JSON structure (not just the color values), not just the palette.
2. **Ignore the distinction, keep claiming "all MIT"** — rejected: factually wrong once the theme JSON is the actual source, and public repos get read closely.
3. **Avoid Digital Agency design assets entirely, invent an original palette** — rejected: defeats the product's core value proposition (guideline-compliant color by default). The re-derivation approach in Decision §3 gets the compliance benefit without the licensing cost.

## Consequences

- (+) The `LICENSE` file's MIT claim stays accurate for the actual code tree.
- (+) No attribution burden for v0.1 *under this project's interpretation* (Decision §3): re-derived color values carry no NOTICE file, no PDL pointer in the README, as long as that interpretation stands unchallenged.
- (+) A clean precedent exists (`assets/pdl/` + `NOTICE` pattern) for v0.5 if bundling a boundary GeoJSON verbatim turns out to be the right call.
- (−) Color values must be manually re-transcribed (not auto-imported) from `policy-dashboard-assets` whenever the Digital Agency revises a theme — tracked under ROADMAP's "Design-system churn" risk (treat token upgrades as releases).
- (−) This ADR must be read before anyone considers vendoring further Digital Agency assets — a note to that effect belongs in `CONTRIBUTING.md` once that file exists (v0.2+).
