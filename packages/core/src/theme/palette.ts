// PR-A (issue #9): chart colors are resolved from `@digital-go-jp/design-
// tokens` at runtime, not hand-transcribed hex values. An earlier design
// (PR-0's spike, docs/spikes/m0-charts.md) assumed the package "carries no
// chart-color tokens" and re-derived a parallel hex table by hand -- that
// assumption was wrong: installing 2.0.1 and inspecting it directly found
// `Color.Primitive.{Blue,LightBlue,Cyan,Green,Orange,Red,...}` (13-step
// ramps) and `Color.Neutral.SolidGray` (12 steps, including the "536" step
// the spike found on the guidebook's public pages -- confirmed here as a
// real design-tokens value, not a transcription artifact) plus
// `Color.Semantic.{Success,Error}`. Consuming these directly removes the
// hand-transcription error class entirely (this PR's own /code-review pass
// found two: a wrong dark-mode contrast claim and a fallback-logic bug) and
// removes ADR-0006's PDL-1.0 licensing question, since design-tokens is
// unambiguously MIT with no re-derivation involved.
import tokens from "@digital-go-jp/design-tokens";
import type { Appearance, Palette } from "@hyakkei/schema";

type DesignToken = { $value: string };
type ColorFamily = Record<string, DesignToken>;

// Explicit required keys, not `Record<string, ColorFamily>`: an index
// signature makes every property access `ColorFamily | undefined` under
// `noUncheckedIndexedAccess`, which is technically correct for an arbitrary
// string key but not for these specific, known-to-exist family names
// (verified directly against the installed 2.0.1 package — see this file's
// header comment). Listing them as required keys keeps property access
// non-optional without a runtime check on every read.
type PrimitiveFamilies = {
  Blue: ColorFamily;
  LightBlue: ColorFamily;
  Cyan: ColorFamily;
  Green: ColorFamily;
  Orange: ColorFamily;
  Red: ColorFamily;
  Yellow: ColorFamily;
};

const PRIMITIVE = tokens.Color.Primitive as unknown as PrimitiveFamilies;
const NEUTRAL = tokens.Color.Neutral as unknown as { SolidGray: ColorFamily };
// `Color.Semantic.{Success,Error}` each have exactly two steps (1, 2) in the
// installed package — a 2-key literal type instead of `ColorFamily`, same
// non-optional-access rationale as `PrimitiveFamilies` above.
type SemanticPair = { "1": DesignToken; "2": DesignToken };
const SEMANTIC = tokens.Color.Semantic as unknown as {
  Success: SemanticPair;
  Error: SemanticPair;
};

/**
 * Every `Palette` literal (common.ts) maps to a design-tokens color family by
 * name -- the literal names were chosen to mirror these family names rather
 * than inventing a parallel vocabulary. `guidebook-neutral` (the guidebook's
 * "Solid Gray" key) is the one exception living under `Color.Neutral`
 * instead of `Color.Primitive`.
 */
const PALETTE_FAMILY: Record<Palette, ColorFamily> = {
  "guidebook-blue": PRIMITIVE.Blue,
  "guidebook-light-blue": PRIMITIVE.LightBlue,
  "guidebook-cyan": PRIMITIVE.Cyan,
  "guidebook-green": PRIMITIVE.Green,
  "guidebook-orange": PRIMITIVE.Orange,
  "guidebook-red": PRIMITIVE.Red,
  "guidebook-neutral": NEUTRAL.SolidGray,
};

const YELLOW_ACCENT_FAMILY = PRIMITIVE.Yellow;

export const BACKGROUND = { light: "#F8F8FB", dark: "#1A1A1A" } as const;

// Dark-mode step-selection rule (a hyakkei extension -- confirmed the
// guidebook/design-tokens define no dark-mode values at all, PR-0 spike):
// dark primary uses a lighter step (400) than light primary (900), for
// contrast against the dark background instead of the light one. Dark
// secondary reuses the same 600 step as light secondary -- not a mirror,
// deliberately: 600 already clears 3:1 against both backgrounds for every
// palette except cyan (handled by SECONDARY_STEP_OVERRIDE below), so there
// is nothing to invert. Same "one constant per appearance" idiom as
// ACCENT_STEP below, not a general ramp-reversal table (/simplify found the
// prior 6-entry `DARK_STEP_MIRROR` table had 4 dead entries nothing read,
// and its live `600: 600` cell already contradicted a "mirror" framing).
const DARK_PRIMARY_STEP = 400;
const DARK_SECONDARY_STEP = 600;

