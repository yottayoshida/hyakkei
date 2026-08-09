import { describe, expect, it } from "vitest";
import { resizeLayout } from "./layout-resize.js";

const ITEMS = [
  { chart: "c1", x: 0, y: 0, w: 6, h: 4 },
  { chart: "c2", x: 6, y: 0, w: 6, h: 4 },
];

describe("resizeLayout", () => {
  it("changes the requested tile size and re-packs the layout", () => {
    const next = resizeLayout(ITEMS, "c1", 2, 1, 12);
    expect(next.find((item) => item.chart === "c1")).toMatchObject({ w: 8, h: 5 });
    expect(next.map((item) => item.chart)).toEqual(["c1", "c2"]);
    expect(next[1]).toMatchObject({ x: 0, y: 5 });
  });

  it("clamps at the grid boundary and never mutates the input", () => {
    const next = resizeLayout(ITEMS, "c1", 99, -99, 12);
    expect(next.find((item) => item.chart === "c1")).toMatchObject({ w: 12, h: 1 });
    expect(ITEMS[0]).toEqual({ chart: "c1", x: 0, y: 0, w: 6, h: 4 });
  });

  it("fails closed for an unknown chart or non-integer delta", () => {
    expect(resizeLayout(ITEMS, "missing", 1, 1, 12)).toBe(ITEMS);
    expect(resizeLayout(ITEMS, "c1", 0.5, 1, 12)).toBe(ITEMS);
  });
});
