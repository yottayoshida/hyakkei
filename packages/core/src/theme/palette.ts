// Chart colors are resolved from two authoritative sources, not one.
//
// PR-A (issue #9) established the first half: primitive hex values come from
// `@digital-go-jp/design-tokens` at runtime rather than being hand-transcribed
// (ADR-0006). That removed a whole error class -- PR-0's spike had re-derived a
// parallel hex table by hand and `/code-review` found two transcription bugs in
// it -- and it still stands.
//
// issue #122 established the second half, by finding the conclusion drawn from
// the first to be wrong. design-tokens carries primitive ramps and **no role
// layer**: nothing in the package says which hue a palette's Secondary is, or
// that Neutral exists. PRD §6.1 F6 and ROADMAP's M0 note recorded that absence
// and concluded the question was moot. It is not moot; the role layer is
// published on the guidebook's own "カラーパレットの使い方" page as a
// per-palette reference image, and nobody had looked there for four months.
//
//   design-tokens  -> authoritative for primitive hex values
//   guidebook page -> authoritative for role assignment
//
// Full decision record: docs/adr/0018-chart-color-roles-follow-the-guidebook-role-layer.md
import tokens from "@digital-go-jp/design-tokens";
import type { Appearance, Palette } from "@hyakkei/schema";

type DesignToken = { $value: string };
type ColorFamily = Record<string, DesignToken>;

// Explicit required keys, not `Record<string, ColorFamily>`: an index
// signature makes every property access `ColorFamily | undefined` under
// `noUncheckedIndexedAccess`, which is technically correct for an arbitrary
// string key but not for these specific, known-to-exist family names
// (verified directly against the installed 2.0.1 package). Listing them as
// required keys keeps property access non-optional without a runtime check on
// every read.
type PrimitiveFamilies = {
  Blue: ColorFamily;
  LightBlue: ColorFamily;
  Cyan: ColorFamily;
  Green: ColorFamily;
  Orange: ColorFamily;
  Red: ColorFamily;
  Yellow: ColorFamily;
};

// The two-stage check `Color.Semantic` gets further down applies here too
// (Phase 8 security review found the asymmetry): dropping `Color.Primitive`
// or `Color.Neutral` wholesale used to surface as `Cannot read properties of
// undefined (reading 'Blue')` from inside `rawFamily`, naming neither the
// missing container nor where to look -- the exact failure mode the per-family
// probes exist to prevent, one level up.
function assertContainer(label: string, value: unknown): void {
  if (!value || typeof value !== "object") {
    throw new Error(`hyakkei theme: design-tokens '${label}' is missing — token package drift?`);
  }
}
assertContainer("Color", tokens.Color);
assertContainer("Color.Primitive", tokens.Color.Primitive);
assertContainer("Color.Neutral", tokens.Color.Neutral);

const PRIMITIVE = tokens.Color.Primitive as unknown as PrimitiveFamilies;
const NEUTRAL = tokens.Color.Neutral as unknown as { SolidGray: ColorFamily };
// `Color.Semantic.{Success,Error}` each have exactly two steps (1, 2) in the
// installed package -- a 2-key literal type instead of `ColorFamily`, same
// non-optional-access rationale as `PrimitiveFamilies` above.
type SemanticPair = { "1": DesignToken; "2": DesignToken };
const SEMANTIC_SOURCE = tokens.Color.Semantic as unknown;

/**
 * When the role layer below was read, and from where.
 *
 * The role tables are a hand-read snapshot of a specification that moves
 * independently of this repository -- the page was last updated 2026-07-17 and
 * its color codes changed in that revision. Fetching it at runtime is not an
 * option: zero-network `file://` viewing is the product (ADR-0001). Stamping
 * *when it was read* is the cheapest thing that makes staleness detectable at
 * all, and it records an immutable fact rather than a measurement, so it does
 * not itself go stale.
 *
 * `docs/guidebook-coverage.md` carries a dated human attestation line; these
 * two dates are meant to be reconciled together.
 */
export const GUIDEBOOK_ROLE_SOURCE = Object.freeze({
  url: "https://www.digital.go.jp/resources/dashboard-guidebook/color-palette",
  retrieved: "2026-07-27",
  pageLastUpdated: "2026-07-17",
} as const);

