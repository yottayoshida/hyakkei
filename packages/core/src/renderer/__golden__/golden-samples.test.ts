// @vitest-environment jsdom
// PR-C, issue #8 acceptance: "A hand-written dashboard.json renders
// correctly; golden-image tests for 3 samples, both themes." Exercises the
// full production pipeline -- normalizeAuthoring/normalizeBaked ->
// buildOptions -> ECharts SSR -- against 3 realistic sample dashboards
// (packages/core/src/golden-fixtures) collectively covering all 7
// ChartVariant types, both light and dark appearance, and both the
// authoring and authoring->bake->baked render paths (plan §PR thesis,
// PR-B: these two paths must never visibly diverge).
import type { Dashboard } from "@hyakkei/schema";
import { describe, expect, it } from "vitest";
import { bake } from "../../bake/bake.js";
import {
  GOLDEN_BAKE_META,
  GOLDEN_SAMPLES,
  type GoldenSample,
} from "../../golden-fixtures/index.js";
import { buildOptions } from "../build-options.js";
import { cellText } from "../dom/cell-text.js";
import { encodingColumns } from "../encoding-columns.js";
import { mount, unmount } from "../mount.js";
import { normalizeAuthoring, normalizeBaked, type RenderModel } from "../render-model.js";
import { renderOptionToSvg } from "./render-svg.js";

const APPEARANCES = ["light", "dark"] as const;
type Appearance = (typeof APPEARANCES)[number];

// buildOptions() only produces an EChartsOption for the 5 ECharts-backed
// variants (build-options.ts's own switch default: "table/stat render as
// DOM, not ECharts options") -- table/stat's golden coverage is the DOM
// assertion below (accessible fallback + no error tile), not an SVG.
function renderAllCharts(model: RenderModel): Record<string, string> {
  const options = buildOptions(model);
  const rendered: Record<string, string> = {};
  for (const entry of model.charts) {
    const option = options[entry.id];
    if (!option) continue;
    rendered[entry.id] = renderOptionToSvg(option);
  }
  return rendered;
}

function withAppearance(sample: GoldenSample, appearance: Appearance): Dashboard {
  return { ...sample.doc, theme: { ...sample.doc.theme, appearance } };
}

const ECHARTS_CHART_TYPES = new Set(["bar", "line", "area", "scatter", "pie"]);

function echartsChartIds(doc: Dashboard): string[] {
  return doc.charts.filter((c) => ECHARTS_CHART_TYPES.has(c.type)).map((c) => c.id);
}

/**
 * Mounts `model` in a fresh container, runs `assertions`, then always
 * unmounts and removes the container -- even if an assertion throws
 * (/code-review xhigh finding: the two callers below used to mount, assert,
 * then unmount+remove as separate un-guarded statements, so a thrown
 * expect() left both the DOM node attached to document.body and its
 * ECharts instance un-disposed for the rest of the test run).
 */
function withMountedContainer(
  model: RenderModel,
  widthPx: number,
  assertions: (container: HTMLElement) => void,
): void {
  const container = document.createElement("div");
  container.style.width = `${widthPx}px`;
  container.style.height = "2000px";
  document.body.appendChild(container);
  mount(container, model);
  try {
    assertions(container);
  } finally {
    unmount(container);
    container.remove();
  }
}

