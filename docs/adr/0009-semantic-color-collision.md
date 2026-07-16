# ADR-0009: Semantic error/success colors stay palette-independent — known role collisions are accepted, not overridden

- **Status**: Accepted (2026-07-16)
- **Deciders**: yotta

## Context

Issue #60 (full-codebase audit, 2026-07-11) found that `resolveChartColors` (`packages/core/src/theme/palette.ts`) produces three exact byte-identical collisions between a chart's `primary` series role and a `success`/`error` semantic role:

| Palette × appearance | Collision | Value |
|---|---|---|
| guidebook-red × light | `primary` == `error` | `#ce0000` |
| guidebook-red × dark | `primary` == `error` | `#ff7171` |
| guidebook-green × dark | `primary` == `success` | `#51b883` |

All three are structural, not accidental: red/light resolves both roles to design-tokens' `Red.900`/`Semantic.Error.2`, which happen to share a hex value; the two dark-mode collisions are exact by construction — `resolveChartColors`'s own dark-mode fallback for `success`/`error` (design-tokens defines no dark-mode Semantic values) borrows `nearestStep(PRIMITIVE.Green/Red, 400)`, the identical function call the same palette's own `primary` role already makes for its dark step.

Investigation (`/plan` Phase 2, architect + QA + UX independently) established two facts that change how severely this reads:

1. **The collision is currently invisible.** `buildEChartsTheme` (`packages/core/src/theme/echarts-theme.ts:27`) destructures only `primary`/`secondary`/`accent`/`background` from `ChartColors` — `success`/`error` are exported by the type but consumed by no renderer today. No chart draws a threshold line, failed-point marker, or semantic badge in v0.1.
2. **`palette.test.ts` already pins `success`/`error` as palette-independent** ("Semantic success/error are shared across every palette (design-tokens has no per-key variant)") — an intentional invariant, not an oversight.

## Decision

Accept the three known collisions. Do not override the semantic step per palette. Characterize them instead: `palette.test.ts` pins an explicit allowlist of exactly these three (palette, appearance, role-pair) combinations as *expected* to collide, and asserts every other role pair across all 7 palettes × 2 appearances is distinct. A **new** collision (e.g. from a future design-tokens bump) fails this test on the unlisted pair; the three known ones staying collided is not a failure.

When a future PR adds a semantic-marker consumer (threshold lines, increment/decrement indicators, failure badges), revisit this decision at that point — with a real consumer to design against, not a hypothetical one. The contract that consumer must honor regardless of whether the override ships: **hue is never the sole encoder of a semantic marker.** hyakkei already accepts this for categorical series distinction (`echarts-theme.ts`'s own doc comment: `aria.decal.show: true` is required "since color alone is an insufficient categorical encoding beyond 2-3 series for at least the orange palette under deuteranopia," PR-0 finding). The same reasoning applies here with more force: a step-override answer (below) only changes *which* red the error uses — it does not make red-on-red distinguishable to a reader with red-green color vision deficiency, who cannot use hue to separate an error marker from a red-palette series in the first place. A symbol, label, or pattern is the only encoding that survives that reader.

## Alternatives considered

| Option | Rejected because |
|---|---|
| `SEMANTIC_STEP_OVERRIDE` (mirroring `SECONDARY_STEP_OVERRIDE`'s mechanism) — override the colliding semantic step per (palette, appearance) | Makes `Semantic.Success`/`Semantic.Error` palette-*dependent*, breaking the invariant `palette.test.ts` already pins deliberately. Solves a collision no renderer exposes yet, in exchange for a real design change to a value the guidebook defines as fixed. Does not solve the underlying CVD-readability problem the collision is a symptom of — see Decision. Kept as a documented option below in case a future consumer needs distinct hues badly enough to accept the invariant change |
| Do nothing (no characterization test) | Silent — a future design-tokens bump resolving or introducing a collision would go unnoticed either way |

### If a future consumer needs the override anyway

Candidate replacement steps were computed against the installed `@digital-go-jp/design-tokens@2.0.1` package (all clear the 3:1 SC1.4.11 floor and are distinct from the colliding `primary`):

| Combination | Candidate | Contrast vs. background |
|---|---|---|
| guidebook-red × light, `error` | `Semantic.Error["1"]` → `#ec0000` | 4.34:1 |
| guidebook-red × dark, `error` | `Red.700` → `#fa0000` | 4.20:1 |
| guidebook-green × dark, `success` | `Green.700` → `#1d8b56` | 4.04:1 |

## Consequences

- `packages/core/src/theme/palette.ts` is unchanged in its color resolution for `success`/`error` — no visual output changes, no golden-fixture regeneration needed.
- `palette.test.ts` gains a `KNOWN_ROLE_COLLISIONS` allowlist test (issue #60 characterization) that fails on any newly-introduced, undocumented role collision across all 7×2 combinations, while accepting the three known ones.
- The pin is deliberately **bidirectional**: a token bump that *resolves* a known collision (e.g. a future design-tokens release distinguishing `Red.900` from `Semantic.Error.2`) also fails the test. That red run is a signal to update the allowlist and this ADR — a desirable upstream change being surfaced for review, not a regression. Silent un-collision would otherwise leave this document describing collisions that no longer exist.
- Any future PR introducing a semantic-marker renderer must design its encoding to not rely on hue alone (symbol/label/pattern), independent of whether it also revisits this ADR's override decision.