// THE ROLE TABLE -- the single source of truth for guidebook role -> hyakkei
// field. Before issue #122 this mapping was spread across five documents and
// three of them were wrong, which is how a conformance issue came to be filed
// against correct code. Everything else that needs it references here.
//
// (It also has to live here: `no-hardcoded-hex.test.ts` allows hex literals in
// this file only, so a table naming concrete steps cannot go anywhere else.)
//
// | guidebook role | hyakkei field | light | dark  | family                     |
// |----------------|---------------|-------|-------|----------------------------|
// | Primary        | `primary`     | 900   | 400   | the palette's own ramp     |
// | Primary        | `primaryAlt`  | 600 * | 600 * | the palette's own ramp     |
// | Secondary      | `secondary`   | 800   | 400   | `PALETTE_ROLES[p].secondary`, another hue |
// | Neutral        | `neutral`     | 800   | 400   | SolidGray (absent for the gray palette)   |
// | Others/Success | `success`     | -- Semantic.Success, palette-independent (ADR-0009) |
// | Others/Error   | `error`       | -- Semantic.Error, palette-independent (ADR-0009)   |
//
// `*` `guidebook-neutral` uses 536, not 600 -- see `PALETTE_ROLES`.
//
// Two guidebook roles are deliberately NOT implemented: Positive and Negative.
// Cyan's Positive has no step meeting the 3:1 floor against the light
// background at all (600/200/50 measure 2.83 / 1.20 / 1.00), and no renderer
// consumes them. Deferred with a trigger: when a renderer draws a delta or
// threshold indicator (ADR-0018).
//
// `primaryAlt` is a coined name and does not appear in the guidebook. That is
// the point -- it cannot be mistaken for a guidebook role. It means "the
// second step of this palette's own Primary ramp," which is what the official
// Power BI template paints its second category with.
//
// The concrete instance is `PALETTE_ROLES` below. (Written as line comments,
// not JSDoc: a `/** */` block followed by another `/** */` attaches to nothing
// and never surfaces on hover -- /simplify.)

/**
 * Families are named by STRING, not held as references into `PRIMITIVE` /
 * `NEUTRAL`.
 *
 * The load-time probes are derived from `PALETTE_ROLES` (see
 * `REQUIRED_FAMILY_NAMES`), and a probe list built from object references
 * cannot detect the case it exists for: if `Color.Primitive.Yellow` is gone,
 * `PRIMITIVE.Yellow` is `undefined`, a reference-keyed table stores
 * `undefined`, and any "skip falsy" step in the derivation quietly drops the
 * very family that went missing. Naming them keeps "which families must exist"
 * independent of "which families do exist".
 */
type FamilyName = keyof PrimitiveFamilies | "SolidGray";

function familyLabel(name: FamilyName): string {
  return name === "SolidGray" ? "Color.Neutral.SolidGray" : `Color.Primitive.${name}`;
}

// `Object.hasOwn`, not bare bracket access. This is the same discipline
// `resolveChartColors` and `stepColor` already apply, and this path is where it
// was missing: the name -> bracket lookup is new in issue #122 (the tables used
// to hold object references), and without the guard a deleted
// `Color.Primitive.Yellow` plus a polluted `Object.prototype.Yellow` resolves
// through the prototype chain, passes `assertFamilyShape`, and silently repaints
// every palette's `secondary`. Measured by the Phase 8 security review, which is
// also what makes `assertHexColor`'s "prototype pollution" claim below true --
// it was not, before this line.
function rawFamily(name: FamilyName): unknown {
  if (name === "SolidGray") {
    return Object.hasOwn(NEUTRAL, name) ? NEUTRAL.SolidGray : undefined;
  }
  return Object.hasOwn(PRIMITIVE, name) ? (PRIMITIVE as Record<string, unknown>)[name] : undefined;
}

