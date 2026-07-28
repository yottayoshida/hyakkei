# ADR-0018: Chart color roles resolve from the guidebook's published role layer, not from the token package's primitives

- **Status**: Proposed
- **Date**: 2026-07-27
- **Deciders**: yotta
- **Plan**: `.claude/plans/2026-07-27-issue122-chart-color-roles.md`
- **Amends**: [ADR-0006](./0006-license-separation.md) (which source is authoritative for *what*), [ADR-0009](./0009-semantic-color-collision.md) (the set of accepted role collisions)
- **Supersedes the analysis in**: [`docs/spikes/guidebook-color-roles.md`](../spikes/guidebook-color-roles.md) §1 and §3, and the original body of [#122](https://github.com/yottayoshida/hyakkei/issues/122) — both were wrong on their central claim; see Context

## Context

`resolveChartColors` (`packages/core/src/theme/palette.ts`) derives every chart color from `@digital-go-jp/design-tokens`. ADR-0006 established the principle behind that — consume the authoritative source directly rather than hand-transcribing hex values off a web page — and it is still right.

What was wrong is an inference drawn from it. PRD §6.1 F6, ROADMAP's M0 note and ADR-0006's own amendment all record that the M0 spike's open question ("does Cyan accent Green, or does every palette share Yellow?") was **moot**, because the package "has no data encoding a per-key accent relationship at all." That is a true statement about the package and a false conclusion about the guidebook. The package carries primitive ramps and no role layer. **The role layer exists; it is published on the guidebook's own [カラーパレットの使い方](https://www.digital.go.jp/resources/dashboard-guidebook/color-palette) page** (最終更新 2026-07-17), as a per-palette reference image. Nobody had looked there.

Two sources, two jobs: **design-tokens is authoritative for primitive hex values; the guidebook page is authoritative for role assignment.**

### The issue that triggered this was itself wrong

Both #122 and the spike claimed the defect was that hyakkei resolves `secondary` from *the primary's own ramp* while the guidebook gives Secondary a different hue. Investigation rejected that:

- The guidebook's **Primary is a six-step ramp** (e.g. Blue 1200/900/600/400/200/50), and the official Power BI template's 7-category stacked bar consumes **four consecutive theme entries first**, then appends the Secondary ramp (`#A58000`/`#D2A400`/`#FFC700`). Secondary is not "the second series color"; it is the continuation/highlight color after Primary is exhausted. This matches the page's own wording — Secondary is 「ハイライトや複数系列を区別するために使用する**補助**色」.
- So hyakkei's `secondary = family 600` is Primary-ramp step 2, which is exactly what the official template paints category 2 with. Not a defect.
- hyakkei's `accent = Yellow` **is** the guidebook's Secondary. `ACCENT_STEP = {light: 800, dark: 400}` even matches the published Secondary ramp's endpoints.

The real defects are narrower and different:

| # | Defect | Scope |
| --- | --- | --- |
| 1 | The Secondary hue is hard-coded to Yellow for all seven palettes | Wrong for **Cyan** (→ Green) and **Green** (→ Cyan). 2 of 7 |
| 2 | `Neutral` (SolidGray) has no role at all | All palettes except `guidebook-neutral`, which the guidebook gives no Neutral row |
| 3 | `guidebook-neutral`'s second categorical step resolves to SolidGray 600 | The guidebook's SolidGray Primary ramp is 900/700/**536**/400/200/50 — it has no 600 step. `nearestStep(family, 600)` silently lands off-ramp |

**A role name is what produced the wrong issue.** "secondary" carried two meanings — the guidebook's role name and hyakkei's ramp-position name — in the same codebase and the same documents. The collision propagated a wrong finding into five records (the spike, #122, `guidebook-coverage.md` #8, ADR-0016, PRD §6.1/§6.3). Renaming is therefore not cosmetic; it is the fix for the mechanism that generated the error.

### Evidence

All seven reference images (3840×2160) and all seven official Power BI templates (`.pbit` → `Report/Layout`) were retrieved and read. Every role hex read off the images was diffed against design-tokens 2.0.1: **one mismatch, `Cyan 50`** (`#E6FCFF` on the 2026-07-17 page vs `#E9F7F9` in the package — see Consequences). Contrast ratios were recomputed independently. Full record: [`docs/spikes/guidebook-color-roles.md`](../spikes/guidebook-color-roles.md).

## Decision

### 1. Roles follow the guidebook's vocabulary, and the names say so

```
role         light   dark    family                       was
-----------  ------  ------  ---------------------------  -------------------
primary      900     400     own Primary ramp             primary (unchanged)
primaryAlt   600     600     own Primary ramp             secondary
secondary    800     400     SECONDARY_FAMILY[palette]    accent (Yellow-fixed)
neutral      800     400     SolidGray                    (new)
success / error                                           unchanged
```

`primaryAlt` is a coined name, deliberately: it does not exist in the guidebook, so it cannot be confused with a guidebook role. It means "the second step of this palette's own Primary ramp" and is defined as such at its declaration.

`guidebook-neutral`'s `primaryAlt` is **536, in both appearances**, because that palette's published ramp has no 600 step.

### 2. Steps are named by number, never by ramp position

`PRIMARY_RAMP[1]` is not usable as an abstraction: Blue's ramp starts at 1200 and SolidGray's at 900, so the same index means different steps. A position-index implementation would silently move `guidebook-neutral`'s light `primary` from `#1a1a1a` to `#4d4d4d`. The table maps **role → step number** per palette.

### 3. `neutral` models its absence explicitly

`neutral: string | null`. `null` is the *sanctioned* absence for `guidebook-neutral` only, checked through a single `isSanctionedAbsence(palette, role)` predicate. `undefined` is never tolerated — it means drift or an implementation gap and fails loudly. An `optional` field would collapse those two cases, and the pairwise distinctness matrix would silently pass on `undefined !== string`.

### 4. `neutral` does not join the ECharts categorical rotation

`color` stays `[primary, primaryAlt, secondary]`. Neutral means 「強調する必要のないデータや比較対象を表すために使用する控えめな色」 — putting it in the categorical cycle makes the third series de-emphasised by accident, which inverts the role. The guidebook's own overflow color is Secondary, confirmed from the official template's category ordering.

### 5. The step override stays, and its justification is rewritten

`SECONDARY_STEP_OVERRIDE` is renamed `PRIMARY_ALT_STEP_OVERRIDE` (it applies to `primaryAlt` now) and **keeps its single entry**: `guidebook-cyan` light resolves Cyan 600 `#00A3BF` at 2.83:1 against `#F8F8FB`, below the 3:1 floor.

Both prior explanations of this override are wrong:

- ADR-0016 called it evidence that "the guidebook has deliberate accessibility-driven exceptions." It does not — its only sanctioned fallbacks when 3:1 cannot be met are "place the value adjacent to the color area (≥4.5:1)" and "reveal it on hover/focus," never "shift the color."
- ADR-0016's 2026-07-27 read-forward note then replaced that with "the override is an artifact of hyakkei's own model and disappears once #122 lands." Also wrong, and in the opposite direction.

The accurate statement: **the guidebook's own published assignment does not satisfy the guidebook's own 3:1 floor against hyakkei's background.** Cyan Primary 600 is a real categorical color in the official Cyan template and measures 2.83:1. hyakkei prioritises the floor and shifts the step. The deviation is hyakkei's, the cause is upstream's, and it does not go away.

### 6. Two new role collisions are accepted, for a reason the existing three do not share

`guidebook-cyan` gains `secondary == success` in both appearances (`#197a4b` light, `#51b883` dark).

This is **not** a hyakkei construction. The guidebook's Cyan reference image paints Secondary 800 and Success as literally the same swatch, `#197A4B`; design-tokens derives `Semantic.Success["2"]` from the same Green 800. The dark pair follows because hyakkei's dark-semantic fallback borrows `Green 400`, which is also Cyan's dark Secondary. Avoiding the collision would mean departing from the published assignment to solve a problem the publisher did not consider one.

ADR-0009's reasoning still holds — `success`/`error` are consumed by no renderer, so nothing is drawn twice in the same color today. What changes is the **shape of the future revisit**: the colliding categorical role is no longer only `primary`. A semantic-marker consumer must be designed against two categorical role families, not one. ADR-0009 carries a dated note to that effect.

Both pairs are added to `KNOWN_ROLE_COLLISIONS` **with this decision already written down**, not after a red test.

### 7. The role table is the single source of truth, and it records when it was read

The mapping guidebook role → hyakkei field → step → source lives in exactly one place: a table at the top of `palette.ts`. `no-hardcoded-hex.test.ts` restricts hex literals to that file, so the structure already forces it. A `GUIDEBOOK_ROLE_SOURCE` constant records the URL, the retrieval date, and the page's own last-updated date.

This is a snapshot of a specification that moves independently of this repository — it moved on 2026-07-17, and nobody noticed for four months that the role layer existed at all. Runtime fetching is not an option (zero-network `file://` viewing is the product). Stamping *when it was read* is the cheapest thing that makes staleness detectable. It records an immutable fact, not a measurement, so it does not go stale the way a measured value would.

## Alternatives considered

| Option | Rejected because |
| --- | --- |
| **Implement #122 literally** — make `secondary` a different-hue family and drop the same-hue slot | Built on the role conflation the primary sources refute. Deletes the one color the official template actually uses for category 2, and asserts an override removal that measurement contradicts |
| **Follow the Power BI `dataColors` order** — `color = Primary 900/600/400/200/50` | Blue 200/50 measure 1.37:1 and 1.07:1 against the standard background. Adopting it means abandoning the 3:1 hard gate, a larger decision than this one. The templates are also weaker evidence than they look: all seven reuse Blue's `Report/Layout` verbatim (Cyan's report still paints Yellow secondaries and a stale `#E9F7F9`), so their weight is one design decision replicated seven times |
| **Add `positive`/`negative` now** | Cyan's Positive role has **no** step meeting 3:1 against `#F8F8FB` (600/200/50 → 2.83 / 1.20 / 1.00). Shipping it means weakening `assertGraphicContrast` or inventing a step the guidebook does not publish — a real design decision with no consumer to justify it. Deferred with a trigger: *when a renderer draws a delta or threshold indicator* |
| **Adopt the guidebook's per-palette Error** (`#850000` for Orange and Red) | Reopens ADR-0009's palette-independence invariant, which is a deliberate tripwire, and `error` has no renderer consumer. Split to a follow-up issue; the divergence is recorded in `guidebook-coverage.md` |
| **Keep `accent`/`secondary` and change only the family** | The names are what produced a wrong issue and a wrong spike section. Leaving them guarantees recurrence. `packages/core` is `private`, `version 0.0.0` — the rename costs nothing externally |

## Consequences

- **Six resolved values change**: `guidebook-neutral` `primaryAlt` (`#666666` → `#767676`, both appearances), `guidebook-cyan` `secondary` (`#A58000` → `#197A4B`, `#FFC700` → `#51B883`), `guidebook-green` `secondary` (`#A58000` → `#008299`, `#FFC700` → `#2BC8E4`). Twelve further values enter validation for the first time as the new `neutral` role.
- **A new golden fixture was required to make the change observable at all.** Before it, no snapshot in the repository baked `color[1]` or `color[2]` for any palette except orange, and `#666666` appeared zero times — "the change produced no golden diff" would have been unfalsifiable. `golden-palette.test.ts` now renders a three-slice pie for all 7 × 2 combinations, and asserts that data index N is painted with categorical slot N, read from ECharts' own `ecmeta_data_index` markers. (Two weaker drafts preceded it. The first counted distinct `fill="#rrggbb"` values against a threshold of three — measured, only two of those are non-series, so it could not distinguish "the whole trio reached the output" from "one of the three did." The second checked set membership, which cannot see slot order. Neither the fixture nor the assertion is load-bearing unless it can fail for the right reason.)
- **`assertGraphicContrast` passes all 14 combinations with no new override entries.** Every changed value clears 3:1 with margin — **3.83 – 8.69**, the floor being `guidebook-neutral`'s dark `primaryAlt` (`#767676`). The first draft of this line said 4.26 and had simply dropped the minimum; the twelve new `neutral` values sit at 6.11 and 11.92.
- **What the contrast gate does not measure: separation *between* series.** Every check in this repo is role-against-background. Measured inter-series contrast for the categorical trio at light appearance: `guidebook-cyan` slot 0 vs 2 is **1.09:1**, `guidebook-green` slot 1 vs 2 is **1.31:1** — neither separates in grayscale, on a monochrome print, or under tritanopia. Two things keep this from being a regression introduced here: the unchanged palettes are in the same band (`guidebook-orange` 1.16:1, `guidebook-blue` 1.35:1), so near-equiluminant pairs are a property of the guidebook's own assignment rather than of this change; and `aria.decal.show` is unconditional, so hue and luminance are not the only channels. What *is* new is that the worst case moved from 1.16 to 1.09, and that nobody had measured this axis at all. Recorded rather than fixed: making it a gate would require deviating from the published assignment, which is the decision this ADR exists to avoid.
- **The distributed artifact has no way to say which role model produced it.** A v1.0 output is a single HTML file handed to someone who installs nothing and will never update it (Decision 1 / ADR-0017 Decision 4), so dashboards generated before and after this change coexist permanently. A reader comparing two versions of the same dashboard sees `guidebook-cyan`'s third series move from `#A58000` (ochre) to `#197A4B` (green) and has no signal distinguishing "the palette definition was corrected" from "the underlying data changed" — a real risk, because a differently-coloured series is exactly how the guidebook's Secondary role signals *a different series*. `BakedDashboard.meta` already carries `generatedAt` and `hyakkeiVersion`, and the renderer draws neither ([#130](https://github.com/yottayoshida/hyakkei/issues/130)). No migration path is offered here and none is possible for artifacts already sent; the honest position is that this cost was accepted because `packages/core` has no users yet, and it stops being acceptable the moment it does.
- Deviations from the guidebook that this ADR does **not** close are recorded in `docs/guidebook-coverage.md`: per-palette Error, Positive/Negative, and the `Cyan 50` hex divergence.
- **`Cyan 50` is not resolved here.** The model consumes Primary 900/536/400, Secondary 800/400 and Neutral 800/400 — `Cyan 50` is never read, so no code decision is forced. The divergence (page `#E6FCFF`, 2026-07-17; package `#E9F7F9`, 2026-05-28, still current on `main`) is reported upstream and recorded in the spike.
- `palette-order` stays `doc-only`. ADR-0016's read-forward note predicted its "misfires against our own fixtures" objection would disappear once this landed; it does not, because the override survives and every dark appearance still resolves `primaryAlt` to a deeper step than `primary`.
