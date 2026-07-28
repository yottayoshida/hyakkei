import designTokens from "@digital-go-jp/design-tokens";
import { Palette as PaletteSchema } from "@hyakkei/schema";
import type { Appearance, Palette } from "@hyakkei/schema";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  assertGraphicContrast,
  CHART_COLOR_ROLES,
  isSanctionedAbsence,
  meetsGraphicContrastFloor,
  nearestStep,
  resolveChartColors,
} from "./palette.js";
import type { ChartColorRole } from "./palette.js";

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

// Fresh import of the real package, not a re-derivation of palette.ts's own
// PALETTE_FAMILY table -- an independent ground truth to check the mapping
// against (Codex Round 1 test-adversarial review: without this, a mutant
// that mapped every Palette to the same family would still pass every other
// test in this file, since contrast/hex-shape checks don't depend on which
// family was actually used). Shared by `EXPECTED_PRIMARY_900` below and the
// issue #13 ramp-position characterization block further down (/simplify
// Simplification finding: these used to be two independently hand-written
// palette->family tables listing the same 7 pairs).
const FAMILY_BY_PALETTE: Record<Palette, Record<string, { $value?: string }>> = {
  "guidebook-blue": designTokens.Color.Primitive.Blue,
  "guidebook-light-blue": designTokens.Color.Primitive.LightBlue,
  "guidebook-cyan": designTokens.Color.Primitive.Cyan,
  "guidebook-green": designTokens.Color.Primitive.Green,
  "guidebook-orange": designTokens.Color.Primitive.Orange,
  "guidebook-red": designTokens.Color.Primitive.Red,
  "guidebook-neutral": designTokens.Color.Neutral.SolidGray,
};

function step(token: { $value?: string } | undefined): string {
  if (!token?.$value) throw new Error("expected step to have a $value");
  return token.$value;
}

const EXPECTED_PRIMARY_900: Record<Palette, string> = Object.fromEntries(
  PALETTES.map((palette) => [palette, step(FAMILY_BY_PALETTE[palette]["900"])]),
) as Record<Palette, string>;

const HEX = /^#[0-9a-f]{6}$/i;

