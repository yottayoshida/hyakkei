import type { Palette } from "@hyakkei/schema";
import { describe, expect, it } from "vitest";
import { buildEChartsTheme } from "./echarts-theme.js";
import { resolveChartColors } from "./palette.js";

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

  it("textStyle.color differs between light and dark (readable against either background)", () => {
    const light = buildEChartsTheme("guidebook-green", "light");
    const dark = buildEChartsTheme("guidebook-green", "dark");
    expect(light.textStyle.color).not.toBe(dark.textStyle.color);
  });
});
