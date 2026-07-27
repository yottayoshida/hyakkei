# Spike: where the guidebook's chart color *roles* actually live

**Status**: RESOLVED — the role assignment (Primary / Secondary / Neutral / semantic) is published on the guidebook's own "カラーパレットの使い方" page, **not** in `@digital-go-jp/design-tokens`. hyakkei resolves roles from the token package alone and therefore diverges from the guidebook on two of seven palettes, and on the structure of `secondary` for all seven.
**Date**: 2026-07-27
**Verified against**: [カラーパレットの使い方](https://www.digital.go.jp/resources/dashboard-guidebook/color-palette) (最終更新日: 2026年7月17日) and its per-palette reference images, read directly. `@digital-go-jp/design-tokens@2.0.1` inspected as the installed package.

## Why this spike exists

ADR-0006 (amended 2026-07-11) records a decision that is *correct in principle*: consume the authoritative source directly rather than hand-transcribing hex values off a web page. PRD §6.1 F6 and `ROADMAP.md`'s M0 note then record a finding derived from that decision — that `@digital-go-jp/design-tokens` "has no data encoding a per-key accent relationship at all," that "every palette shares the single `Color.Primitive.Yellow` ramp as its categorical accent," and that the open "does Cyan accent Green or does it use the shared Yellow" question from the M0 chart spike is therefore **moot** — "there was nothing to visually confirm against a structure the authoritative source doesn't have."

That conclusion is sound *about the package*. The package really does carry only primitive color families — Blue, Cyan, Green, Yellow, Red, Orange, SolidGray ramps — with no role layer on top.

The role layer exists. It is just published somewhere else.

## What the guidebook actually specifies

Role definitions, quoted from the page (§1):

> **チャート** — 棒グラフや折れ線グラフなどのチャートでデータ系列を表すために使用する色
> - Primary：チャートで主要なデータを示すために使用する基本色
> - Secondary：ハイライトや複数系列を区別するために使用する補助色
> - Neutral：強調する必要のないデータや比較対象を表すために使用する控えめな色

Per-palette assignment, read from the official reference images (`Color Palette Blue` / `Color Palette Cyan`, 3840×2160):

| Role | Blue palette | Cyan palette |
| --- | --- | --- |
| **Primary** | Blue 1200 `#000060` / 900 `#0017C1` / 600 `#3460FB` / 400 `#7096F8` / 200 `#C5D7FB` / 50 `#E8F1FE` | Cyan 1200 `#003741` / 900 `#006F83` / 600 `#00A3BF` / 400 `#2BC8E4` / 200 `#99F2FF` / 50 `#E6FCFF` |
| **Secondary** | **Yellow** 800 `#A58000` / 600 `#D2A400` / 400 `#FFC700` | **Green** 800 `#197A4B` / 600 `#259D63` / 400 `#51B883` |
| **Neutral** | SolidGray 800 `#333333` / 600 `#666666` / 400 `#999999` / 200 `#CCCCCC` | (same) |
| **Positive** | Blue 600 / 200 / 50 | Cyan 600 / 200 / 50 |
| **Negative** | **Red** 600 `#FE3939` / 200 / 50 | **SolidGray** 600 `#666666` / 200 / 50 |
| Others | Success `#197A4B`, Error `#CE0000` | (same) |

Three structural facts follow, and hyakkei's implementation matches none of them:

### 1. Secondary is a different hue, not a different step of the same hue

`packages/core/src/theme/palette.ts` resolves `primary: nearestStep(family, 900)` and `secondary: nearestStep(family, 600)` — the same `PALETTE_FAMILY[palette]` ramp, two positions apart. The guidebook gives Secondary its **own three-step ramp in a different hue**.

This is not a hex-value discrepancy that a lookup-table patch fixes. It is a different model of what "secondary" means.

### 2. The Yellow accent is per-palette, not universal

`YELLOW_ACCENT_FAMILY = PRIMITIVE.Yellow` is applied uniformly across all seven palettes. Yellow is correct **for Blue**. Cyan's secondary is Green. The earlier "shared Yellow accent across every palette" finding described the token package's shape faithfully and then generalised it into a claim about the guidebook, which does not hold.

Only two palettes are confirmed here (Blue, Cyan) because only those two reference images were retrieved. **The remaining five are unverified** — Light Blue, Green, Orange, Red, SolidGray. Do not assume Yellow for them; retrieve the images.

### 3. `SECONDARY_STEP_OVERRIDE` is a workaround for a self-inflicted problem

`palette.ts` documents that cyan's default secondary (`nearestStep(family, 600)` = `#00A3BF`) measures 2.83:1 against the light background — under the guidebook's own 3:1 floor — and that step 1200 (`#003741`, 12.21:1) was chosen as an override because using cyan's own 900 would make primary and secondary "the literal same color."

Both horns of that dilemma come from picking secondary out of the primary's ramp. The guidebook's Cyan secondary is Green 600 `#259D63`, which is a different hue entirely — visually distinct from Cyan primary by construction, with no step-collision to resolve. The contrast problem the override exists to solve does not arise in the specified design.

ADR-0016 cites this override as evidence that "the guidebook's principles have deliberate accessibility-driven exceptions" and uses it to justify keeping `palette-order` as `doc-only`. That framing needs revisiting: the override is not an exception the guidebook sanctions — it is an artifact of hyakkei's own role model. (Separately confirmed: **the guidebook specifies no exception to the 3:1 floor at all.** Its only sanctioned fallbacks when 3:1 cannot be met are "place the value adjacent to the color area, at ≥4.5:1" and "reveal the value on hover/focus" — never "shift the color.")

## Hex divergence, separately

`Cyan 50` is `#E6FCFF` on the official color-code page (updated 2026-07-17) but `#E9F7F9` in `@digital-go-jp/design-tokens@2.0.1` and in the GitHub-distributed Power BI theme JSON (last pushed 2026-03-31). The web value does not exist anywhere in the installed token package. Which is current could not be determined from the sources available; the guidebook page carries the later date.

This is a second, independent reason the token package alone is not a sufficient source of truth for guidebook conformance.

## What this does and does not settle

**Settled**: the role layer is published, it is per-palette, and hyakkei's model diverges from it structurally (not just in values). ADR-0006's "consume the authoritative source directly" principle stands — the correction is that *the authoritative source for roles is the guidebook page, and the token package is the authoritative source for primitive hex values*. Two sources, two jobs.

**Not settled**:
1. The role assignment for the other five palettes (Light Blue, Green, Orange, Red, SolidGray). Only Blue and Cyan were read.
2. Whether `#E6FCFF` or `#E9F7F9` is the current Cyan 50.
3. What a corrected `palette.ts` should do about dark mode. The guidebook defines no dark-mode values at all (confirmed in the M0 spike and unchanged here), so hyakkei's dark ramp remains a documented extension — but it was derived from the same-hue secondary model and will need rework alongside it.
4. Whether the seven-palette `Negative` assignment varies beyond the Blue-uses-Red / Cyan-uses-SolidGray split observed here.

## Downstream

This spike is the evidentiary predicate for [#122](https://github.com/yottayoshida/hyakkei/issues/122), the conformance issue that corrects `palette.ts`, PRD §6.1 F6, `ROADMAP.md`'s M0 note, and ADR-0006's amendment. Filing that correction without this record would read as reversing a documented finding on no new evidence — the point of writing it down is that there *is* new evidence, and it was in a place nobody had looked.
