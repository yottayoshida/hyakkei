import designTokens from "@digital-go-jp/design-tokens";
import { Palette as PaletteSchema } from "@hyakkei/schema";
import type { Appearance, Palette } from "@hyakkei/schema";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  assertGraphicContrast,
  CHART_COLOR_ROLES,
  meetsGraphicContrastFloor,
  resolveChartColors,
} from "./palette.js";
import type { ChartColorRole } from "./palette.js";

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

        for (const role of CHART_COLOR_ROLES) {
          expect(colors[role], `${role} should be a hex color`).toMatch(HEX);
        }

        for (const role of CHART_COLOR_ROLES) {
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

// issue #64 CI hard gate: `assertGraphicContrast` is exercised directly
// against every real resolved (palette, appearance), independent of
// `resolveChartColors`'s memoization -- a future design-tokens bump
// shifting one of the near-margin hexes below 3:1 (orange/light secondary
// measured 3.0023:1, neutral/dark secondary 3.0311:1) fails this
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
// primary/secondary/accent/background), and design-tokens defines Semantic
// as palette-independent by design (pinned below) -- overriding it per
// palette would break that invariant for a collision with no visible
// consumer yet. This test characterizes the known collisions (so token
// drift resolving them isn't silently un-noticed) and fails on any
// *unlisted* pair, which would mean a NEW collision appeared.
const KNOWN_ROLE_COLLISIONS = new Set([
  "guidebook-red/light/primary/error",
  "guidebook-red/dark/primary/error",
  "guidebook-green/dark/primary/success",
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
        for (const [a, b] of ROLE_PAIRS) {
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
      });
    }
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
    // primary (900) AND Yellow's light accent (800), both collapsed onto
    // the light background -- a mutant that records only the first
    // violation in the loop would leave this at length 1, not 2 (Codex
    // test-adversarial review).
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
    expect(new Set(warnings.map((w) => w.role))).toEqual(new Set(["primary", "accent"]));
  });

  it("an own key resolving to `undefined` (token-package drift, not `__proto__`) still throws the named error, not an opaque nearestStep crash", async () => {
    // Distinct from the `__proto__` tests above: `PALETTE_FAMILY` here
    // genuinely has `guidebook-blue` as an own key (the object literal
    // always assigns it), but the value it resolves to is `undefined`
    // because `Color.Primitive.Blue` itself vanished upstream. `hasOwn`
    // alone would report `true` for this key and let `undefined` reach
    // `nearestStep` -- the guard must combine `hasOwn` with the original
    // truthy check, not replace it (Codex test-adversarial review).
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
    const fresh = await import("./palette.js");
    expect(() => fresh.resolveChartColors("guidebook-blue", "light")).toThrow(/unknown palette/);
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
    let colors: { accent: string } | undefined;
    expect(() => {
      colors = fresh.resolveChartColors("guidebook-blue", "light");
    }).not.toThrow();
    // The 800-step is gone; the light accent resolves to a real surviving
    // neighbor (700 or 900), not to undefined and not to the dropped value.
    const yellow = designTokens.Color.Primitive.Yellow;
    expect([yellow["700"].$value, yellow["900"].$value]).toContain(colors?.accent);
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