/**
 * One row per palette -- the concrete instance of THE ROLE TABLE above.
 *
 * One table rather than four parallel `Record<Palette, _>`s (/simplify): the
 * same seven keys written four times means an eighth palette is four edits in
 * four places, and answering "what does guidebook-cyan resolve to" means
 * scanning four tables eighty lines apart. As rows, the compiler's check gets
 * *stronger*, not weaker -- a missing palette and a missing field are both
 * errors, where four separate tables only catch the former.
 *
 * Total `Record<Palette, _>`, never `Partial`: with `Partial`, adding a palette
 * and forgetting it would silently fall back to a default hue and to step 600 --
 * reproducing both defects this table exists to fix. The compiler has to be the
 * one that notices, because nothing downstream does: `assertGraphicContrast`
 * passes a wrong-but-contrasty color without comment.
 *
 * - `family`      the palette's own Primary ramp
 * - `secondary`   the guidebook's Secondary ramp -- a DIFFERENT hue, per palette.
 *                 Three hues across seven, read off the official reference
 *                 images. Cyan takes Green and Green takes Cyan; assuming Yellow
 *                 for all seven (as this file did before issue #122) is wrong
 *                 for exactly those two.
 * - `neutral`     the guidebook's Neutral ramp -- SolidGray, or `null` for
 *                 `guidebook-neutral`, which the guidebook gives no Neutral row:
 *                 its Primary ramp already IS SolidGray, and SolidGray 400 would
 *                 be byte-identical to its own dark `primary`. The absence is
 *                 modelled, not invented around -- see `isSanctionedAbsence`.
 * - `primaryAltStep`  600, except `guidebook-neutral` whose published ramp is
 *                 900 / 700 / 536 / 400 / 200 / 50 and has no 600 step at all.
 */
type PaletteRoles = {
  family: FamilyName;
  secondary: FamilyName;
  neutral: FamilyName | null;
  primaryAltStep: number;
};

const PALETTE_ROLES: Record<Palette, PaletteRoles> = {
  "guidebook-blue": {
    family: "Blue",
    secondary: "Yellow",
    neutral: "SolidGray",
    primaryAltStep: 600,
  },
  "guidebook-light-blue": {
    family: "LightBlue",
    secondary: "Yellow",
    neutral: "SolidGray",
    primaryAltStep: 600,
  },
  "guidebook-cyan": {
    family: "Cyan",
    secondary: "Green",
    neutral: "SolidGray",
    primaryAltStep: 600,
  },
  "guidebook-green": {
    family: "Green",
    secondary: "Cyan",
    neutral: "SolidGray",
    primaryAltStep: 600,
  },
  "guidebook-orange": {
    family: "Orange",
    secondary: "Yellow",
    neutral: "SolidGray",
    primaryAltStep: 600,
  },
  "guidebook-red": {
    family: "Red",
    secondary: "Yellow",
    neutral: "SolidGray",
    primaryAltStep: 600,
  },
  "guidebook-neutral": {
    family: "SolidGray",
    secondary: "Yellow",
    neutral: null,
    primaryAltStep: 536,
  },
};

/**
 * Families read regardless of which palette is being resolved, and not
 * derivable from the per-palette tables: the dark-mode semantic fallback
 * borrows Green/Red for every palette (see DARK_SEMANTIC_STEP).
 */
const CROSS_PALETTE_FAMILY_NAMES: readonly FamilyName[] = ["Green", "Red"];

// Steps are named by NUMBER, never by ramp position. Blue's published ramp
// starts at 1200 and SolidGray's at 900, so `ramp[1]` means 900 for one and
// 700 for the other -- a position-index implementation silently moves
// `guidebook-neutral`'s light `primary` from #1a1a1a to #4d4d4d.
const PRIMARY_STEP: Record<Appearance, number> = { light: 900, dark: 400 };

// Secondary/Neutral steps are uniform across palettes (the published ramps are
// 800/600/400 and 800/600/400/200 respectively; hyakkei takes whichever end
// clears contrast against each background). Yellow 600 (#D2A400) measures
// 2.19:1 against the light background and is not usable standalone -- which is
// why light takes 800 rather than the middle step.
const SECONDARY_STEP: Record<Appearance, number> = { light: 800, dark: 400 };
const NEUTRAL_STEP: Record<Appearance, number> = { light: 800, dark: 400 };

// Dark-mode semantic values do not exist in design-tokens (confirmed: none
// anywhere in the package), and both light Semantic steps sit at or near the
// 3:1 floor against the dark background (Error.2 measures exactly 3.00:1,
// Success.2 3.25:1). Borrowing the Green/Red families' own lighter step gives
// real margin (6.51:1 / 7.07:1). A hyakkei extension, not a guidebook value.
const DARK_SEMANTIC_STEP = 400;