/**
 * Closest available step by numeric distance, not `family[step] ??
 * family[fallbackIndex]`: `SolidGray`'s step set (50/100/.../420/500/536/
 * 600/.../900, no 1000/1100/1200) doesn't line up with the 10-hue families'
 * (50/100/.../900/1000/1100/1200), so a fixed-index fallback silently picks
 * the wrong step for any family whose set differs from the common case --
 * exactly the bug class `/code-review` found in PR-0's spike code
 * (`ramp[600] ?? Object.values(ramp)[1]` picking gray's 200-step instead of
 * a ~600-step neighbor, because JS reorders all-numeric-string object keys
 * to ascending numeric order regardless of insertion order).
 */
function nearestStep(family: ColorFamily, target: number): string {
  const steps = Object.keys(family).map(Number);
  const closest = steps.reduce((a, b) => (Math.abs(b - target) < Math.abs(a - target) ? b : a));
  // Non-null: `closest` is derived from `Object.keys(family)` on the line
  // above, so `family[String(closest)]` is guaranteed present by
  // construction -- `noUncheckedIndexedAccess` can't see that invariant
  // through the `.map(Number)`/`.reduce()` chain.
  const token = family[String(closest)];
  if (!token) throw new Error(`unreachable: step ${closest} missing from its own family's keys`);
  return token.$value;
}

// Yellow step 600 (#D2A400) measures 2.19:1 against the light background --
// fails SC1.4.11's 3:1 graphic-object minimum (measured, PR-0 spike). Step
// 800 clears light-background contrast; step 400 clears dark-background
// contrast. Step 600 is not usable as a standalone accent against either.
const ACCENT_STEP: Record<Appearance, number> = { light: 800, dark: 400 };

// cyan's default secondary (nearestStep 600, #00A3BF) measures 2.83:1
// against the light background -- fails 3:1 (measured against the real
// design-tokens value, /code-review 2026-07-11). Promoting to step 900
// (cyan's own primary step) was the first instinct but makes primary and
// secondary the literal same color; step 1200 (#003741, 12.21:1) is both
// >=3:1 and visually distinct from primary. This table exists so a future
// palette/background addition that reintroduces a sub-3:1 combination has
// somewhere structured to add an override, rather than another hand-picked
// constant -- `assertGraphicContrast` below still verifies at the point of
// use rather than trusting this table is complete.
const SECONDARY_STEP_OVERRIDE: Partial<Record<Appearance, Partial<Record<Palette, number>>>> = {
  light: { "guidebook-cyan": 1200 },
};

export type ChartColors = {
  primary: string;
  secondary: string;
  accent: string;
  /** Shared across every palette (design-tokens has no per-key semantic variant). */
  success: string;
  error: string;
  background: string;
};

