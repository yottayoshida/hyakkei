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
const SEMANTIC_SOURCE = tokens.Color.Semantic as unknown;

// issue #65 item 2: the `PRIMITIVE`/`NEUTRAL` casts above are only guarded
// downstream for the six palette-KEYED families — an absent/renamed
// `Color.Primitive.Blue` collapses to `undefined` in `PALETTE_FAMILY`,
// which `resolveChartColors`'s "unknown palette" check catches (if
// imprecisely worded). That check keys on `palette`, so it does NOTHING
// for the families read cross-palette regardless of which palette is
// being resolved: `Yellow` (the shared accent), `Green`/`Red` (dark-mode
// success/error borrow their DARK_SEMANTIC_STEP for EVERY palette), and
// `Color.Semantic`. Any of those going missing died as an opaque "Cannot
// read properties of undefined" deep inside `nearestStep`, naming neither
// the actual missing family nor where to look. All four are therefore
// guarded at module load (not at first use), so the failure is identical
// regardless of which palette/appearance is resolved first.
//
// Deliberately FAMILY-existence only, no step-level probes: a family that
// exists but lost one step is already handled by the degrade pipeline this
// same change builds — `nearestStep` falls back to the numerically nearest
// surviving step, and if that lands below 3:1 the contrast-degrade path
// records a warning and keeps rendering. A load-time hard-throw for a
// missing step would blank the whole dashboard over a condition the code
// survives, contradicting the crash-is-worse-than-degrade principle the
// `ContrastWarning` doc comment commits to (QA review). `probeStep` exists
// for `Color.Semantic` only, whose steps are read by direct property
// access (`SEMANTIC.Success["2"].$value`) with no nearest-step fallback —
// there a missing step IS a real crash, so failing loudly at load is
// strictly better.
function assertFamilyShape(label: string, family: unknown, probeStep?: string): void {
  if (!family || typeof family !== "object" || Object.keys(family).length === 0) {
    throw new Error(
      `hyakkei theme: design-tokens family '${label}' is missing or empty — token package drift?`,
    );
  }
  if (probeStep !== undefined && !Object.hasOwn(family, probeStep)) {
    throw new Error(
      `hyakkei theme: design-tokens family '${label}' is missing its '${probeStep}' step — token package drift?`,
    );
  }
}
// Two-level check: `Color.Semantic` disappearing entirely (not just one of
// its two children) must also fail here with a message naming "Semantic",
// not crash on `.Success`/`.Error` property access against `undefined`.
assertFamilyShape("Color.Semantic", SEMANTIC_SOURCE, "Success");
assertFamilyShape("Color.Semantic", SEMANTIC_SOURCE, "Error");
const SEMANTIC = SEMANTIC_SOURCE as { Success: SemanticPair; Error: SemanticPair };
assertFamilyShape("Color.Semantic.Success", SEMANTIC.Success, "2");
assertFamilyShape("Color.Semantic.Error", SEMANTIC.Error, "2");

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

// Frozen at runtime, not just `as const` (TS-only): both are exported, and
// a same-realm consumer mutating them would corrupt every later resolution.
export const BACKGROUND = Object.freeze({ light: "#F8F8FB", dark: "#1A1A1A" } as const);

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
// Dark-mode success/error borrow the Green/Red families' own lighter step
// (design-tokens defines no dark-mode Semantic values at all, confirmed) --
// numerically the same 400 as DARK_PRIMARY_STEP by the same mirroring rule,
// but a separate constant because they answer different questions (which
// step a palette's own primary uses vs. which step the shared semantic
// borrow uses) and nothing forces them to stay equal.
const DARK_SEMANTIC_STEP = 400;

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

// Load-time existence probes for the three cross-palette Primitive
// families this file reads regardless of which palette is resolved (see
// the block comment above `assertFamilyShape` for why these are
// family-existence only, no step probes).
assertFamilyShape("Color.Primitive.Yellow", YELLOW_ACCENT_FAMILY);
assertFamilyShape("Color.Primitive.Green", PRIMITIVE.Green);
assertFamilyShape("Color.Primitive.Red", PRIMITIVE.Red);

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