// Independent of the ASSERTION PATH, not of the formula: this is byte-identical
// to palette.ts's own implementation, so it cannot catch an error in the
// contrast math -- both would be wrong together. What it does catch is the
// wiring around it: `contrastViolations` comparing against the wrong
// background, skipping a role, or `meetsGraphicContrastFloor`'s boundary
// drifting. Do not "fix" the duplication by importing: `contrastRatio` is not
// exported from palette.ts, and exporting it would collapse this oracle into a
// tautology. (/simplify Reuse, which also narrowed this comment's overclaim --
// it used to say a bug in the shared assertion logic "wouldn't silently pass
// both," which is true only of the wiring, not of the math.)
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

        // issue #122: `neutral` is legitimately `null` for exactly one
        // palette. Counting the skips (rather than just `continue`-ing) is
        // what keeps this from quietly degrading into a no-op if a future
        // change makes more roles absent -- a bare skip would report "all
        // roles pass" while checking fewer and fewer of them.
        let skipped = 0;
        for (const role of CHART_COLOR_ROLES) {
          const color = colors[role];
          if (color === null) {
            expect(isSanctionedAbsence(palette, role), `${role} is null but not sanctioned`).toBe(
              true,
            );
            skipped += 1;
            continue;
          }
          expect(color, `${role} should be a hex color`).toMatch(HEX);
          const ratio = contrastRatio(color, colors.background);
          expect(ratio, `${palette}/${appearance} ${role} vs background`).toBeGreaterThanOrEqual(3);
        }
        expect(skipped, `${palette}/${appearance} unexpected number of absent roles`).toBe(
          palette === "guidebook-neutral" ? 1 : 0,
        );
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

  it("cyan/light: primaryAlt is the exact 1200-step override value, not the identical-to-primary 900-step", () => {
    const { primary, primaryAlt } = resolveChartColors("guidebook-cyan", "light");
    expect(primary).toBe(designTokens.Color.Primitive.Cyan["900"].$value);
    expect(primaryAlt).toBe(designTokens.Color.Primitive.Cyan["1200"].$value);
    expect(primaryAlt).not.toBe(primary);
  });

  // issue #122: guidebook-neutral's published Primary ramp is
  // 900/700/536/400/200/50 -- it has no 600 step. `nearestStep(family, 600)`
  // used to land on SolidGray 600, a step the guidebook does not put in this
  // ramp. Both hexes are plausible-looking grays, so the `not.toBe` half is
  // what makes a silent revert to the fuzzy lookup detectable.
  it("guidebook-neutral: primaryAlt is SolidGray 536, NOT 600 (its ramp has no 600 step)", () => {
    const gray = designTokens.Color.Neutral.SolidGray;
    for (const appearance of APPEARANCES) {
      const { primaryAlt } = resolveChartColors("guidebook-neutral", appearance);
      expect(primaryAlt, `${appearance} primaryAlt`).toBe(step(gray["536"]));
      expect(primaryAlt, `${appearance} primaryAlt must not fall back to 600`).not.toBe(
        step(gray["600"]),
      );
    }
  });

  // issue #122: guidebook-neutral's light `primary` must stay SolidGray 900.
  // A position-index implementation of the ramp (`ramp[1]`) resolves it to
  // SolidGray 700 instead, because this palette's ramp starts at 900 while
  // every other one starts at 1200. That is the single most likely way to get
  // this change wrong, and nothing else in this file would catch it.
  it("guidebook-neutral: primary stays SolidGray 900 (ramp heads are not aligned across palettes)", () => {
    const gray = designTokens.Color.Neutral.SolidGray;
    expect(resolveChartColors("guidebook-neutral", "light").primary).toBe(step(gray["900"]));
    expect(resolveChartColors("guidebook-neutral", "light").primary).not.toBe(step(gray["700"]));
  });

  it("Semantic success/error are shared across every palette (design-tokens has no per-key variant)", () => {
    const perPalette = PALETTES.map((p) => resolveChartColors(p, "light"));
    const successValues = new Set(perPalette.map((c) => c.success));
    const errorValues = new Set(perPalette.map((c) => c.error));
    expect(successValues.size).toBe(1);
    expect(errorValues.size).toBe(1);
  });

  // The converse of the invariant directly above, and the reason it has to be
  // stated: `secondary` (the guidebook's Secondary ramp) is palette-DEPENDENT.
  // Without this, a regression that re-collapses it onto one shared family --
  // which is exactly the defect issue #122 fixes -- passes every other test in
  // this file, since contrast, hex shape and distinctness all still hold when
  // all seven palettes share Yellow.
  //
  // Ground truth read from a fresh design-tokens import, not from palette.ts's
  // own SECONDARY_FAMILY table, for the same reason as EXPECTED_PRIMARY_900.
  const EXPECTED_SECONDARY_FAMILY: Record<Palette, Record<string, { $value?: string }>> = {
    "guidebook-blue": designTokens.Color.Primitive.Yellow,
    "guidebook-light-blue": designTokens.Color.Primitive.Yellow,
    "guidebook-cyan": designTokens.Color.Primitive.Green,
    "guidebook-green": designTokens.Color.Primitive.Cyan,
    "guidebook-orange": designTokens.Color.Primitive.Yellow,
    "guidebook-red": designTokens.Color.Primitive.Yellow,
    "guidebook-neutral": designTokens.Color.Primitive.Yellow,
  };

  it("secondary is palette-dependent: three distinct hues, not one shared Yellow", () => {
    for (const palette of PALETTES) {
      expect(
        resolveChartColors(palette, "light").secondary,
        `${palette} secondary should come from its own guidebook Secondary ramp`,
      ).toBe(step(EXPECTED_SECONDARY_FAMILY[palette]["800"]));
      expect(resolveChartColors(palette, "dark").secondary, `${palette} dark secondary`).toBe(
        step(EXPECTED_SECONDARY_FAMILY[palette]["400"]),
      );
    }
    // Exactly three hues across seven palettes (Yellow x5, Green, Cyan). A
    // 7-way distinctness check would be wrong here -- five palettes SHOULD
    // share Yellow -- and a 1-way check is what the bug looked like.
    expect(new Set(PALETTES.map((p) => resolveChartColors(p, "light").secondary)).size).toBe(3);
  });

  // V-014: the guidebook's Secondary is a DIFFERENT hue from Primary, by
  // definition. Checking role-value inequality (rather than family-name
  // inequality) is deliberate: a future palette whose Secondary was set to its
  // own family would still produce different hex values per step, so a naive
  // "secondary !== primary" would pass while the role model was broken. Both
  // steps are compared, since the two roles use different step numbers and
  // could coincide at one appearance only.
  it("secondary never comes from the palette's own Primary ramp (V-014)", () => {
    for (const palette of PALETTES) {
      for (const appearance of APPEARANCES) {
        const c = resolveChartColors(palette, appearance);
        const ownRamp = Object.values(FAMILY_BY_PALETTE[palette]).map((t) => t.$value);
        expect(
          ownRamp,
          `${palette}/${appearance}: secondary is a step of its own ramp`,
        ).not.toContain(c.secondary);
      }
    }
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
    primaryAlt: "#5A5A5A",
    secondary: "#5A5A5A",
    neutral: "#5A5A5A",
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

  // issue #122, mutation-driven. `isSanctionedAbsence` gates which `null`s the
  // contrast loop is allowed to skip, but nothing exercised its REJECTION path:
  // in normal operation only `guidebook-neutral` ever produces a `null`, so a
  // mutant returning `true` unconditionally killed zero tests. That is the
  // difference between "the guard exists" and "the guard works" -- and the
  // failure mode it protects against is silent, since an unchecked role simply
  // stops being contrast-checked.
  it("a null in a role that is NOT a sanctioned absence throws, naming the role", () => {
    expect(() =>
      assertGraphicContrast("guidebook-blue", "light", { ...baseColors, neutral: null }),
    ).toThrow(/neutral.*not a sanctioned absence/);
  });

  it("the same null IS tolerated for guidebook-neutral, which has no Neutral row", () => {
    expect(() =>
      assertGraphicContrast("guidebook-neutral", "light", { ...baseColors, neutral: null }),
    ).not.toThrow();
  });
});

