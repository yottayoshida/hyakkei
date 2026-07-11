import designTokens from "@digital-go-jp/design-tokens";
import { Palette as PaletteSchema } from "@hyakkei/schema";
import type { Appearance, Palette } from "@hyakkei/schema";
import { describe, expect, it } from "vitest";
import { assertGraphicContrast, meetsGraphicContrastFloor, resolveChartColors } from "./palette.js";

// Fresh import of the real package, not a re-derivation of palette.ts's own
// PALETTE_FAMILY table -- an independent ground truth to check the mapping
// against (Codex Round 1 test-adversarial review: without this, a mutant
// that mapped every Palette to the same family would still pass every other
// test in this file, since contrast/hex-shape checks don't depend on which
// family was actually used).
const EXPECTED_PRIMARY_900: Record<Palette, string> = {
  "guidebook-blue": designTokens.Color.Primitive.Blue["900"].$value,
  "guidebook-light-blue": designTokens.Color.Primitive.LightBlue["900"].$value,
  "guidebook-cyan": designTokens.Color.Primitive.Cyan["900"].$value,
  "guidebook-green": designTokens.Color.Primitive.Green["900"].$value,
  "guidebook-orange": designTokens.Color.Primitive.Orange["900"].$value,
  "guidebook-red": designTokens.Color.Primitive.Red["900"].$value,
  "guidebook-neutral": designTokens.Color.Neutral.SolidGray["900"].$value,
};

const PALETTES: Palette[] = [
  "guidebook-blue",
  "guidebook-light-blue",
  "guidebook-cyan",
  "guidebook-green",
  "guidebook-orange",
  "guidebook-red",
  "guidebook-neutral",
];
const APPEARANCES: Appearance[] = ["light", "dark"];

const HEX = /^#[0-9a-f]{6}$/i;

// Independent of `resolveChartColors`'s own internal `assertGraphicContrast`
// -- recomputes contrast from scratch so a bug in the shared assertion logic
// itself wouldn't silently pass both the implementation and this test.
function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.replace("#", ""), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
function srgbToLinear(c: number): number {
  const v = c / 255;
  return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
}
function relativeLuminance([r, g, b]: [number, number, number]): number {
  return 0.2126 * srgbToLinear(r) + 0.7152 * srgbToLinear(g) + 0.0722 * srgbToLinear(b);
}
function contrastRatio(a: string, b: string): number {
  const la = relativeLuminance(hexToRgb(a));
  const lb = relativeLuminance(hexToRgb(b));
  const [hi, lo] = la > lb ? [la, lb] : [lb, la];
  return (hi + 0.05) / (lo + 0.05);
}