// Exported (not module-private) so tests iterate the same role list the
// implementation checks, instead of re-declaring a copy that can drift.
// Runtime-frozen for the same reason as BACKGROUND above.
export const CHART_COLOR_ROLES = Object.freeze([
  "primary",
  "secondary",
  "accent",
  "success",
  "error",
] as const);
export type ChartColorRole = (typeof CHART_COLOR_ROLES)[number];

// issue #65: (palette, appearance) inputs are a closed 7x2 = 14-entry
// enum whose resolved colors never change within a process lifetime -- this
// memoizes what was previously a full re-scan + 5x luminance/contrast
// computation on every `buildEChartsTheme` call. `Map`, not a plain object:
// a plain-object cache keyed by an untrusted `palette`/`appearance` string
// would let a `"__proto__"` key silently vanish into a prototype setter
// instead of being stored (this repo's own recurring bug class -- see
// `StructRow.toJSON()`/`insertJSONFromPath` incidents in hyakkei's history).
// LIFECYCLE COUPLING: this cache and `contrastWarnings` below must be
// cleared together or not at all -- the "one warning per combination"
// guarantee rests entirely on the cache-hit early return. A future
// reset()/invalidation that clears only the cache would re-record
// duplicate warnings for every violating combination it re-resolves.
const themeColorCache = new Map<string, ChartColors>();
const cacheKey = (palette: string, appearance: string): string => `${palette}:${appearance}`;

/**
 * issue #65: a color-role that fails the 3:1 graphic-object floor at
 * runtime (e.g. a future design-tokens patch shifting a near-margin hex by
 * one 8-bit step -- see `SECONDARY_STEP_OVERRIDE`'s orange/neutral margins
 * measured at 3.0023:1 / 3.0311:1) used to crash the whole render
 * (`assertGraphicContrast` throwing inside `resolveChartColors`). For a
 * browser-complete product read in closed/air-gapped networks (LGWAN etc.),
 * a viewer who hits this has no recourse -- a blank white dashboard is a
 * strictly worse outcome than one chart's role rendering at reduced
 * contrast. `resolveChartColors` now degrades instead: the violating color
 * still ships, and the violation is recorded here for a maintainer/library
 * consumer to inspect via `getContrastWarnings()` -- never gated behind a
 * test-only flag or `NODE_ENV` check, which would make this fail-open with
 * no record at all in whichever environment the gate excludes.
 */
export type ContrastWarning = {
  readonly palette: Palette;
  readonly appearance: Appearance;
  readonly role: ChartColorRole;
  readonly color: string;
  readonly background: string;
  readonly ratio: number;
};

const contrastWarnings: ContrastWarning[] = [];

/** Frozen snapshot -- callers cannot mutate hyakkei's own warning log. */
export function getContrastWarnings(): readonly ContrastWarning[] {
  return Object.freeze([...contrastWarnings]);
}

type ContrastViolation = { role: ChartColorRole; ratio: number };

function contrastViolations(colors: ChartColors): ContrastViolation[] {
  const violations: ContrastViolation[] = [];
  for (const role of CHART_COLOR_ROLES) {
    const ratio = contrastRatio(colors[role], colors.background);
    if (!meetsGraphicContrastFloor(ratio)) {
      violations.push({ role, ratio });
    }
  }
  return violations;
}

// Shared between the degrade-path `console.warn` and `assertGraphicContrast`'s
// throw -- the two messages must describe the same violation identically and
// diverge only in what the reader should do about it.
function formatContrastViolation(
  palette: Palette,
  appearance: Appearance,
  colors: ChartColors,
  violation: ContrastViolation,
): string {
  return `resolveChartColors(${palette}, ${appearance}): ${violation.role} ${colors[violation.role]} vs background ${colors.background} = ${violation.ratio.toFixed(2)}:1, below the 3:1 SC1.4.11 minimum.`;
}

