import type { Chart, LayoutItem } from "@hyakkei/schema";
import { validateDashboardReferences } from "@hyakkei/schema";
import { describe, expect, it } from "vitest";
import { reorderLayout } from "./layout-reorder.js";

const GRID_WIDTH = 12;

/** Same oracle pattern as layout-placement.test.ts (V-001, plan §QA Shift-left結果). */
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

function chartIds(items: LayoutItem[]): string[] {
  return items.map((item) => item.chart).sort();
}

const THREE: LayoutItem[] = [
  { chart: "c0", x: 0, y: 0, w: 4, h: 2 },
  { chart: "c1", x: 4, y: 0, w: 4, h: 2 },
  { chart: "c2", x: 8, y: 0, w: 4, h: 2 },
];

describe("reorderLayout", () => {
  it("moves the item at fromIndex to toIndex and re-packs (V-001 oracle)", () => {
    const result = reorderLayout(THREE, 0, 2, GRID_WIDTH);
    expect(result.map((i) => i.chart)).toEqual(["c1", "c2", "c0"]);
    expect(overlapOrOutOfBoundsIssues(result)).toEqual([]);
  });

  it("preserves the input's chart-id multiset and count (V-002 permutation)", () => {
    const result = reorderLayout(THREE, 0, 2, GRID_WIDTH);
    expect(chartIds(result)).toEqual(chartIds(THREE));
    expect(result).toHaveLength(THREE.length);
  });

  // V-003
  it("returns the SAME array reference when fromIndex === toIndex (no-op)", () => {
    expect(reorderLayout(THREE, 1, 1, GRID_WIDTH)).toBe(THREE);
  });

  // V-005 boundary indices
  it("moving the first item to the last position packs it at the end", () => {
    const result = reorderLayout(THREE, 0, THREE.length - 1, GRID_WIDTH);
    expect(result.map((i) => i.chart)).toEqual(["c1", "c2", "c0"]);
  });

  it("toIndex === items.length (one past the end) clamps to the same 'last position' as items.length - 1", () => {
    const byLastIndex = reorderLayout(THREE, 0, THREE.length - 1, GRID_WIDTH);
    const byLength = reorderLayout(THREE, 0, THREE.length, GRID_WIDTH);
    expect(byLength.map((i) => i.chart)).toEqual(byLastIndex.map((i) => i.chart));
  });

  it("moving the last item to toIndex=0 clamped from a negative value packs it first", () => {
    const result = reorderLayout(THREE, THREE.length - 1, -5, GRID_WIDTH);
    expect(result.map((i) => i.chart)).toEqual(["c2", "c0", "c1"]);
  });

  it("is a no-op (same reference) when the last item is 'moved' past the end (clamps to its own slot)", () => {
    expect(reorderLayout(THREE, THREE.length - 1, THREE.length + 5, GRID_WIDTH)).toBe(THREE);
  });

  it("fromIndex out of range (negative) is a no-op", () => {
    expect(reorderLayout(THREE, -1, 1, GRID_WIDTH)).toBe(THREE);
  });

  it("fromIndex out of range (>= length) is a no-op", () => {
    expect(reorderLayout(THREE, THREE.length, 1, GRID_WIDTH)).toBe(THREE);
  });

  it("non-integer fromIndex is a no-op", () => {
    expect(reorderLayout(THREE, 1.5, 0, GRID_WIDTH)).toBe(THREE);
  });

  it("non-integer toIndex is a no-op", () => {
    expect(reorderLayout(THREE, 0, Number.NaN, GRID_WIDTH)).toBe(THREE);
  });

  // V-006
  it("empty items array returns the same (empty) reference", () => {
    const empty: LayoutItem[] = [];
    expect(reorderLayout(empty, 0, 1, GRID_WIDTH)).toBe(empty);
  });

  it("a single item is always a no-op regardless of toIndex", () => {
    const single: LayoutItem[] = [{ chart: "c0", x: 0, y: 0, w: 4, h: 2 }];
    expect(reorderLayout(single, 0, -1, GRID_WIDTH)).toBe(single);
    expect(reorderLayout(single, 0, 5, GRID_WIDTH)).toBe(single);
  });
});