/**
 * `guidebook-cyan` light resolves `primaryAlt` to Cyan 600 (#00A3BF), which
 * measures 2.83:1 against #F8F8FB -- below the 3:1 SC1.4.11 floor. Step 1200
 * (#003741, 12.21:1) clears it and stays visually distinct from `primary`.
 *
 * Two earlier explanations of this override were wrong and are worth naming so
 * they do not come back:
 *
 *   - ADR-0016 read it as evidence that the guidebook contains "deliberate
 *     accessibility-driven exceptions." It contains no such exception. Its only
 *     sanctioned fallbacks when 3:1 cannot be met are placing the value
 *     adjacent to the color area (>=4.5:1) and revealing it on hover/focus --
 *     never shifting the color.
 *   - The correction written into ADR-0016 in July then said the override was
 *     purely an artifact of hyakkei's own role model and would disappear once
 *     #122 landed. Also wrong, in the other direction.
 *
 * What is actually true: **the guidebook's own published assignment does not
 * satisfy the guidebook's own 3:1 floor against this background.** Cyan 600 is
 * a real categorical color in the official Cyan template. hyakkei prioritises
 * the floor and shifts the step. The deviation is ours; the cause is upstream's;
 * it does not go away.
 *
 * `Partial` here is correct and not the `PALETTE_ROLES` case: this table is an
 * exception list, so an absent entry means "no override needed," which is a
 * meaningful default. `assertGraphicContrast` verifies at the point of use
 * rather than trusting the list is complete.
 */
const PRIMARY_ALT_STEP_OVERRIDE: Partial<Record<Appearance, Partial<Record<Palette, number>>>> = {
  light: { "guidebook-cyan": 1200 },
};

// Frozen at runtime, not just `as const` (TS-only): both are exported, and
// a same-realm consumer mutating them would corrupt every later resolution.
export const BACKGROUND = Object.freeze({ light: "#F8F8FB", dark: "#1A1A1A" } as const);

/**
 * Load-time existence probes for every design-tokens family this file can
 * read, DERIVED from the tables above rather than hand-listed.
 *
 * Why derived: a family read cross-palette (Yellow as most palettes'
 * Secondary, SolidGray as every non-gray palette's Neutral, Green/Red for the
 * dark semantic borrow) is read no matter which palette is being resolved, so
 * `resolveChartColors`' palette-key check cannot catch its absence -- it would
 * die as an opaque "Cannot read properties of undefined" deep inside a step
 * lookup, naming neither the missing family nor where to look. issue #122 adds
 * two such families (Cyan, via guidebook-green's Secondary; SolidGray, via
 * every other palette's Neutral), and a hand-maintained probe list is exactly
 * the kind of thing that falls out of sync when a table grows. Deriving it
 * means a future palette or Secondary hue is probed automatically.
 *
 * Deliberately FAMILY-existence only, no step-level probes: a family that
 * exists but lost one step is already handled by the degrade pipeline --
 * `nearestStep` falls back to the numerically nearest surviving step, and if
 * that lands below 3:1 the degrade path records a warning and keeps rendering.
 * A load-time hard-throw for a missing step would blank the whole dashboard
 * over a condition the code survives, contradicting the crash-is-worse-than-
 * degrade principle `ContrastWarning` commits to.
 */
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

// `probeStep` is omitted for the Semantic children only because they are read
// by direct property access (`SEMANTIC.Success["2"]`) with no nearest-step
// fallback -- there a missing step IS a real crash, so failing loudly at load
// is strictly better. Everything below goes through `nearestStep`.
//
// The set of families to probe is the union of every NAME the tables mention.
// Because these are names rather than object references, a family that has
// vanished upstream still appears in this set and still gets probed -- which
// is the entire point. (An earlier draft collected references and skipped
// falsy ones, which silently un-probed exactly the missing families; three
// existing tests caught it.)
const REQUIRED_FAMILY_NAMES: readonly FamilyName[] = [
  ...new Set<FamilyName>([
    ...Object.values(PALETTE_ROLES).flatMap((r) =>
      r.neutral === null ? [r.family, r.secondary] : [r.family, r.secondary, r.neutral],
    ),
    ...CROSS_PALETTE_FAMILY_NAMES,
  ]),
];