// issue #122, mutation-driven. Both guards below are defence-in-depth added on
// the strength of a security/QA review, and a mutation run found that deleting
// either one killed zero tests. Guards with no test are indistinguishable from
// guards that do not work.
describe("token-drift guards: non-finite step and non-hex value", () => {
  // Same reset/unmock harness as the memoization block below. Without it the
  // `vi.doMock` in the second test leaks into every later dynamic import in
  // this file -- which is exactly what happened on the first attempt, taking
  // an unrelated memoization test down with it.
  beforeEach(() => {
    vi.resetModules();
  });
  afterEach(() => {
    vi.doUnmock("@digital-go-jp/design-tokens");
  });

  it("nearestStep throws on a non-finite target instead of silently returning the lowest step", () => {
    const gray = designTokens.Color.Neutral.SolidGray as Record<string, { $value: string }>;
    // Without the guard, `Math.abs(b - NaN) < Math.abs(a - NaN)` is always
    // false, so `reduce` returns its seed -- the numerically lowest step. For
    // SolidGray that is 50 (#f2f2f2), which against the DARK background clears
    // 3:1 comfortably and would therefore ship as a silently wrong color.
    expect(() => nearestStep(gray, Number.NaN, "test")).toThrow(/non-finite step/);
    expect(() => nearestStep(gray, undefined as unknown as number, "test")).toThrow(
      /non-finite step/,
    );
    expect(nearestStep(gray, 900, "test")).toBe(step(gray["900"]));
  });

  it("a token whose $value is not a #rrggbb literal fails loudly rather than being scored as black", async () => {
    // The realistic drift: style-dictionary emits `rgb()` or a `var()`
    // reference instead of a hex literal. `hexToRgb` is total and silent --
    // `parseInt("rgb(1,2,3)", 16)` is NaN, the bit ops collapse it to [0,0,0],
    // and the contrast gate then scores it at 19.81:1 against the light
    // background and passes it. The value reaches an SVG paint attribute.
    vi.doMock("@digital-go-jp/design-tokens", async (importOriginal) => {
      const actual = await importOriginal<typeof import("@digital-go-jp/design-tokens")>();
      return {
        default: {
          ...actual.default,
          Color: {
            ...actual.default.Color,
            Primitive: {
              ...actual.default.Color.Primitive,
              Blue: { ...actual.default.Color.Primitive.Blue, "900": { $value: "rgb(1,2,3)" } },
            },
          },
        },
      };
    });
    const fresh = await import("./palette.js");
    expect(() => fresh.resolveChartColors("guidebook-blue", "light")).toThrow(
      /not a #rrggbb literal/,
    );
  });
});

