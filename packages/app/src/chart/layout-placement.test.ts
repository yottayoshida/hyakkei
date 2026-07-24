import type { Chart, LayoutItem } from "@hyakkei/schema";
import { validateDashboardReferences } from "@hyakkei/schema";
import { describe, expect, it } from "vitest";
import { CHART_DEFAULT_SIZE, nextFreeCell, packItems } from "./layout-placement.js";

const GRID_WIDTH = 12;

function placeAll(types: Array<keyof typeof CHART_DEFAULT_SIZE>): LayoutItem[] {
  const items: LayoutItem[] = [];
  types.forEach((type, index) => {
    const { w, h } = CHART_DEFAULT_SIZE[type];
    const { x, y } = nextFreeCell(items, w, h, GRID_WIDTH);
    items.push({ chart: `c${index}`, x, y, w, h });
  });
  return items;
}

/** V-005 oracle test (plan §QA Shift-left結果): validated via the schema's own public referential validator, not a re-implemented check. */
function overlapOrOutOfBoundsIssues(items: LayoutItem[]) {
  const charts: Chart[] = items.map((item) => ({
    id: item.chart,
    type: "stat",
    encoding: { value: "v" },
    options: {},
  }));
  const issues = validateDashboardReferences({
    version: 1,
    meta: { title: "t" },
    theme: { tokens: "@digital-go-jp/design-tokens@2.0.1", palette: "guidebook-blue" },
    sources: [],
    queries: [],
    charts,
    layout: { grid: "guidebook-12col", items },
  });
  return issues.filter((i) => i.kind === "overlap" || i.kind === "out-of-bounds");
}

describe("nextFreeCell", () => {
  it("places a single chart at the origin", () => {
    expect(nextFreeCell([], 6, 6, GRID_WIDTH)).toEqual({ x: 0, y: 0 });
  });

  it("places a second same-row chart beside the first when it fits", () => {
    const items: LayoutItem[] = [{ chart: "c0", x: 0, y: 0, w: 6, h: 6 }];
    expect(nextFreeCell(items, 6, 6, GRID_WIDTH)).toEqual({ x: 6, y: 0 });
  });

  it("wraps to the next row once the current row has no remaining space", () => {
    const items: LayoutItem[] = [
      { chart: "c0", x: 0, y: 0, w: 6, h: 6 },
      { chart: "c1", x: 6, y: 0, w: 6, h: 6 },
    ];
    expect(nextFreeCell(items, 6, 6, GRID_WIDTH)).toEqual({ x: 0, y: 6 });
  });

  it("is deterministic: the same chart set always produces the same layout", () => {
    const types: Array<keyof typeof CHART_DEFAULT_SIZE> = [
      "bar",
      "pie",
      "table",
      "stat",
      "scatter",
      "line",
      "area",
    ];
    expect(placeAll(types)).toEqual(placeAll(types));
  });

  it("clamps w to gridWidth defensively (never loops forever on an over-wide box)", () => {
    expect(nextFreeCell([], GRID_WIDTH + 4, 2, GRID_WIDTH)).toEqual({ x: 0, y: 0 });
  });

  it("produces no overlap/out-of-bounds issues for all 7 chart types placed in sequence (V-005 oracle)", () => {
    const items = placeAll(["bar", "line", "area", "scatter", "pie", "table", "stat"]);
    expect(overlapOrOutOfBoundsIssues(items)).toEqual([]);
  });

  it("produces no overlap/out-of-bounds issues for many charts of the same wide type (table, 12-wide)", () => {
    const items = placeAll(["table", "table", "table", "table"]);
    expect(overlapOrOutOfBoundsIssues(items)).toEqual([]);
  });

  it("produces no overlap/out-of-bounds issues for many small stat tiles packing a row", () => {
    const items = placeAll(Array(6).fill("stat"));
    expect(overlapOrOutOfBoundsIssues(items)).toEqual([]);
  });

  // issue #14 (Security review): a non-finite/sub-1 clampedW would otherwise
  // make the inner loop's `x + clampedW <= gridWidth` permanently false and
  // spin `y` forever -- these pin the fail-fast guard instead.
  it("throws on a non-finite w (NaN)", () => {
    expect(() => nextFreeCell([], Number.NaN, 2, GRID_WIDTH)).toThrow(RangeError);
  });

  it("throws on a non-finite gridWidth (Infinity), even though w alone clamps to a finite value", () => {
    // `Math.min(w, gridWidth)` clamps an infinite `w` down to a finite
    // `gridWidth` (safe) -- but an infinite `gridWidth` itself passes
    // through unclamped when `w` is also infinite, which is the actual
    // non-finite-clampedW case worth guarding.
    expect(() => nextFreeCell([], Number.POSITIVE_INFINITY, 2, Number.POSITIVE_INFINITY)).toThrow(
      RangeError,
    );
  });

  it("throws on a sub-1 w (0)", () => {
    expect(() => nextFreeCell([], 0, 2, GRID_WIDTH)).toThrow(RangeError);
  });

  it("throws on a sub-1 w (negative)", () => {
    expect(() => nextFreeCell([], -3, 2, GRID_WIDTH)).toThrow(RangeError);
  });

  it("throws on a non-finite gridWidth (NaN produces a non-finite clampedW too)", () => {
    expect(() => nextFreeCell([], 6, 2, Number.NaN)).toThrow(RangeError);
  });

  // Codex 6-B (test adversarial review, mutation resistance finding): none
  // of the above cases actually exercise the `< 1` boundary itself -- a
  // mutation to `<= 1` would reject the smallest VALID width (1) while
  // still passing every other test here. Pins that w=1 succeeds.
  it("does not throw on the smallest valid width (w=1)", () => {
    expect(nextFreeCell([], 1, 2, GRID_WIDTH)).toEqual({ x: 0, y: 0 });
  });
});

describe("packItems", () => {
  it("returns an empty array for empty input", () => {
    expect(packItems([], GRID_WIDTH)).toEqual([]);
  });

  it("re-derives x/y from the given order, ignoring each item's previous position", () => {
    // Deliberately out-of-order/overlapping input (as a hand-edited
    // dashboard.json's `layout.items` could be, issue #14 shape notes) --
    // packItems must still produce a valid, overlap-free layout matching
    // nextFreeCell's own first-fit shelf packing for this exact order.
    const input: LayoutItem[] = [
      { chart: "c0", x: 5, y: 5, w: 6, h: 6 },
      { chart: "c1", x: 5, y: 5, w: 6, h: 6 }, // overlaps c0 in the input
    ];
    expect(packItems(input, GRID_WIDTH)).toEqual([
      { chart: "c0", x: 0, y: 0, w: 6, h: 6 },
      { chart: "c1", x: 6, y: 0, w: 6, h: 6 },
    ]);
  });

  it("preserves each item's chart id, w, and h -- only x/y are recomputed", () => {
    const input: LayoutItem[] = [{ chart: "c0", x: 99, y: 99, w: 4, h: 3 }];
    const [packed] = packItems(input, GRID_WIDTH);
    expect(packed).toMatchObject({ chart: "c0", w: 4, h: 3 });
  });

  it("produces no overlap/out-of-bounds issues (oracle) for a mixed-size set", () => {
    const input: LayoutItem[] = [
      { chart: "c0", x: 0, y: 0, w: 12, h: 6 },
      { chart: "c1", x: 0, y: 0, w: 3, h: 2 },
      { chart: "c2", x: 0, y: 0, w: 6, h: 6 },
    ];
    expect(overlapOrOutOfBoundsIssues(packItems(input, GRID_WIDTH))).toEqual([]);
  });
});
