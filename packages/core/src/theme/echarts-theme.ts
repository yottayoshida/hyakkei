// PR-A (issue #9): (palette, appearance) -> ECharts theme object. This is
// the one place token->ECharts mapping happens (plan §"保守性" requirement)
// -- PR-B's buildOptions consumes this rather than resolving colors itself.
import type { Appearance, Palette } from "@hyakkei/schema";
import { BACKGROUND, resolveChartColors } from "./palette.js";

// Deliberately not `echarts`'s own theme type: ECharts doesn't export a
// distinct "theme object" type separate from `EChartsOption` (themes are,
// by convention, a subset of option fields applied globally) -- listing only
// the fields this function actually sets keeps the contract explicit rather
// than implying support for arbitrary EChartsOption keys via a theme.
export type EChartsThemeObject = {
  backgroundColor: string;
  color: string[];
  textStyle: { color: string };
};

/**
 * `color` is the 3-entry categorical palette: the palette's own Primary ramp
 * twice (`primary`, `primaryAlt`) followed by the guidebook's Secondary ramp
 * (`secondary`) -- the same order the official Power BI templates use, where
 * the Primary ramp is consumed first and the Secondary ramp appended once it
 * runs out (ADR-0018).
 *
 * `neutral` is deliberately NOT here. The guidebook defines Neutral as 「強調
 * する必要のないデータや比較対象を表すために使用する控えめな色」 -- putting it in
 * the categorical rotation would make the third series de-emphasised by
 * accident, inverting the role. The guidebook's own overflow color is
 * Secondary.
 *
 * Consistent with PR-0's spike finding that color alone is an insufficient
 * categorical encoding beyond 2-3 series for at least the orange palette
 * under deuteranopia (docs/spikes/m0-charts.md finding 3); PR-B's
 * buildOptions must pair this with `aria.decal.show: true` unconditionally,
 * not rely on hue distinctness alone. That matters more, not less, after
 * issue #122: `guidebook-cyan`'s worst categorical pair under tritanopia is
 * Cyan 900 vs Green 800, which is the guidebook's own assignment.
 */
export function buildEChartsTheme(palette: Palette, appearance: Appearance): EChartsThemeObject {
  const { primary, primaryAlt, secondary, background } = resolveChartColors(palette, appearance);
  // Readable text is the *other* appearance's background value (dark text on
  // a light background, light text on a dark one) -- reuses `BACKGROUND`
  // from palette.ts rather than re-hardcoding the same two hex values here.
  const textColor = appearance === "light" ? BACKGROUND.dark : BACKGROUND.light;

  return {
    backgroundColor: background,
    color: [primary, primaryAlt, secondary],
    textStyle: { color: textColor },
  };
}