// issue #64 CI hard gate: `assertGraphicContrast` is exercised directly
// against every real resolved (palette, appearance), independent of
// `resolveChartColors`'s memoization -- a future design-tokens bump
// shifting one of the near-margin hexes below 3:1 (orange/light `primaryAlt`
// measures 3.0023:1 -- the tightest margin in the matrix) fails this
// regardless of which combination some other test happened to resolve
// (and thereby cache) first. Complements, not replaces, the independent
// hand-rolled `contrastRatio` recomputation in the very first describe
// block above -- that one is the true independent oracle on the contrast
// *math*; this one specifically pins that `assertGraphicContrast` (the
// exported function CI calls directly) is wired to real values and still
// throwing on violation, not proof the math itself is correct (Codex
// test-adversarial review).
describe("assertGraphicContrast: eager CI gate across all 14 real combinations", () => {
  for (const palette of PALETTES) {
    for (const appearance of APPEARANCES) {
      it(`${palette}/${appearance}: does not throw against real design-tokens values`, () => {
        const colors = resolveChartColors(palette, appearance);
        expect(() => assertGraphicContrast(palette, appearance, colors)).not.toThrow();
      });
    }
  }
});

// issue #60: red/green palettes make a series role byte-identical to a
// semantic role by construction -- both resolve the same design-tokens
// step of the same family (guidebook-red primary/error both land on
// Red's 900-step in light mode and 400-step in dark; guidebook-green
// primary/success both land on Green's 400-step in dark mode). ADR-0009
// accepts this rather than overriding the semantic step: `success`/`error`
// are not consumed by any renderer today (`buildEChartsTheme` reads only
// primary/primaryAlt/secondary/background), and design-tokens defines Semantic
// as palette-independent by design (pinned below) -- overriding it per
// palette would break that invariant for a collision with no visible
// consumer yet. This test characterizes the known collisions (so token
// drift resolving them isn't silently un-noticed) and fails on any
// *unlisted* pair, which would mean a NEW collision appeared.
//
// issue #122 adds the two cyan entries, and they differ in KIND from the
// three above. The originals are hyakkei's own construction: its dark-mode
// semantic fallback borrows the same `nearestStep(Green/Red, 400)` a palette's
// own `primary` already uses, plus a `Red.900`/`Error.2` coincidence. The cyan
// pair is UPSTREAM's -- the guidebook's Cyan reference image paints Secondary
// 800 and Success as literally the same swatch (`#197A4B`), and design-tokens
// derives `Semantic.Success["2"]` from that same Green 800. Avoiding it would
// mean departing from the published assignment.
//
// Listed here as part of the change that causes them, with the decision
// already recorded in ADR-0018 §6 and a dated note on ADR-0009 -- not appended
// after a red test, which would leave no way to tell an intended design
// decision from one nobody noticed.
const KNOWN_ROLE_COLLISIONS = new Set([
  "guidebook-red/light/primary/error",
  "guidebook-red/dark/primary/error",
  "guidebook-green/dark/primary/success",
  "guidebook-cyan/light/secondary/success",
  "guidebook-cyan/dark/secondary/success",
]);