export function resolveChartColors(palette: Palette, appearance: Appearance): ChartColors {
  // Runtime guard, not just a TS type: a value that reaches here having
  // bypassed schema validation (e.g. cast through `as Palette`, or a
  // supply-chain drift where this package's TS types are stale relative to
  // a differently-versioned caller) would otherwise fail deep inside
  // `nearestStep` with an opaque "Object.keys(undefined)" crash instead of
  // a message naming the actual bad value (Codex test-adversarial review).
  const family = PALETTE_FAMILY[palette];
  if (!family) {
    throw new Error(`resolveChartColors: unknown palette '${String(palette)}'`);
  }
  const background = BACKGROUND[appearance];
  if (!background) {
    throw new Error(`resolveChartColors: unknown appearance '${String(appearance)}'`);
  }

  const colors: ChartColors =
    appearance === "light"
      ? {
          primary: nearestStep(family, 900),
          secondary: nearestStep(family, SECONDARY_STEP_OVERRIDE.light?.[palette] ?? 600),
          accent: nearestStep(YELLOW_ACCENT_FAMILY, ACCENT_STEP.light),
          // Error.2/Success.2 (#CE0000/#197A4B): higher-contrast of the two
          // shared Semantic steps design-tokens defines (measured 5.47:1 /
          // 5.05:1 against the light background vs. 4.34:1 / 3.26:1 for
          // Error.1/Success.1).
          success: SEMANTIC.Success["2"].$value,
          error: SEMANTIC.Error["2"].$value,
          background,
        }
      : {
          primary: nearestStep(family, DARK_PRIMARY_STEP),
          secondary: nearestStep(family, SECONDARY_STEP_OVERRIDE.dark?.[palette] ?? DARK_SECONDARY_STEP),
          accent: nearestStep(YELLOW_ACCENT_FAMILY, ACCENT_STEP.dark),
          // design-tokens' Semantic.Error/Success have no dark-mode values
          // (none exist anywhere in the package, confirmed) and its own two
          // light-mode steps both sit close to the 3:1 floor against the
          // dark background with little to no margin (Error.2 measures
          // exactly 3.00:1, Success.2 3.25:1). Borrowing the Red/Green families' own
          // lighter step (400, matching this palette's own dark-mode
          // mirroring rule) is a hyakkei extension with real margin (6.51:1
          // / 7.07:1), not a guidebook value.
          success: nearestStep(PRIMITIVE.Green, 400),
          error: nearestStep(PRIMITIVE.Red, 400),
          background,
        };

  assertGraphicContrast(palette, appearance, colors);
  return colors;
}

// WCAG SC1.4.11's minimum for graphical objects. A named constant (not a
// literal `3` inline) so `meetsGraphicContrastFloor` below can be unit-
// tested against exact numeric values (2.999, 3, 3.001) -- no real hex color
// pair from the installed design-tokens package sits at exactly 3.0, so a
// hex-based fixture alone cannot distinguish `< 3` from `<= 3` (a gap Codex's
// test-adversarial review found: two adjacent 8-bit-hex-granularity values
// bracketing ~2.998/~3.045 don't actually straddle the boundary tightly
// enough to flip between the two operators). Testing the numeric comparison
// directly, decoupled from hex-to-luminance conversion, closes that gap.
const GRAPHIC_CONTRAST_FLOOR = 3;

// Exported so this exact comparison can be unit-tested with exact numeric
// boundary values, independent of hex-color quantization.
export function meetsGraphicContrastFloor(ratio: number): boolean {
  return ratio >= GRAPHIC_CONTRAST_FLOOR;
}

// Exported (not just used internally) so it can be unit-tested directly with
// synthetic hex pairs -- if a future palette/background/appearance addition
// reintroduces a sub-3:1 combination, this throws instead of silently
// shipping it (the gap `/code-review` found in PR-0's spike code, where the
// "fix" was a hardcoded constant nothing re-checked at call time).
export function assertGraphicContrast(palette: Palette, appearance: Appearance, colors: ChartColors): void {
  for (const role of ["primary", "secondary", "accent", "success", "error"] as const) {
    const ratio = contrastRatio(colors[role], colors.background);
    if (!meetsGraphicContrastFloor(ratio)) {
      throw new Error(
        `resolveChartColors(${palette}, ${appearance}): ${role} ${colors[role]} vs background ${colors.background} = ${ratio.toFixed(2)}:1, below the 3:1 SC1.4.11 minimum. Add a SECONDARY_STEP_OVERRIDE (or equivalent) entry.`,
      );
    }
  }
}

// WCAG 2.1 relative-luminance contrast ratio (SC 1.4.11 graphical objects:
// >=3:1). Same formula as PR-0's spike (spikes/charts/contrast.mjs) --
// duplicated here rather than imported since spike code is throwaway and
// gitignored, not a shippable dependency.
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
function contrastRatio(hexA: string, hexB: string): number {
  const la = relativeLuminance(hexToRgb(hexA));
  const lb = relativeLuminance(hexToRgb(hexB));
  const [lighter, darker] = la > lb ? [la, lb] : [lb, la];
  return (lighter + 0.05) / (darker + 0.05);
}
