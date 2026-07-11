// @vitest-environment jsdom
// V-105 (missing encoding column) / V-106 (empty rows) / V-109 (unresolved
// layout reference, unconfigured chart, no layout items): mount() must never
// leave a blank grid slot (plan §非機能要件 可用性 "白画面にしない").
import type { Dashboard } from "@hyakkei/schema";
import * as echarts from "echarts";
import { describe, expect, it } from "vitest";
import { mount } from "./mount.js";
import { normalizeAuthoring, normalizeBaked } from "./render-model.js";
import type { RenderModel } from "./render-model.js";

function container(): HTMLElement {
  return document.createElement("div");
}

const theme = {
  tokens: "@digital-go-jp/design-tokens@2.0.1" as const,
  palette: "guidebook-blue" as const,
};

describe("mount()", () => {
  it("renders a bar chart as an ECharts canvas plus an accessible data-table fallback", () => {
    const model: RenderModel = normalizeBaked({
      version: 1,
      meta: { title: "t", generatedAt: "x", sourceDataAsOf: "x", hyakkeiVersion: "0.1.0" },
      theme,
      charts: [
        {
          id: "c1",
          type: "bar",
          encoding: { x: "cat", y: "val" },
          options: {},
          rows: [{ cat: "A", val: 1 }],
        },
      ],
      layout: { grid: "guidebook-12col", items: [{ chart: "c1", x: 0, y: 0, w: 6, h: 4 }] },
    });

    const el = container();
    mount(el, model);

    expect(el.querySelector(".hyakkei-chart-canvas")).not.toBeNull();
    expect(el.querySelector(".hyakkei-accessible-fallback table")).not.toBeNull();
    expect(el.querySelector(".hyakkei-error-tile")).toBeNull();
  });

  it("V-105: shows an error tile when an encoding column is absent from every row", () => {
    const model: RenderModel = normalizeBaked({
      version: 1,
      meta: { title: "t", generatedAt: "x", sourceDataAsOf: "x", hyakkeiVersion: "0.1.0" },
      theme,
      charts: [
        {
          id: "c1",
          type: "bar",
          encoding: { x: "cat", y: "val" },
          options: {},
          rows: [{ wrong_column: "A", val: 1 }],
        },
      ],
      layout: { grid: "guidebook-12col", items: [{ chart: "c1", x: 0, y: 0, w: 6, h: 4 }] },
    });

    const el = container();
    mount(el, model);

    const tile = el.querySelector(".hyakkei-error-tile");
    expect(tile).not.toBeNull();
    expect(tile?.textContent).toContain("cat");
  });

  it("Codex adversarial review: a column present in SOME rows but not others renders normally, not an error (mutation-resistance: distinguishes .some() from .every())", () => {
    // missingColumns() flags a column only when NO row has it at all
    // (`!rows.some(...)`); a mutated `!rows.every(...)` would also flag
    // this case (one of two rows lacks `cat`) even though the correct
    // behavior is "render, with a blank cell for the row missing it" --
    // the V-105 test above (all rows lack the column) can't tell `.some()`
    // and `.every()` apart, since both agree when the column is absent
    // from literally every row.
    const model: RenderModel = normalizeBaked({
      version: 1,
      meta: { title: "t", generatedAt: "x", sourceDataAsOf: "x", hyakkeiVersion: "0.1.0" },
      theme,
      charts: [
        {
          id: "c1",
          type: "bar",
          encoding: { x: "cat", y: "val" },
          options: {},
          rows: [
            { cat: "A", val: 1 },
            { val: 2 }, // missing "cat" on this row only
          ],
        },
      ],
      layout: { grid: "guidebook-12col", items: [{ chart: "c1", x: 0, y: 0, w: 6, h: 4 }] },
    });

    const el = container();
    mount(el, model);

    expect(el.querySelector(".hyakkei-error-tile")).toBeNull();
    expect(el.querySelector(".hyakkei-chart-canvas")).not.toBeNull();
  });

  it("Codex adversarial review: remounting into the same container disposes the previous ECharts instance", () => {
    const chartModel = (id: string): RenderModel =>
      normalizeBaked({
        version: 1,
        meta: { title: "t", generatedAt: "x", sourceDataAsOf: "x", hyakkeiVersion: "0.1.0" },
        theme,
        charts: [
          {
            id,
            type: "bar",
            encoding: { x: "cat", y: "val" },
            options: {},
            rows: [{ cat: "A", val: 1 }],
          },
        ],
        layout: { grid: "guidebook-12col", items: [{ chart: id, x: 0, y: 0, w: 6, h: 4 }] },
      });

    const el = container();
    mount(el, chartModel("c1"));
    const firstCanvas = el.querySelector(".hyakkei-chart-canvas") as HTMLElement;
    const firstInstance = echarts.getInstanceByDom(firstCanvas);
    // ECharts' own `isDisposed()` returns its internal `_disposed` field
    // directly, which is `undefined` (not `false`) until `dispose()` first
    // sets it to `true` -- `.toBeFalsy()`, not `.toBe(false)`, for the
    // pre-dispose check (verified empirically against 6.1.0's source).
    expect(firstInstance?.isDisposed()).toBeFalsy();

    mount(el, chartModel("c2"));

    expect(firstInstance?.isDisposed()).toBe(true);
  });

  it("V-106: shows an info tile (not an error) for empty rows", () => {
    const model: RenderModel = normalizeBaked({
      version: 1,
      meta: { title: "t", generatedAt: "x", sourceDataAsOf: "x", hyakkeiVersion: "0.1.0" },
      theme,
      charts: [{ id: "c1", type: "bar", encoding: { x: "cat", y: "val" }, options: {}, rows: [] }],
      layout: { grid: "guidebook-12col", items: [{ chart: "c1", x: 0, y: 0, w: 6, h: 4 }] },
    });

    const el = container();
    mount(el, model);

    expect(el.querySelector(".hyakkei-error-tile")).toBeNull();
    const tile = el.querySelector(".hyakkei-info-tile");
    expect(tile).not.toBeNull();
    expect(tile?.textContent).toBe("データがありません");
    // Codex R1 P2: a configured-but-empty chart still has real column
    // semantics -- the accessible fallback (header row, zero body rows)
    // should still appear, unlike "unconfigured" (nothing wired yet).
    const fallbackTable = el.querySelector(".hyakkei-accessible-fallback table");
    expect(fallbackTable).not.toBeNull();
    expect(fallbackTable?.querySelectorAll("tbody tr").length).toBe(0);
  });

  it("Codex R1 P1 (rejected as already-decided design, test added for coverage): a chart with no matching layout item is simply not rendered, not an error", () => {
    // Phase 2 shape enumeration (shapes.md) found charts[] and layout.items[]
    // are not 1:1 in either direction, and the recorded design decision was
    // that an unplaced chart is a valid "not yet placed" state, not
    // something requiring an auto-placed fallback slot -- this test pins
    // that intentional behavior so a future change to it is a deliberate
    // decision, not an accidental regression.
    const model: RenderModel = normalizeBaked({
      version: 1,
      meta: { title: "t", generatedAt: "x", sourceDataAsOf: "x", hyakkeiVersion: "0.1.0" },
      theme,
      charts: [
        {
          id: "c1",
          type: "bar",
          encoding: { x: "cat", y: "val" },
          options: {},
          rows: [{ cat: "A", val: 1 }],
        },
        { id: "unplaced", type: "stat", encoding: { value: "v" }, options: {}, rows: [{ v: 1 }] },
      ],
      layout: { grid: "guidebook-12col", items: [{ chart: "c1", x: 0, y: 0, w: 6, h: 4 }] },
    });

    const el = container();
    mount(el, model);

    expect(el.querySelectorAll(".hyakkei-tile").length).toBe(1);
    expect(el.querySelector(".hyakkei-error-tile")).toBeNull();
    expect(el.textContent).not.toContain("unplaced");
  });

  it("shows an info tile, not a blank slot, for a query-未設定 (unconfigured) authoring chart", () => {
    const doc: Dashboard = {
      version: 1,
      meta: { title: "t" },
      theme,
      sources: [],
      queries: [],
      charts: [{ id: "c1", type: "bar", encoding: { x: "cat", y: "val" }, options: {} }],
      layout: { grid: "guidebook-12col", items: [{ chart: "c1", x: 0, y: 0, w: 6, h: 4 }] },
    };
    const model = normalizeAuthoring(doc, {});

    const el = container();
    mount(el, model);

    expect(el.querySelector(".hyakkei-error-tile")).toBeNull();
    expect(el.querySelector(".hyakkei-info-tile")?.textContent).toBe(
      "このチャートはまだデータに接続されていません",
    );
  });

  it("V-109: shows an error tile for a layout item referencing a nonexistent chart", () => {
    const model: RenderModel = normalizeBaked({
      version: 1,
      meta: { title: "t", generatedAt: "x", sourceDataAsOf: "x", hyakkeiVersion: "0.1.0" },
      theme,
      charts: [],
      layout: { grid: "guidebook-12col", items: [{ chart: "ghost", x: 0, y: 0, w: 6, h: 4 }] },
    });

    const el = container();
    mount(el, model);

    const tile = el.querySelector(".hyakkei-error-tile");
    expect(tile).not.toBeNull();
    expect(tile?.textContent).toContain("ghost");
  });

  it("shows an info tile when layout has no items at all", () => {
    const model: RenderModel = normalizeBaked({
      version: 1,
      meta: { title: "t", generatedAt: "x", sourceDataAsOf: "x", hyakkeiVersion: "0.1.0" },
      theme,
      charts: [],
      layout: { grid: "guidebook-12col", items: [] },
    });

    const el = container();
    mount(el, model);

    expect(el.querySelector(".hyakkei-info-tile")?.textContent).toBe(
      "配置されたチャートがありません",
    );
  });

  it("positions a layout item on the CSS grid using its x/y/w/h", () => {
    const model: RenderModel = normalizeBaked({
      version: 1,
      meta: { title: "t", generatedAt: "x", sourceDataAsOf: "x", hyakkeiVersion: "0.1.0" },
      theme,
      charts: [{ id: "c1", type: "stat", encoding: { value: "v" }, options: {}, rows: [{ v: 1 }] }],
      layout: { grid: "guidebook-12col", items: [{ chart: "c1", x: 2, y: 1, w: 3, h: 2 }] },
    });

    const el = container();
    mount(el, model);

    expect(el.style.gridTemplateColumns).toBe("repeat(12, 1fr)");
    const tile = el.querySelector(".hyakkei-tile") as HTMLElement;
    expect(tile.style.gridColumn).toBe("3 / span 3");
    expect(tile.style.gridRow).toBe("2 / span 2");
  });

  it("renders `table`/`stat` as plain DOM, not an ECharts canvas", () => {
    const model: RenderModel = normalizeBaked({
      version: 1,
      meta: { title: "t", generatedAt: "x", sourceDataAsOf: "x", hyakkeiVersion: "0.1.0" },
      theme,
      charts: [
        { id: "c1", type: "table", encoding: { columns: ["a"] }, options: {}, rows: [{ a: 1 }] },
        { id: "c2", type: "stat", encoding: { value: "v" }, options: {}, rows: [{ v: 42 }] },
      ],
      layout: {
        grid: "guidebook-12col",
        items: [
          { chart: "c1", x: 0, y: 0, w: 6, h: 4 },
          { chart: "c2", x: 6, y: 0, w: 6, h: 4 },
        ],
      },
    });

    const el = container();
    mount(el, model);

    expect(el.querySelectorAll(".hyakkei-chart-canvas").length).toBe(0);
    expect(el.querySelector(".hyakkei-table")).not.toBeNull();
    expect(el.querySelector(".hyakkei-stat-value")?.textContent).toBe("42");
  });
});