describe("resolveChartColors: role-color distinctness (issue #60 characterization)", () => {
  // Built via `.flatMap`/`.map` callback params (always defined), not
  // numeric array indexing -- `CHART_COLOR_ROLES[i]` under
  // `noUncheckedIndexedAccess` types as `ChartColorRole | undefined`,
  // which `colors[a]` below can't accept.
  const ROLE_PAIRS: Array<[ChartColorRole, ChartColorRole]> = CHART_COLOR_ROLES.flatMap((a, i) =>
    CHART_COLOR_ROLES.slice(i + 1).map((b): [ChartColorRole, ChartColorRole] => [a, b]),
  );

  for (const palette of PALETTES) {
    for (const appearance of APPEARANCES) {
      it(`${palette}/${appearance}: role colors are pairwise distinct except the known collisions`, () => {
        const colors = resolveChartColors(palette, appearance);
        let comparedPairs = 0;
        for (const [a, b] of ROLE_PAIRS) {
          // issue #122: a `null` role must be SKIPPED, never compared. Left in,
          // `null !== "#333333"` reads as a healthy non-collision and the pair
          // passes without checking anything -- the most dangerous shape a
          // distinctness matrix can take, because it grows quietly as roles are
          // added. The pair count below is what makes the skipping visible.
          if (colors[a] === null || colors[b] === null) {
            expect(
              isSanctionedAbsence(palette, colors[a] === null ? a : b),
              `${palette}/${appearance}: ${a}/${b} skipped on an unsanctioned null`,
            ).toBe(true);
            continue;
          }
          comparedPairs += 1;
          const forward = `${palette}/${appearance}/${a}/${b}`;
          const reverse = `${palette}/${appearance}/${b}/${a}`;
          if (KNOWN_ROLE_COLLISIONS.has(forward) || KNOWN_ROLE_COLLISIONS.has(reverse)) {
            // Deliberately bidirectional: a token bump that RESOLVES a
            // known collision (a desirable upstream change) also fails
            // here -- that red run is the signal to update this allowlist
            // AND revisit ADR-0009, not a regression (see the ADR's
            // Consequences section).
            expect(colors[a], `expected known collision at ${forward}`).toBe(colors[b]);
          } else {
            expect(colors[a], `unexpected new collision at ${forward}`).not.toBe(colors[b]);
          }
        }
        // 6 roles -> 15 pairs. guidebook-neutral has no `neutral`, so its 5
        // pairs involving that role drop out, leaving 10. Asserting the count
        // is what stops the loop above from silently checking less over time.
        expect(comparedPairs, `${palette}/${appearance} compared pair count`).toBe(
          palette === "guidebook-neutral" ? 10 : 15,
        );
      });
    }
  }
});

// issue #13 (guideline nudge engine, ADR-0016): `palette-order`'s guideline
// rule is doc-only (no runtime evaluation) because v0.1's authorable
// surface has no way to change which ramp step the two same-hue roles resolve
// to -- but the ramp-position RELATIONSHIP those two steps happen to have
// is exactly why: it is not "the first role always uses an earlier/lighter
// step than the second" everywhere. This bidirectional characterization test
// pins the actual relationship per (palette, appearance), independently of
// palette.ts's own private step constants (fresh design-tokens lookups,
// same convention as `EXPECTED_PRIMARY_900` above) -- a future change to
// `PRIMARY_ALT_STEP_OVERRIDE`/`PRIMARY_STEP`/`PRIMARY_ALT_STEP` fails
// here, forcing a conscious re-evaluation of ADR-0016 rather than silently
// drifting underneath a guideline rule that no longer matches reality.
//
// issue #122 renamed the second role `secondary` -> `primaryAlt` and gave
// `secondary` to the guidebook's actual (different-hue) Secondary ramp. The
// pair this block characterizes is still the two SAME-HUE roles, so it is
// still the pair `palette-order` would judge -- but two things it used to
// assert changed meaning and are worth stating so the next reader does not
// restore the old framing:
//
//   1. The 3:1 floor that forces cyan/light's deeper override is HYAKKEI'S,
//      not a guidebook exception. The guidebook publishes Cyan 600 (2.83:1)
//      as a real categorical color and sanctions no "shift the color"
//      fallback. ADR-0016 said the opposite; ADR-0018 §5 corrects it.
//   2. `palette-order`'s "it would misfire against our own fixtures"
//      objection therefore does NOT disappear with #122, contrary to what
//      ADR-0016's read-forward note predicted: the override survives, and
//      every dark appearance still resolves the deeper step second.
describe("resolveChartColors: primary/primaryAlt ramp-position relationship (issue #13 characterization)", () => {
  // guidebook-neutral's ramp has no 600 step (900/700/536/400/200/50), so its
  // primaryAlt is 536 -- the one place where "the same step number for every
  // palette" is not available.
  const primaryAltStep = (palette: Palette, appearance: Appearance): string => {
    if (appearance === "light" && palette === "guidebook-cyan") return "1200";
    return palette === "guidebook-neutral" ? "536" : "600";
  };

  for (const palette of PALETTES) {
    it(`${palette}/light: primary=900-step, primaryAlt=${primaryAltStep(palette, "light")}-step${palette === "guidebook-cyan" ? " (KNOWN exception: primaryAlt deeper than primary, forced by hyakkei's 3:1 floor)" : ""}`, () => {
      const { primary, primaryAlt } = resolveChartColors(palette, "light");
      const family = FAMILY_BY_PALETTE[palette];
      expect(primary).toBe(step(family["900"]));
      expect(primaryAlt).toBe(step(family[primaryAltStep(palette, "light")]));
    });

    it(`${palette}/dark: primary=400-step, primaryAlt=${primaryAltStep(palette, "dark")}-step (KNOWN exception: primaryAlt deeper than primary, uniformly across all palettes)`, () => {
      const { primary, primaryAlt } = resolveChartColors(palette, "dark");
      const family = FAMILY_BY_PALETTE[palette];
      expect(primary).toBe(step(family["400"]));
      expect(primaryAlt).toBe(step(family[primaryAltStep(palette, "dark")]));
    });
  }
});