// Probed and resolved in one pass: a throw aborts module load, so no
// partially-built `FAMILY` can escape and the cast cannot mask a missing family.
const FAMILY = Object.fromEntries(
  REQUIRED_FAMILY_NAMES.map((name) => {
    const raw = rawFamily(name);
    assertFamilyShape(familyLabel(name), raw);
    return [name, raw as ColorFamily];
  }),
) as Record<FamilyName, ColorFamily>;

/**
 * design-tokens ships JS, so a hostile publisher already has arbitrary code
 * execution at import time and no validation here would change that. **This is
 * not a supply-chain control.** What it catches is narrower and real:
 *
 *   - benign upstream format drift (a style-dictionary change emitting
 *     `rgb()`, `var(--x)` or `#RRGGBBAA` instead of `#RRGGBB`)
 *   - `Object.prototype` pollution reaching a token read
 *   - a future non-token color source being wired in without noticing
 *
 * It matters because `hexToRgb` below is total and silent: `parseInt` of a
 * non-hex string yields `NaN`, the bit operations collapse it to `[0,0,0]`, and
 * the value is then scored as pure black. Measured: both `rgb(1,2,3)` and
 * `url(https://example/x#p)` come out at 19.81:1 against the light background
 * and sail through the 3:1 gate. Colors reach SVG paint attributes, so a
 * `url(...)` that survived this far would be an outbound reference from an
 * artifact whose whole point is that it makes no network requests.
 *
 * Throwing (rather than degrading) is a deliberate exception to the
 * degrade-not-crash principle, and the first version of this comment justified
 * it wrongly. It claimed a malformed value "can only appear in development or
 * CI, never in a distributed single-file dashboard whose hexes are already
 * baked" -- but `BakedDashboard.theme` carries only `{tokens, palette,
 * appearance}`, so colors are resolved in the **viewer's** browser on the baked
 * path (`render-model.ts`), exactly as the `ContrastWarning` doc below says.
 * The two comments contradicted each other and the other one was right (Phase 8
 * security review).
 *
 * The actual justification is narrower: what reaches a viewer is the
 * design-tokens build that shipped with the artifact, so a malformed `$value`
 * there means the bundle itself is broken -- there is no "degraded but usable"
 * rendering to fall back to, and a color that scores as pure black would be
 * silently wrong rather than visibly absent. Contrast drift degrades; a
 * structurally invalid token does not.
 */
const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;

function assertHexColor(value: unknown, label: string): string {
  if (typeof value !== "string" || !HEX_COLOR.test(value)) {
    throw new Error(
      `hyakkei theme: ${label} is not a #rrggbb literal (got ${JSON.stringify(value)}) — token package drift?`,
    );
  }
  return value;
}

/**
 * Closest available step by numeric distance, not `family[step] ??
 * family[fallbackIndex]`: `SolidGray`'s step set (50/100/.../420/500/536/
 * 600/.../900, no 1000/1100/1200) doesn't line up with the 10-hue families'
 * (50/100/.../900/1000/1100/1200), so a fixed-index fallback silently picks
 * the wrong step for any family whose set differs from the common case.
 *
 * Since issue #122 the chart path asks for steps by explicit number, so this is
 * a **token-drift fallback**, not the primary lookup: it answers "the step this
 * palette is supposed to use is gone, give me the nearest survivor" and keeps
 * rendering. The `Number.isFinite` guard matters for that role -- `Math.abs(b -
 * NaN) < Math.abs(a - NaN)` is always false, so a `NaN`/`undefined` target used
 * to make `reduce` return its seed and hand back the numerically lowest step
 * (SolidGray's #f2f2f2) with no error at all.
 */
