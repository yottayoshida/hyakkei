import type { Palette } from "@hyakkei/schema";
import { afterEach, describe, expect, it, vi } from "vitest";
import { buildEChartsTheme } from "./echarts-theme.js";
import { BACKGROUND, resolveChartColors } from "./palette.js";

// issue #65's degrade contract, pinned at THIS layer, not just at
// resolveChartColors' own unit tests: the renderer path (normalizeAuthoring/
// normalizeBaked -> buildEChartsTheme) has no catch anywhere, so the whole
// point of degrade-instead-of-throw is that a sub-3:1 contrast violation
// must not abort the render here. A future refactor reintroducing a throw
// between resolveChartColors and buildEChartsTheme passes every unit test
// in palette.test.ts and still blanks the dashboard -- this is the test
// that fails instead (/code-review sweep).
describe("buildEChartsTheme: contrast violation degrades, never throws (issue #65)", () => {
  afterEach(() => {
    vi.doUnmock("@digital-go-jp/design-tokens");
    vi.resetModules();
  });

  it("returns a usable theme with the violating color when a token drifts below 3:1", async () => {
    vi.resetModules();
    // Blue's light-mode 900-step forced to the exact light background
    // (1:1, guaranteed violation); everything else stays the real package.
    vi.doMock("@digital-go-jp/design-tokens", async (importOriginal) => {
      const actual = await importOriginal<typeof import("@digital-go-jp/design-tokens")>();
      return {
        default: {
          ...actual.default,
          Color: {
            ...actual.default.Color,
            Primitive: {
              ...actual.default.Color.Primitive,
              Blue: { ...actual.default.Color.Primitive.Blue, "900": { $value: "#F8F8FB" } },
            },
          },
        },
      };
    });
    const freshTheme = await import("./echarts-theme.js");
    const freshPalette = await import("./palette.js");

    let theme: ReturnType<typeof freshTheme.buildEChartsTheme> | undefined;
    expect(() => {
      theme = freshTheme.buildEChartsTheme("guidebook-blue", "light");
    }).not.toThrow();
    // The degraded color ships into the actual ECharts theme object.
    expect(theme?.color[0]).toBe("#F8F8FB");
    // ...and the violation is observable, not silent.
    expect(freshPalette.getContrastWarnings()).toHaveLength(1);
  });
});

describe("buildEChartsTheme", () => {
  it("color array is exactly [primary, primaryAlt, secondary], in that order", () => {
    const palette: Palette = "guidebook-blue";
    const colors = resolveChartColors(palette, "light");
    const theme = buildEChartsTheme(palette, "light");

    expect(theme.color).toEqual([colors.primary, colors.primaryAlt, colors.secondary]);
  });

  // issue #122: `color[2]` used to be Yellow for every palette. The assertion
  // above survives a regression back to that (it compares against whatever
  // `resolveChartColors` returns, so both sides move together), which is
  // exactly the mechanical-rename blind spot -- this pins the property that
  // actually changed.
  it("color[2] is palette-dependent (the guidebook's Secondary ramp), not a shared Yellow", () => {
    expect(buildEChartsTheme("guidebook-cyan", "light").color[2]).not.toBe(
      buildEChartsTheme("guidebook-blue", "light").color[2],
    );
    expect(buildEChartsTheme("guidebook-green", "light").color[2]).not.toBe(
      buildEChartsTheme("guidebook-blue", "light").color[2],
    );
  });

  // `neutral` is resolved but deliberately absent from the categorical
  // rotation (ADR-0018 §4). Without this, adding it later looks like a free
  // improvement rather than a role-semantics change.
  it("neutral is NOT in the categorical color array", () => {
    const colors = resolveChartColors("guidebook-blue", "light");
    const theme = buildEChartsTheme("guidebook-blue", "light");
    expect(theme.color).toHaveLength(3);
    expect(theme.color).not.toContain(colors.neutral);
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