describe("resolveChartColors: all 7 palettes x 2 appearances", () => {
  for (const palette of PALETTES) {
    for (const appearance of APPEARANCES) {
      it(`${palette}/${appearance}: returns hex colors, all >=3:1 against background (independently recomputed)`, () => {
        const colors = resolveChartColors(palette, appearance);

        for (const role of ["primary", "secondary", "accent", "success", "error"] as const) {
          expect(colors[role], `${role} should be a hex color`).toMatch(HEX);
        }

        for (const role of ["primary", "secondary", "accent", "success", "error"] as const) {
          const ratio = contrastRatio(colors[role], colors.background);
          expect(ratio, `${palette}/${appearance} ${role} vs background`).toBeGreaterThanOrEqual(3);
        }
      });
    }
  }

  it("each palette's primary resolves to its OWN design-tokens family, not a mutant/collapsed mapping", () => {
    for (const palette of PALETTES) {
      const { primary } = resolveChartColors(palette, "light");
      expect(primary, `${palette} primary should match its own family's 900-step`).toBe(
        EXPECTED_PRIMARY_900[palette],
      );
    }
    // All 7 expected values are themselves distinct (verified against the
    // installed package) -- so the assertions above can't all pass via a
    // single family collapsed onto every palette.
    expect(new Set(Object.values(EXPECTED_PRIMARY_900)).size).toBe(PALETTES.length);
  });

  it("cyan/light: secondary is the exact 1200-step override value, not the identical-to-primary 900-step", () => {
    const { primary, secondary } = resolveChartColors("guidebook-cyan", "light");
    expect(primary).toBe(designTokens.Color.Primitive.Cyan["900"].$value);
    expect(secondary).toBe(designTokens.Color.Primitive.Cyan["1200"].$value);
    expect(secondary).not.toBe(primary);
  });

  it("Semantic success/error are shared across every palette (design-tokens has no per-key variant)", () => {
    const perPalette = PALETTES.map((p) => resolveChartColors(p, "light"));
    const successValues = new Set(perPalette.map((c) => c.success));
    const errorValues = new Set(perPalette.map((c) => c.error));
    expect(successValues.size).toBe(1);
    expect(errorValues.size).toBe(1);
  });

  it("background differs between light and dark appearance", () => {
    const light = resolveChartColors("guidebook-blue", "light");
    const dark = resolveChartColors("guidebook-blue", "dark");
    expect(light.background).not.toBe(dark.background);
  });

  it("every Palette value declared in the schema resolves without throwing (drift guard, /simplify)", () => {
    // Derived from the compiled schema itself, not the hand-maintained
    // `PALETTES` array above -- if a future 8th palette is added to
    // common.ts's `Palette` union but palette.ts's `PALETTE_FAMILY` mapping
    // is forgotten, this fails here (a schema/implementation drift caught at
    // test time) rather than only surfacing as `resolveChartColors`'s
    // runtime "unknown palette" throw when something finally renders it.
    const schemaValues = (PaletteSchema as unknown as { anyOf: { const: string }[] }).anyOf.map(
      (member) => member.const,
    );
    expect(schemaValues.length).toBeGreaterThan(0);
    for (const value of schemaValues) {
      expect(() => resolveChartColors(value as Palette, "light"), value).not.toThrow();
      expect(() => resolveChartColors(value as Palette, "dark"), value).not.toThrow();
    }
  });

  it("resolveChartColors: an unknown palette/appearance throws a named error, not an opaque crash", () => {
    expect(() => resolveChartColors("not-a-real-palette" as Palette, "light")).toThrow(
      /unknown palette/,
    );
    expect(() => resolveChartColors("guidebook-blue", "sepia" as Appearance)).toThrow(
      /unknown appearance/,
    );
  });
});

describe("meetsGraphicContrastFloor: exact numeric boundary (mutation-resistance for `>= 3` vs `> 3`)", () => {
  // Tested numerically, not via a hex pair: Codex's test-adversarial review
  // found that no achievable 8-bit-hex-granularity color pair actually sits
  // close enough to exactly 3.0 to distinguish `< 3` from `<= 3` -- the
  // closest adjacent hex steps (#595959/#5A5A5A vs #000000) land at
  // 2.998/3.045, and BOTH operators agree on both of those. Testing the
  // exact numeric threshold directly (independent of hex-to-luminance
  // conversion) is the only way to pin this comparison.
  it("exactly 3 passes (WCAG's minimum is inclusive: 'at least 3:1')", () => {
    expect(meetsGraphicContrastFloor(3)).toBe(true);
  });

  it("just under 3 fails", () => {
    expect(meetsGraphicContrastFloor(2.999999)).toBe(false);
  });

  it("just over 3 passes", () => {
    expect(meetsGraphicContrastFloor(3.000001)).toBe(true);
  });
});

describe("assertGraphicContrast: exercises the real hex-to-ratio path end to end", () => {
  const baseColors = {
    primary: "#5A5A5A",
    secondary: "#5A5A5A",
    accent: "#5A5A5A",
    success: "#5A5A5A",
    error: "#5A5A5A",
    background: "#000000",
  } as const;

  it("2.998:1 (below 3:1) throws", () => {
    expect(() =>
      assertGraphicContrast("guidebook-blue", "light", { ...baseColors, primary: "#595959" }),
    ).toThrow(/below the 3:1/);
  });

  it("3.045:1 (above 3:1) does not throw", () => {
    expect(() =>
      assertGraphicContrast("guidebook-blue", "light", { ...baseColors, primary: "#5A5A5A" }),
    ).not.toThrow();
  });
});