// Exported for the same reason as `meetsGraphicContrastFloor` and
// `assertGraphicContrast` below: the `Number.isFinite` guard is
// defence-in-depth against a future refactor reintroducing an
// out-of-range step lookup, so no production call path can currently reach
// it (every step table is a total `Record`). A guard nothing can exercise is
// a guard nothing can prove — a mutation run confirmed that deleting it
// killed zero tests before this export existed.
export function nearestStep(family: ColorFamily, target: number, label: string): string {
  if (!Number.isFinite(target)) {
    throw new Error(`hyakkei theme: ${label} asked for a non-finite step (${String(target)})`);
  }
  const steps = Object.keys(family).map(Number);
  const closest = steps.reduce((a, b) => (Math.abs(b - target) < Math.abs(a - target) ? b : a));
  // Non-null: `closest` is derived from `Object.keys(family)` on the line
  // above, so `family[String(closest)]` is guaranteed present by
  // construction -- `noUncheckedIndexedAccess` can't see that invariant
  // through the `.map(Number)`/`.reduce()` chain.
  const token = family[String(closest)];
  if (!token) throw new Error(`unreachable: step ${closest} missing from its own family's keys`);
  return assertHexColor(token.$value, `${label} (step ${closest})`);
}

/**
 * A role's color, by explicit step number.
 *
 * Exact lookup first, `nearestStep` only on a miss -- this is what makes
 * `nearestStep`'s demotion to a drift fallback real rather than merely stated.
 * /simplify caught the earlier version claiming that demotion in a comment
 * while every production role still went through the fuzzy path: what issue
 * #122 changed was the *argument* (an explicit step instead of a rough target),
 * not the mechanism. That left the SolidGray-600 bug class live -- a future row
 * naming a step its ramp does not have would be absorbed silently, twice over,
 * since `nearestStep` cannot distinguish a hit from a substitution and the
 * degrade warning only fires if the substituted neighbour ALSO breaks 3:1.
 *
 * Behaviourally identical on the happy path (distance 0 is uniquely minimal),
 * so this is the one place a substitution could later be recorded.
 */
function stepColor(family: ColorFamily, target: number, label: string): string {
  const exact = Object.hasOwn(family, String(target)) ? family[String(target)] : undefined;
  if (exact) return assertHexColor(exact.$value, `${label} (step ${target})`);
  return nearestStep(family, target, label);
}

export type ChartColors = {
  // -- categorical series: these three, in this order, are the ECharts
  //    `color` array (echarts-theme.ts). Everything below is resolved but not
  //    part of the categorical rotation.
  primary: string;
  primaryAlt: string;
  secondary: string;
  // -- de-emphasis: the guidebook's Neutral. `null` for `guidebook-neutral`,
  //    which has no Neutral row (see PALETTE_ROLES). Deliberately not
  //    optional -- see `isSanctionedAbsence`.
  neutral: string | null;
  // -- semantic: shared across every palette (ADR-0009). No renderer consumes
  //    these yet.
  success: string;
  error: string;
  // -- surface
  background: string;
};

// Exported (not module-private) so tests iterate the same role list the
// implementation checks, instead of re-declaring a copy that can drift.
// Runtime-frozen for the same reason as BACKGROUND above.
//
// ONE list, not one per consumer: contrast checking and pairwise distinctness
// happen to need the same set today, and keeping two identical lists in sync
// is a drift source with no benefit. What the two consumers genuinely share is
// the need to skip a *sanctioned* absence, and that is factored into the single
// `isSanctionedAbsence` predicate below rather than into a second list.
export const CHART_COLOR_ROLES = Object.freeze([
  "primary",
  "primaryAlt",
  "secondary",
  "neutral",
  "success",
  "error",
] as const);
export type ChartColorRole = (typeof CHART_COLOR_ROLES)[number];

/**
 * The only (palette, role) pair whose color is legitimately absent.
 *
 * Derived from `PALETTE_ROLES`, so the table stays the single place the
 * absence is declared. Every consumer that iterates `CHART_COLOR_ROLES` routes
 * its skip through here -- if the allowlist were duplicated at each call site,
 * the two copies would eventually disagree about which absences are intended.
 *
 * The distinction this exists to preserve: `null` means "the guidebook gives
 * this palette no such role," `undefined` means "something is broken." An
 * `optional` field would collapse both into the same shape, and a
 * `if (!color) continue` would then silently pass a role that vanished due to a
 * bug -- the pairwise distinctness matrix in particular would report
 * `undefined !== "#333333"` as a healthy non-collision.
 */
export function isSanctionedAbsence(palette: Palette, role: ChartColorRole): boolean {
  return role === "neutral" && PALETTE_ROLES[palette].neutral === null;
}