describe.each(GOLDEN_SAMPLES)("golden sample: $id", (sample: GoldenSample) => {
  // Computed once per sample and shared with the trailing narrow-viewport
  // test below (/code-review xhigh finding: that test used to recompute
  // this exact (sample, "light") bake()+normalizeBaked() from scratch, the
  // same redundant-recomputation pattern the inner describe.each block's
  // own comment already calls out for its sibling `it`s).
  const lightDoc = withAppearance(sample, "light");
  const lightBakedModel = normalizeBaked(bake(lightDoc, sample.rowsByQuery, GOLDEN_BAKE_META));

  describe.each(APPEARANCES)("appearance: %s", (appearance) => {
    const doc = withAppearance(sample, appearance);

    // Computed once per (sample, appearance) and reused by every `it` below
    // (/simplify Efficiency finding: each of the 3 SVG-related tests
    // independently recomputed bake()/normalize*/renderAllCharts() on the
    // SAME inputs -- read-only, so sharing is safe and halves the SSR
    // render count for this describe block). The "light" case reuses
    // lightBakedModel above rather than baking a second time.
    const authoringModel = normalizeAuthoring(doc, sample.rowsByQuery);
    const bakedModel =
      appearance === "light"
        ? lightBakedModel
        : normalizeBaked(bake(doc, sample.rowsByQuery, GOLDEN_BAKE_META));
    const authoringRendered = renderAllCharts(authoringModel);
    const bakedRendered = renderAllCharts(bakedModel);

    it("authoring path SVG matches golden snapshot", () => {
      expect(authoringRendered).toMatchSnapshot();
    });

    it("authoring→bake→baked path SVG matches golden snapshot", () => {
      expect(bakedRendered).toMatchSnapshot();
    });

    it("authoring and baked paths render byte-identical normalized SVG (preview == published)", () => {
      // Codex Phase 6-B: without this, a shared bug that dropped the SAME
      // chart from BOTH paths (e.g. buildOptions() returning undefined for
      // both) would still pass the equality below vacuously -- {} equals
      // {}. Pinning the expected id set first makes "both paths rendered
      // nothing" a distinct, loud failure instead of a silent pass.
      const expectedIds = echartsChartIds(doc).sort();
      expect(Object.keys(authoringRendered).sort()).toEqual(expectedIds);
      expect(Object.keys(bakedRendered).sort()).toEqual(expectedIds);

      expect(authoringRendered).toEqual(bakedRendered);
    });

    it("every placed chart has an accessible data-table fallback, and no chart shows an error tile", () => {
      const model = bakedModel;
      withMountedContainer(model, 1200, (container) => {
        expect(container.querySelectorAll(".hyakkei-error-tile")).toHaveLength(0);
        const tiles = container.querySelectorAll(".hyakkei-tile");
        expect(tiles).toHaveLength(doc.layout.items.length);

        // Codex Phase 6-B (False Confidence finding): "a fallback table
        // exists" alone doesn't prove it holds the right data -- a chart
        // whose fallback silently rendered zero rows or the wrong columns
        // would still pass a bare existence/count check. `.hyakkei-tile`
        // order matches `doc.layout.items` order (mount.ts appends one per
        // item, in order), so each tile can be cross-checked against its own
        // chart's declared encoding columns and row count.
        const chartsById = new Map(model.charts.map((c) => [c.id, c]));
        doc.layout.items.forEach((item, i) => {
          const entry = chartsById.get(item.chart);
          if (!entry) throw new Error(`fixture bug: layout item '${item.chart}' has no chart`);
          const table = tiles[i]!.querySelector(".hyakkei-accessible-fallback table")!;
          const columns = encodingColumns(entry.chart);
          const headerTexts = [...table.querySelectorAll("th")].map((th) => th.textContent);
          expect(headerTexts).toEqual(columns);

          // Codex Phase 6-B follow-up: header+row-count alone still let a
          // table with the right shape but blank/shifted/wrong-row cells
          // pass. Every <td> is checked against the same row/column it was
          // built from, using the same cellText() the production code uses
          // (a raw String() would diverge on null/undefined, per QA F-001).
          const bodyRows = [...table.querySelectorAll("tbody tr")];
          expect(bodyRows).toHaveLength(entry.rows.length);
          bodyRows.forEach((tr, rowIndex) => {
            const cellTexts = [...tr.querySelectorAll("td")].map((td) => td.textContent);
            const expectedRow = entry.rows[rowIndex]!;
            expect(cellTexts).toEqual(columns.map((column) => cellText(expectedRow[column])));
          });
        });
      });
    });
  });

  // QA finding: naming this "narrow viewport (375px)" overclaimed what jsdom
  // can actually verify -- it has no CSS Grid/Flexbox layout engine, so a
  // 375px container width never resolves to a real narrow layout here (the
  // genuine narrow-viewport regression check, with real pixel boxes, is
  // e2e/golden-narrow-viewport.spec.ts, a real browser). What this DOES
  // verify: mount() doesn't throw or produce error tiles at a narrow
  // container setting, and every chart still mounts its expected DOM shape.
  it("mounts at a narrow container width without error, every chart still has SVG/DOM content plus fallback (jsdom structural check only, see e2e/golden-narrow-viewport.spec.ts for real pixel boxes)", () => {
    withMountedContainer(lightBakedModel, 375, (container) => {
      expect(container.querySelectorAll(".hyakkei-error-tile")).toHaveLength(0);
      expect(container.querySelectorAll(".hyakkei-accessible-fallback table")).toHaveLength(
        lightDoc.layout.items.length,
      );
      // jsdom has no CSS Grid/Flexbox layout engine, so a real pixel-box
      // assertion here (svg width/height) would only ever measure jsdom's
      // stub, not the collapsed-box class of bug `mount.ts`'s
      // gridAutoRows/resize() fix addresses -- that needs a real browser
      // (Playwright e2e). What jsdom CAN confirm: every ECharts-backed
      // chart in this dashboard actually mounted an <svg>, not silently
      // nothing.
      expect(container.querySelectorAll(".hyakkei-chart-canvas svg")).toHaveLength(
        echartsChartIds(lightDoc).length,
      );
    });
  });
});