// issue #65: memoization, __proto__ hardening, and the runtime degrade
// contract. Each test dynamically re-imports the module after
// `vi.resetModules()` -- the file-level static import at the top of this
// file is bound once at file-evaluation time and never rebinds, so a fresh
// module instance (fresh `Map` cache, fresh warning log) is only reachable
// through a new `await import(...)` call.
describe("resolveChartColors: memoization, __proto__ guards, and contrast-degrade contract", () => {
  // One reset per test, centralized: the static top-of-file import binds a
  // separate module instance whose cache/warning log the earlier describe
  // blocks already populated -- every test here needs a fresh instance,
  // reachable only through a dynamic import after this reset.
  beforeEach(() => {
    vi.resetModules();
  });
  afterEach(() => {
    vi.doUnmock("@digital-go-jp/design-tokens");
  });

  it("returns the same frozen reference for repeated calls with the same (palette, appearance)", async () => {
    const fresh = await import("./palette.js");
    const a = fresh.resolveChartColors("guidebook-blue", "light");
    const b = fresh.resolveChartColors("guidebook-blue", "light");
    expect(a).toBe(b);
    expect(Object.isFrozen(a)).toBe(true);
    expect(() => {
      (a as { primary: string }).primary = "#000000";
    }).toThrow();
  });

  it("caches all 14 (palette, appearance) combinations as distinct entries", async () => {
    const fresh = await import("./palette.js");
    const seen = new Set<unknown>();
    for (const palette of PALETTES) {
      for (const appearance of APPEARANCES) {
        seen.add(fresh.resolveChartColors(palette, appearance));
      }
    }
    expect(seen.size).toBe(14);
  });

  it("rejects '__proto__' as palette with the named error, not a silent Object.prototype resolution", async () => {
    const fresh = await import("./palette.js");
    expect(() => fresh.resolveChartColors("__proto__" as Palette, "light")).toThrow(
      /unknown palette/,
    );
  });

  it("rejects '__proto__' as appearance with the named error", async () => {
    const fresh = await import("./palette.js");
    expect(() => fresh.resolveChartColors("guidebook-blue", "__proto__" as Appearance)).toThrow(
      /unknown appearance/,
    );
  });

  it("a contrast violation on cache-miss is recorded (not thrown), does not re-record on cache-hit, and the color still ships", async () => {
    // Overrides only Blue's light-mode 900-step to the exact light
    // background value (ratio 1:1, guaranteed violation) -- every other
    // family/step comes from the real installed package via
    // `importOriginal`, so this exercises the real resolution path rather
    // than a fully synthetic one.
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
    const fresh = await import("./palette.js");

    expect(fresh.getContrastWarnings()).toHaveLength(0);
    let degraded: { primary: string } | undefined;
    expect(() => {
      degraded = fresh.resolveChartColors("guidebook-blue", "light");
    }).not.toThrow();
    // Degrade means the violating color still ships -- not silently
    // swapped for a safe fallback before returning (Codex test-adversarial
    // review: recording a warning while returning something else would
    // still pass a not-toThrow-only assertion).
    expect(degraded?.primary).toBe("#F8F8FB");

    const afterFirst = fresh.getContrastWarnings();
    expect(afterFirst).toHaveLength(1);
    expect(afterFirst[0]).toMatchObject({
      palette: "guidebook-blue",
      appearance: "light",
      role: "primary",
      color: "#F8F8FB",
      background: "#F8F8FB",
    });
    expect(afterFirst[0]?.ratio).toBeCloseTo(1, 1);
    expect(Object.isFrozen(afterFirst)).toBe(true);
    // The warning object itself, not just the array wrapping it -- a
    // consumer mutating a returned warning must not corrupt the internal
    // log a later `getContrastWarnings()` call exposes (Codex Round 1).
    expect(Object.isFrozen(afterFirst[0])).toBe(true);
    expect(() => {
      (afterFirst[0] as { ratio: number }).ratio = 999;
    }).toThrow();

    // cache-hit: same call again must not push a second warning.
    fresh.resolveChartColors("guidebook-blue", "light");
    expect(fresh.getContrastWarnings()).toHaveLength(1);
  });

  it("records a separate warning for every violating role, not just the first", async () => {
    // Two independent violations in the same resolution: Blue's light
    // primary (900) AND Yellow's light secondary (800 -- blue's guidebook
    // Secondary ramp is Yellow), both collapsed onto the light background --
    // a mutant that records only the first violation in the loop would leave
    // this at length 1, not 2 (Codex test-adversarial review).
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
              Yellow: { ...actual.default.Color.Primitive.Yellow, "800": { $value: "#F8F8FB" } },
            },
          },
        },
      };
    });
    const fresh = await import("./palette.js");

    fresh.resolveChartColors("guidebook-blue", "light");
    const warnings = fresh.getContrastWarnings();
    expect(warnings).toHaveLength(2);
    expect(new Set(warnings.map((w) => w.role))).toEqual(new Set(["primary", "secondary"]));
  });

  it("a palette's OWN family vanishing fails at load time naming that family, not later as a misleading 'unknown palette'", async () => {
    // Behaviour change in issue #122, deliberate and stated here so it is not
    // read as a regression.
    //
    // Before: the palette->family tables stored object references, so a
    // vanished `Color.Primitive.Blue` made `PALETTE_FAMILY["guidebook-blue"]`
    // `undefined`, and `resolveChartColors` reported `unknown palette
    // 'guidebook-blue'` at call time. That message was actively misleading --
    // the palette is perfectly well known; its family is gone -- and it only
    // surfaced once someone rendered that specific palette.
    //
    // Now: the tables store family NAMES, and every name they mention is
    // probed at module load. The failure is immediate and says which family
    // went missing. The `hasOwn` + truthy guard in `resolveChartColors`
    // remains, but its job is now solely `__proto__` rejection (pinned by the
    // tests above) -- an own key can no longer hold `undefined`, because the
    // value is a string literal from a total `Record<Palette, FamilyName>`.
    vi.doMock("@digital-go-jp/design-tokens", async (importOriginal) => {
      const actual = await importOriginal<typeof import("@digital-go-jp/design-tokens")>();
      const { Blue: _drop, ...restPrimitive } = actual.default.Color.Primitive;
      return {
        default: {
          ...actual.default,
          Color: { ...actual.default.Color, Primitive: restPrimitive },
        },
      };
    });
    await expect(import("./palette.js")).rejects.toThrow(/Color\.Primitive\.Blue/);
  });

  it("a missing STEP inside a surviving family degrades (nearest-step fallback + rendering continues), it does not fail the module load", async () => {
    // The failure-philosophy boundary this PR commits to (QA review):
    // family-level drift fails loudly at load (nearestStep would crash
    // opaquely on `undefined`), but STEP-level drift is survivable --
    // nearestStep picks the numerically nearest surviving step, and a
    // resulting sub-3:1 lands in the contrast-degrade path, not a throw.
    // A load-time hard-throw here would blank the dashboard over a
    // condition the code handles.
    vi.doMock("@digital-go-jp/design-tokens", async (importOriginal) => {
      const actual = await importOriginal<typeof import("@digital-go-jp/design-tokens")>();
      const { "800": _drop, ...restYellow } = actual.default.Color.Primitive.Yellow;
      return {
        default: {
          ...actual.default,
          Color: {
            ...actual.default.Color,
            Primitive: { ...actual.default.Color.Primitive, Yellow: restYellow },
          },
        },
      };
    });
    const fresh = await import("./palette.js");
    let colors: { secondary: string } | undefined;
    expect(() => {
      colors = fresh.resolveChartColors("guidebook-blue", "light");
    }).not.toThrow();
    // The 800-step is gone; blue's light `secondary` (the guidebook's
    // Secondary ramp = Yellow for this palette) resolves to a real surviving
    // neighbor (700 or 900), not to undefined and not to the dropped value.
    //
    // issue #122 note: this path stays live precisely because `nearestStep`
    // was kept as the token-drift fallback rather than replaced by direct
    // `family[step]` indexing. If a future change makes step lookup exact and
    // throwing, this test must be rewritten to assert the throw -- what must
    // not happen is the behaviour changing while the test name still says
    // "degrades".
    const yellow = designTokens.Color.Primitive.Yellow;
    expect([yellow["700"].$value, yellow["900"].$value]).toContain(colors?.secondary);
  });

  it("a renamed/missing Color.Semantic family fails at load time naming Semantic, not an opaque property crash", async () => {
    vi.doMock("@digital-go-jp/design-tokens", async (importOriginal) => {
      const actual = await importOriginal<typeof import("@digital-go-jp/design-tokens")>();
      const { Semantic: _drop, ...restColor } = actual.default.Color;
      return { default: { ...actual.default, Color: restColor } };
    });
    await expect(import("./palette.js")).rejects.toThrow(/Semantic/);
  });

  it("a renamed/missing Color.Primitive.Yellow family fails at load time naming Yellow, not an opaque property crash", async () => {
    vi.doMock("@digital-go-jp/design-tokens", async (importOriginal) => {
      const actual = await importOriginal<typeof import("@digital-go-jp/design-tokens")>();
      const { Yellow: _drop, ...restPrimitive } = actual.default.Color.Primitive;
      return {
        default: {
          ...actual.default,
          Color: { ...actual.default.Color, Primitive: restPrimitive },
        },
      };
    });
    await expect(import("./palette.js")).rejects.toThrow(/Yellow/);
  });

  // Green/Red are cross-palette dependencies exactly like Yellow: dark-mode
  // success/error borrow their 400-step for EVERY palette, so a vanished
  // Green must fail at load naming Green -- not as an opaque crash when
  // some unrelated palette (guidebook-blue/dark) first resolves
  // (/code-review: the palette-keyed "unknown palette" guard cannot catch
  // this, it keys on the palette being resolved, not on Green/Red).
  it("a renamed/missing Color.Primitive.Green family fails at load time naming Green", async () => {
    vi.doMock("@digital-go-jp/design-tokens", async (importOriginal) => {
      const actual = await importOriginal<typeof import("@digital-go-jp/design-tokens")>();
      const { Green: _drop, ...restPrimitive } = actual.default.Color.Primitive;
      return {
        default: {
          ...actual.default,
          Color: { ...actual.default.Color, Primitive: restPrimitive },
        },
      };
    });
    await expect(import("./palette.js")).rejects.toThrow(/Green/);
  });

  it("a renamed/missing Color.Primitive.Red family fails at load time naming Red", async () => {
    vi.doMock("@digital-go-jp/design-tokens", async (importOriginal) => {
      const actual = await importOriginal<typeof import("@digital-go-jp/design-tokens")>();
      const { Red: _drop, ...restPrimitive } = actual.default.Color.Primitive;
      return {
        default: {
          ...actual.default,
          Color: { ...actual.default.Color, Primitive: restPrimitive },
        },
      };
    });
    await expect(import("./palette.js")).rejects.toThrow(/Red/);
  });
});
