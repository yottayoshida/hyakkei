// PR-C, issue #9 acceptance: "visual-regression goldens pass across all 7
// key colors × 2 appearances." `theme/palette.test.ts` (PR-A) already pins
// the *hex derivation math* for this exact matrix -- what's new here is
// pinning the actual rendered SVG output of the production render pipeline
// (buildOptions -> ECharts SSR) for each combination, the "does the palette
// actually reach a real chart" counterpart to that unit-level math check.
//
// SSR (no DOM/jsdom): a bare bar chart is enough to exercise every themed
// visual channel a palette touches (series color, background, text color,
// axis line) without needing this file to duplicate golden-samples.test.ts's
// full-dashboard scope.
import { Palette as PaletteSchema } from "@hyakkei/schema";
import type { BakedDashboard, Palette } from "@hyakkei/schema";
import { describe, expect, it } from "vitest";
import { GOLDEN_BAKE_META } from "../../golden-fixtures/index.js";
import { buildEChartsTheme } from "../../theme/echarts-theme.js";
import { buildOptions } from "../build-options.js";
import { normalizeBaked } from "../render-model.js";
import { renderOptionToSvg } from "./render-svg.js";

// Derived from the compiled schema, not hand-listed (/simplify Reuse). A
// hand-maintained copy means an eighth palette silently gets zero snapshots and
// is excluded from the wiring test below -- which is precisely the "matrix
// restricted to the palettes we expect to move" blind spot this fixture exists
// to remove. `palette.test.ts` already carries the same derivation as a drift
// guard; this file had no equivalent.
const PALETTES = (PaletteSchema as unknown as { anyOf: { const: Palette }[] }).anyOf.map(
  (member) => member.const,
);
const APPEARANCES = ["light", "dark"] as const;

const ROWS = [
  { category: "建築", value: 120 },
  { category: "農地", value: 90 },
  { category: "その他", value: 45 },
];

// One fixture builder, two chart shapes (/simplify Reuse + Simplification): the
// bar and pie renderers were 24-line clones differing in four fields, so the
// `BakedDashboard` skeleton was pinned twice in one file and would drift apart
// on the next schema change while both kept passing.
function renderChart(
  palette: Palette,
  appearance: "light" | "dark",
  title: string,
  chart: BakedDashboard["charts"][number],
): string {
  const baked: BakedDashboard = {
    version: 1,
    meta: { title, ...GOLDEN_BAKE_META },
    theme: { tokens: "@digital-go-jp/design-tokens@2.0.1", palette, appearance },
    charts: [chart],
    layout: { grid: "guidebook-12col", items: [{ chart: "c1", x: 0, y: 0, w: 6, h: 4 }] },
  };
  return renderOptionToSvg(buildOptions(normalizeBaked(baked)).c1!);
}

const renderBar = (palette: Palette, appearance: "light" | "dark"): string =>
  renderChart(palette, appearance, "palette golden", {
    id: "c1",
    type: "bar",
    encoding: { x: "category", y: "value" },
    options: { title: "区分別件数" },
    rows: ROWS,
  });

// issue #122: `renderBar` is single-series, so it only ever bakes `color[0]` --
// measured, not assumed: before this fixture existed, `#666666`
// (guidebook-neutral's second categorical color) appeared ZERO times across
// every golden snapshot in the repo, and the only fixture anywhere that baked
// `color[1]`/`color[2]` was golden-samples' orange `budget` pie. That made "the
// palette change produced no golden diff" unfalsifiable: the values being
// changed were outside every golden's field of view.
//
// A three-slice pie is the smallest chart that consumes all three entries of
// the ECharts categorical `color` array (build-options.ts sets `color:
// theme.color` at option level and ECharts cycles it per slice).
const renderPie = (palette: Palette, appearance: "light" | "dark"): string =>
  renderChart(palette, appearance, "palette golden (categorical trio)", {
    id: "c1",
    type: "pie",
    encoding: { category: "category", value: "value" },
    options: { title: "区分別構成比" },
    rows: ROWS,
  });

