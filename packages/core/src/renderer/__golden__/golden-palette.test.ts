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
import type { BakedDashboard, Palette } from "@hyakkei/schema";
import { describe, expect, it } from "vitest";
import { GOLDEN_BAKE_META } from "../../golden-fixtures/index.js";
import { buildOptions } from "../build-options.js";
import { normalizeBaked } from "../render-model.js";
import { renderOptionToSvg } from "./render-svg.js";

const PALETTES: Palette[] = [
  "guidebook-blue",
  "guidebook-light-blue",
  "guidebook-cyan",
  "guidebook-green",
  "guidebook-orange",
  "guidebook-red",
  "guidebook-neutral",
];
const APPEARANCES = ["light", "dark"] as const;

function renderBar(palette: Palette, appearance: "light" | "dark"): string {
  const baked: BakedDashboard = {
    version: 1,
    meta: { title: "palette golden", ...GOLDEN_BAKE_META },
    theme: { tokens: "@digital-go-jp/design-tokens@2.0.1", palette, appearance },
    charts: [
      {
        id: "c1",
        type: "bar",
        encoding: { x: "category", y: "value" },
        options: { title: "区分別件数" },
        rows: [
          { category: "建築", value: 120 },
          { category: "農地", value: 90 },
          { category: "その他", value: 45 },
        ],
      },
    ],
    layout: { grid: "guidebook-12col", items: [{ chart: "c1", x: 0, y: 0, w: 6, h: 4 }] },
  };

  const option = buildOptions(normalizeBaked(baked)).c1!;
  return renderOptionToSvg(option);
}

// Rendered once, at module scope, and reused by both the per-combination
// snapshots and the distinctness check below (/simplify Efficiency finding:
// re-rendering all 14 a second time in the distinctness test doubled SSR
// work for no new information; computing here instead of inside a `beforeAll`
// also avoids depending on Vitest's `it` declaration order to populate a
// shared mutable map before it's read).
const RENDERED: ReadonlyMap<string, string> = new Map(
  PALETTES.flatMap((palette) =>
    APPEARANCES.map(
      (appearance) => [`${palette}/${appearance}`, renderBar(palette, appearance)] as const,
    ),
  ),
);

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
