import type { Palette } from "@hyakkei/schema";
import { describe, expect, it } from "vitest";
import { buildEChartsTheme } from "./echarts-theme.js";
import { BACKGROUND, resolveChartColors } from "./palette.js";

describe("buildEChartsTheme", () => {
  it("color array is exactly [primary, secondary, accent], in that order", () => {
    const palette: Palette = "guidebook-blue";
    const colors = resolveChartColors(palette, "light");
    const theme = buildEChartsTheme(palette, "light");

    expect(theme.color).toEqual([colors.primary, colors.secondary, colors.accent]);
  });

  it("backgroundColor matches resolveChartColors' background for the same (palette, appearance)", () => {
    const theme = buildEChartsTheme("guidebook-red", "dark");
    const colors = resolveChartColors("guidebook-red", "dark");
    expect(theme.backgroundColor).toBe(colors.background);
  });

  it("textStyle.color is the OPPOSITE appearance's background (dark text on light, light text on dark)", () => {
    // Pinning the exact pairing, not just light !== dark (issue #72): a
    // swapped-appearance mutant (text color = its own background = invisible
    // text on every chart) also satisfies mere inequality.
    const light = buildEChartsTheme("guidebook-green", "light");
    const dark = buildEChartsTheme("guidebook-green", "dark");
    expect(light.textStyle.color).toBe(BACKGROUND.dark);
    expect(dark.textStyle.color).toBe(BACKGROUND.light);
  });
});