// issue #65: (palette, appearance) inputs are a closed 7x2 = 14-entry
// enum whose resolved colors never change within a process lifetime -- this
// memoizes what was previously a full re-scan + luminance/contrast computation
// on every `buildEChartsTheme` call. `Map`, not a plain object: a plain-object
// cache keyed by an untrusted `palette`/`appearance` string would let a
// `"__proto__"` key silently vanish into a prototype setter instead of being
// stored (this repo's own recurring bug class).
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
 * one 8-bit step) used to crash the whole render. For a browser-complete
 * product read in closed/air-gapped networks (LGWAN etc.), a viewer who hits
 * this has no recourse -- a blank white dashboard is a strictly worse outcome
 * than one chart's role rendering at reduced contrast. `resolveChartColors`
 * degrades instead: the violating color still ships, and the violation is
 * recorded here.
 *
 * Note what this is NOT, since the wording used to imply otherwise: it is not
 * an operational observation channel. `getContrastWarnings()` has no non-test
 * caller, and color resolution runs in the *viewer's* browser on the baked path
 * (`render-model.ts`), so a `console.warn` here surfaces in the devtools of
 * whoever was handed the file and reaches nobody who could act on it. The real
 * defence is `assertGraphicContrast`, which CI runs against all 14
 * combinations as a hard gate. This is a future hook plus a last-resort record,
 * not monitoring.
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

function contrastViolations(palette: Palette, colors: ChartColors): ContrastViolation[] {
  const violations: ContrastViolation[] = [];
  for (const role of CHART_COLOR_ROLES) {
    const color = colors[role];
    if (color === null) {
      if (isSanctionedAbsence(palette, role)) continue;
      throw new Error(
        `resolveChartColors(${palette}): role '${role}' resolved to null, which is not a sanctioned absence`,
      );
    }
    const ratio = contrastRatio(color, colors.background);
    if (!meetsGraphicContrastFloor(ratio)) {
      violations.push({ role, ratio });
    }
  }
  return violations;
}

// Shared between the degrade-path `console.warn` and `assertGraphicContrast`'s
// throw -- the two messages must describe the same violation identically and
// diverge only in what the reader should do about it. `caller` is passed in
// rather than hardcoded: the message named `resolveChartColors` even when it
// came from `assertGraphicContrast`, misattributing the origin in exactly the
// situation a reader is trying to trace (/simplify).
function formatContrastViolation(
  caller: string,
  palette: Palette,
  appearance: Appearance,
  colors: ChartColors,
  violation: ContrastViolation,
): string {
  return `${caller}(${palette}, ${appearance}): ${violation.role} ${String(colors[violation.role])} vs background ${colors.background} = ${violation.ratio.toFixed(2)}:1, below the 3:1 SC1.4.11 minimum.`;
}