export function resolveChartColors(palette: Palette, appearance: Appearance): ChartColors {
  // issue #65 item 3 (`__proto__` hardening): `PALETTE_FAMILY`/`BACKGROUND`
  // are plain object literals, so a bare truthy check on `table[key]` alone
  // resolves `"__proto__"` to `Object.prototype` (truthy) instead of
  // `undefined` -- silently passing an attacker- or bug-supplied
  // `"__proto__"` straight into `nearestStep`. `Object.hasOwn` checks the
  // literal's own keys only, so `"__proto__"` (never assigned as an own key
  // here) reports `false` same as any other unknown value -- but is
  // combined with the original truthy check (not `hasOwn` alone) so a
  // family that genuinely *is* an own key with an `undefined` value
  // (upstream token-package drift collapsing `PRIMITIVE.X` to `undefined`)
  // still throws the same named error instead of reaching `nearestStep`
  // with `undefined`.
  const family = Object.hasOwn(PALETTE_FAMILY, palette) ? PALETTE_FAMILY[palette] : undefined;
  if (!family) {
    throw new Error(`resolveChartColors: unknown palette '${String(palette)}'`);
  }
  const background = Object.hasOwn(BACKGROUND, appearance) ? BACKGROUND[appearance] : undefined;
  if (!background) {
    throw new Error(`resolveChartColors: unknown appearance '${String(appearance)}'`);
  }

  const key = cacheKey(palette, appearance);
  const cached = themeColorCache.get(key);
  if (cached) {
    return cached;
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
          secondary: nearestStep(
            family,
            SECONDARY_STEP_OVERRIDE.dark?.[palette] ?? DARK_SECONDARY_STEP,
          ),
          accent: nearestStep(YELLOW_ACCENT_FAMILY, ACCENT_STEP.dark),
          // design-tokens' Semantic.Error/Success have no dark-mode values
          // (none exist anywhere in the package, confirmed) and its own two
          // light-mode steps both sit close to the 3:1 floor against the
          // dark background with little to no margin (Error.2 measures
          // exactly 3.00:1, Success.2 3.25:1). Borrowing the Red/Green
          // families' own lighter step (DARK_SEMANTIC_STEP, matching this
          // palette's own dark-mode mirroring rule) is a hyakkei extension
          // with real margin (6.51:1 / 7.07:1), not a guidebook value.
          success: nearestStep(PRIMITIVE.Green, DARK_SEMANTIC_STEP),
          error: nearestStep(PRIMITIVE.Red, DARK_SEMANTIC_STEP),
          background,
        };

  // Runs exactly once per (palette, appearance) -- on the cache-miss path,
  // never gated behind a test-only or NODE_ENV flag (see `ContrastWarning`
  // doc comment above). `assertGraphicContrast` (below) stays the throwing
  // hard gate CI calls directly; this is the non-throwing sibling that
  // backs runtime degrade.
  for (const violation of contrastViolations(colors)) {
    // Frozen at construction, not just in `getContrastWarnings`'s returned
    // array: `readonly` on `ContrastWarning`'s fields is TS-only -- without
    // this, a consumer holding a warning object from a prior call could
    // mutate it in place and corrupt the entries still held in
    // `contrastWarnings` itself, since arrays only ever store references
    // (Codex Round 1 review).
    const warning: ContrastWarning = Object.freeze({
      palette,
      appearance,
      role: violation.role,
      color: colors[violation.role],
      background: colors.background,
      ratio: violation.ratio,
    });
    contrastWarnings.push(warning);
    console.warn(
      `${formatContrastViolation(palette, appearance, colors, violation)} Rendering anyway (degraded) -- see getContrastWarnings().`,
    );
  }

  const frozen = Object.freeze(colors);
  themeColorCache.set(key, frozen);
  return frozen;
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
// "fix" was a hardcoded constant nothing re-checked at call time). Unlike
// `resolveChartColors` (issue #65: degrades + records instead of throwing),
// this stays a throwing hard gate -- it is what CI calls directly against
// all 14 real (palette, appearance) combinations, independent of whether
// `resolveChartColors`'s cache has already resolved them.
export function assertGraphicContrast(
  palette: Palette,
  appearance: Appearance,
  colors: ChartColors,
): void {
  const [first] = contrastViolations(colors);
  if (first) {
    throw new Error(
      `${formatContrastViolation(palette, appearance, colors, first)} Add a SECONDARY_STEP_OVERRIDE (or equivalent) entry.`,
    );
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