// Rendered once, at module scope, and reused by the per-combination snapshots,
// the distinctness check and the wiring test (/simplify Efficiency finding:
// re-rendering the matrix per test doubled SSR work for no new information;
// computing here instead of inside a `beforeAll` also avoids depending on
// Vitest's `it` declaration order to populate a shared mutable map).
const matrix = (render: (p: Palette, a: "light" | "dark") => string): ReadonlyMap<string, string> =>
  new Map(
    PALETTES.flatMap((palette) =>
      APPEARANCES.map(
        (appearance) => [`${palette}/${appearance}`, render(palette, appearance)] as const,
      ),
    ),
  );

const RENDERED = matrix(renderBar);
const RENDERED_PIE = matrix(renderPie);

describe("golden: all 7 palettes x 2 appearances render a stable, distinct SVG", () => {
  for (const palette of PALETTES) {
    for (const appearance of APPEARANCES) {
      it(`${palette}/${appearance}`, () => {
        expect(RENDERED.get(`${palette}/${appearance}`)).toMatchSnapshot();
      });
    }
  }

  it("all 14 combinations produce mutually distinct normalized SVG (no accidental collapse)", () => {
    expect(RENDERED.size).toBe(PALETTES.length * APPEARANCES.length);
    expect(new Set(RENDERED.values()).size).toBe(RENDERED.size);
  });
});