export function resolveChartColors(palette: Palette, appearance: Appearance): ChartColors {
  // issue #65 item 3 (`__proto__` hardening): these tables are plain object
  // literals, so a bare truthy check on `table[key]` alone resolves
  // `"__proto__"` to `Object.prototype` (truthy) instead of `undefined` --
  // silently passing an attacker- or bug-supplied `"__proto__"` straight
  // through. `Object.hasOwn` checks own keys only, but is combined with the
  // original truthy check (not `hasOwn` alone) so a family that genuinely IS an
  // own key with an `undefined` value (upstream drift collapsing `PRIMITIVE.X`)
  // still throws the same named error.
  const roles = Object.hasOwn(PALETTE_ROLES, palette) ? PALETTE_ROLES[palette] : undefined;
  if (!roles) {
    throw new Error(`resolveChartColors: unknown palette '${String(palette)}'`);
  }
  const background = Object.hasOwn(BACKGROUND, appearance) ? BACKGROUND[appearance] : undefined;
  if (!background) {
    throw new Error(`resolveChartColors: unknown appearance '${String(appearance)}'`);
  }

  // Nothing but the two validations above happens before the memo gate
  // (/simplify Efficiency): the family lookups below cannot fail -- PALETTE_ROLES
  // is total and FAMILY is keyed by names it was built from -- so doing them
  // above the gate was pure work on every cache hit.
  const key = cacheKey(palette, appearance);
  const cached = themeColorCache.get(key);
  if (cached) {
    return cached;
  }

  const family = FAMILY[roles.family];
  const secondaryFamily = FAMILY[roles.secondary];
  const neutralFamily = roles.neutral === null ? null : FAMILY[roles.neutral];
  const primaryAltStep = PRIMARY_ALT_STEP_OVERRIDE[appearance]?.[palette] ?? roles.primaryAltStep;

  const colors: ChartColors = {
    primary: stepColor(family, PRIMARY_STEP[appearance], `${palette} primary`),
    primaryAlt: stepColor(family, primaryAltStep, `${palette} primaryAlt`),
    secondary: stepColor(secondaryFamily, SECONDARY_STEP[appearance], `${palette} secondary`),
    neutral: neutralFamily
      ? stepColor(neutralFamily, NEUTRAL_STEP[appearance], `${palette} neutral`)
      : null,
    // light: Error.2/Success.2 (#CE0000/#197A4B) are the higher-contrast of the
    // two shared Semantic steps design-tokens defines (5.47:1 / 5.05:1 against
    // the light background vs. 4.34:1 / 3.26:1 for step 1).
    // dark: see DARK_SEMANTIC_STEP.
    success:
      appearance === "light"
        ? assertHexColor(SEMANTIC.Success["2"].$value, "Semantic.Success.2")
        : stepColor(FAMILY.Green, DARK_SEMANTIC_STEP, "dark success"),
    error:
      appearance === "light"
        ? assertHexColor(SEMANTIC.Error["2"].$value, "Semantic.Error.2")
        : stepColor(FAMILY.Red, DARK_SEMANTIC_STEP, "dark error"),
    background,
  };

  // Runs exactly once per (palette, appearance) -- on the cache-miss path,
  // never gated behind a test-only or NODE_ENV flag (see `ContrastWarning`
  // doc comment above). `assertGraphicContrast` (below) stays the throwing
  // hard gate CI calls directly; this is the non-throwing sibling that
  // backs runtime degrade.
  for (const violation of contrastViolations(palette, colors)) {
    // Frozen at construction, not just in `getContrastWarnings`'s returned
    // array: `readonly` on `ContrastWarning`'s fields is TS-only -- without
    // this, a consumer holding a warning object from a prior call could
    // mutate it in place and corrupt the entries still held in
    // `contrastWarnings` itself, since arrays only ever store references.
    const warning: ContrastWarning = Object.freeze({
      palette,
      appearance,
      role: violation.role,
      // Non-null: a role that reached `contrastViolations`' ratio check had a
      // string color; a sanctioned `null` is skipped before that point.
      color: colors[violation.role] as string,
      background: colors.background,
      ratio: violation.ratio,
    });
    contrastWarnings.push(warning);
    console.warn(
      `${formatContrastViolation("resolveChartColors", palette, appearance, colors, violation)} Rendering anyway (degraded) -- see getContrastWarnings().`,
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
// hex-based fixture alone cannot distinguish `< 3` from `<= 3`.
const GRAPHIC_CONTRAST_FLOOR = 3;

// Exported so this exact comparison can be unit-tested with exact numeric
// boundary values, independent of hex-color quantization.
export function meetsGraphicContrastFloor(ratio: number): boolean {
  return ratio >= GRAPHIC_CONTRAST_FLOOR;
}

// Exported (not just used internally) so it can be unit-tested directly with
// synthetic hex pairs -- if a future palette/background/appearance addition
// reintroduces a sub-3:1 combination, this throws instead of silently
// shipping it. Unlike `resolveChartColors` (issue #65: degrades + records
// instead of throwing), this stays a throwing hard gate -- it is what CI calls
// directly against all 14 real (palette, appearance) combinations, independent
// of whether `resolveChartColors`'s cache has already resolved them, and it is
// the real defence the degrade path is NOT (see `ContrastWarning`).
export function assertGraphicContrast(
  palette: Palette,
  appearance: Appearance,
  colors: ChartColors,
): void {
  const [first] = contrastViolations(palette, colors);
  if (first) {
    throw new Error(
      `${formatContrastViolation("assertGraphicContrast", palette, appearance, colors, first)} Add a PRIMARY_ALT_STEP_OVERRIDE (or equivalent) entry.`,
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
