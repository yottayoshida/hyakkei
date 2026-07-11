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
 * `color` is a 3-entry categorical palette (primary/secondary/accent) --
 * consistent with PR-0's spike finding that color alone is an insufficient
 * categorical encoding beyond 2-3 series for at least the orange palette
 * under deuteranopia (docs/spikes/m0-charts.md finding 3); PR-B's
 * buildOptions must pair this with `aria.decal.show: true` unconditionally,
 * not rely on hue distinctness alone.
 */
export function buildEChartsTheme(palette: Palette, appearance: Appearance): EChartsThemeObject {
  const { primary, secondary, accent, background } = resolveChartColors(palette, appearance);
  // Readable text is the *other* appearance's background value (dark text on
  // a light background, light text on a dark one) -- reuses `BACKGROUND`
  // from palette.ts rather than re-hardcoding the same two hex values here.
  const textColor = appearance === "light" ? BACKGROUND.dark : BACKGROUND.light;

  return {
    backgroundColor: background,
    color: [primary, secondary, accent],
    textStyle: { color: textColor },
  };
}