describe("golden: the full categorical trio (color[0..2]) reaches a rendered chart (issue #122)", () => {
  for (const palette of PALETTES) {
    for (const appearance of APPEARANCES) {
      it(`${palette}/${appearance} pie`, () => {
        expect(RENDERED_PIE.get(`${palette}/${appearance}`)).toMatchSnapshot();
      });
    }
  }

  it("all 14 combinations produce mutually distinct normalized SVG (no accidental collapse)", () => {
    expect(RENDERED_PIE.size).toBe(PALETTES.length * APPEARANCES.length);
    expect(new Set(RENDERED_PIE.values()).size).toBe(RENDERED_PIE.size);
  });

  // The snapshots above are only load-bearing if all three categorical entries
  // actually reach the emitted SVG. Without this, a future change to
  // `pieOption`/`buildChartOption` that stops applying the theme palette per
  // slice would silently turn 14 snapshots into a single-color fixture that
  // can never detect a palette regression again -- they would still be stable,
  // still pass, and still prove nothing.
  //
  // Reading the trio from `buildEChartsTheme().color` (rather than naming
  // roles here) is deliberate: that array IS the categorical palette by
  // definition, so this assertion survives the issue #122 role rename with no
  // edit, and it is not a mirror test of the VALUES -- those are pinned by the
  // snapshots above. What this asserts is the wiring.
  //
  // Slot-based, not set-based (Codex 6-B): an earlier version collected every
  // `#rrggbb` in the SVG and checked membership, which proves only "this hex
  // appears somewhere" -- it would pass with two slices sharing a color, or
  // with a slice painted from the background. ECharts tags each slice path with
  // `ecmeta_data_index`, so the actual claim -- data index N is painted with
  // categorical slot N -- is directly checkable.
  //
  // What this still CANNOT catch, stated because the obvious reading is wrong:
  // reversing `buildEChartsTheme`'s `color` array. The expected value comes
  // from that same array, so both sides move together -- verified by mutation,
  // the reversal passes here. Ordering correctness is pinned by the 14
  // snapshots above (the reversal fails 40 of them). This test's job is the
  // wiring; theirs is the values. Do not "strengthen" this by hardcoding
  // role names -- that would re-couple it to the naming this change exists to
  // fix, and the snapshots already cover it.
  //
  // A still earlier version scanned `fill="#rrggbb"` and required >= 3 distinct
  // values. Measured, the non-series fills in this SVG are exactly two (text
  // #3c3c41 and the background), so that threshold was satisfiable by two
  // chrome colors plus ONE series color -- it could not tell "the whole trio
  // reached the output" from "one of the three did," which is the only thing
  // it was there to establish. (The first diagnosis of that weakness was also
  // wrong, and is worth recording: `aria.decal.show` is unconditional, so each
  // slice carries an ADDITIONAL overlay path whose fill is a `url(#…)` pattern
  // reference -- but the slice's own path does carry a plain hex fill, which is
  // what the matcher above reads.)
  // issue #122 promoted decal from a supplement to a load-bearing channel, and
  // nothing pinned it. Measured inter-series contrast for the categorical trio
  // at light appearance: guidebook-cyan slot 0 vs 2 is 1.09:1 and
  // guidebook-green slot 1 vs 2 is 1.31:1 -- in grayscale, on a monochrome
  // print, or under tritanopia those pairs do not separate by color at all, so
  // the pattern overlay is the only thing left. (The unchanged palettes sit in
  // the same band -- orange 1.16:1, blue 1.35:1 -- so this is a property of the
  // guidebook's assignment, not of this change; what changed is that the worst
  // case is now cyan's.)
  //
  // `aria.decal.show` is set unconditionally in `build-options.ts`, one line,
  // with no test anywhere in the repo asserting the rendered result. Deleting
  // it would leave every snapshot still passing except for the pattern
  // definitions -- which is precisely the kind of silent removal a reader would
  // read as cosmetic.
  it("every pie slice carries a decal pattern, and the three patterns differ", () => {
    for (const [key, svg] of RENDERED_PIE) {
      // The decal is a separate overlay path per slice (no `ecmeta_data_index`
      // of its own -- that lives on the coloured slice underneath), whose fill
      // is a reference to a generated `<pattern>`.
      const refs = [...svg.matchAll(/fill="url\(#([A-Za-z0-9]+)\)"/g)].map((m) => m[1]!);
      expect(refs.length, `${key}: expected one decal overlay per slice`).toBe(3);
      expect(new Set(refs).size, `${key}: each slice must reference its own pattern`).toBe(3);

      // Distinct ids alone would be satisfied by three identical patterns under
      // different names, which would separate nothing. Pin the definitions.
      const defs = refs.map((id) => {
        const m = svg.match(new RegExp(`<pattern[^>]*\\bid="${id}"[^>]*>`));
        expect(m, `${key}: no <pattern> defined for ${id}`).not.toBeNull();
        // Drop the id so the comparison is about geometry, not naming.
        return m![0].replace(/\bid="[^"]*"/, "");
      });
      expect(new Set(defs).size, `${key}: the three decal patterns are not distinct`).toBe(3);
    }
  });

  it("data index N is painted with categorical slot N (ordered wiring, not mere presence)", () => {
    for (const palette of PALETTES) {
      for (const appearance of APPEARANCES) {
        const svg = RENDERED_PIE.get(`${palette}/${appearance}`)!;
        const bySlot = new Map<number, string>();
        for (const m of svg.matchAll(/ecmeta_data_index="(\d+)"[^>]*?fill="(#[0-9a-fA-F]{6})"/g)) {
          bySlot.set(Number(m[1]), m[2]!.toLowerCase());
        }
        const categorical = buildEChartsTheme(palette, appearance).color;
        expect(categorical).toHaveLength(3);
        // The fixture has exactly three slices, so every categorical slot is
        // exercised -- if this drops below 3, the fixture stopped covering the
        // trio and the snapshots above stopped proving anything about it.
        expect(bySlot.size, `${palette}/${appearance}: slice paths found`).toBe(3);
        for (const [slot, hex] of categorical.entries()) {
          expect(
            bySlot.get(slot),
            `${palette}/${appearance}: data index ${slot} should use categorical slot ${slot}`,
          ).toBe(hex.toLowerCase());
        }
      }
    }
  });
});
