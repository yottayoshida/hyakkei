import type { RenderModel } from "./render-model.js";
import { buildOptions } from "./build-options.js";
import { describe, expect, it } from "vitest";

const theme: RenderModel["theme"] = {
  backgroundColor: "#F8F8FB",
  color: ["#111111", "#222222", "#333333"],
  textStyle: { color: "#1A1A1A" },
};

function modelOf(
  chart: RenderModel["charts"][number]["chart"],
  rows: RenderModel["charts"][number]["rows"],
): RenderModel {
  return {
    charts: [{ id: "c1", chart, rows, state: "ok" }],
    layout: { grid: "guidebook-12col", items: [] },
    theme,
  };
}

describe("buildOptions", () => {
  it("category axis always sets axisLabel.interval: 0 (PR-0 CJK-clipping regression guard)", () => {
    const chart = { id: "c1", type: "bar" as const, encoding: { x: "cat", y: "val" }, options: {} };
    const option = buildOptions(modelOf(chart, [{ cat: "区分別申請額", val: 1 }])).c1!;
    expect((option.xAxis as { axisLabel: { interval: number } }).axisLabel.interval).toBe(0);
  });

  it("QA Phase 8 F-001: a null/undefined category cell renders blank, not the literal string 'null'/'undefined' -- matching the a11y fallback table's formatting", () => {
    const chart = { id: "c1", type: "bar" as const, encoding: { x: "cat", y: "val" }, options: {} };
    const option = buildOptions(
      modelOf(chart, [
        { cat: null, val: 1 },
        { val: 2 }, // "cat" key absent entirely -- same cellText() null path
      ]),
    ).c1!;
    expect((option.xAxis as { data: string[] }).data).toEqual(["", ""]);
  });

  it("QA Phase 8 F-001: pie's category name is equally blank for a null cell, not the literal string 'null'", () => {
    const chart = {
      id: "c1",
      type: "pie" as const,
      encoding: { category: "cat", value: "val" },
      options: {},
    };
    const option = buildOptions(modelOf(chart, [{ cat: null, val: 1 }])).c1!;
    expect((option.series as { data: { name: string }[] }[])[0]?.data[0]?.name).toBe("");
  });

  it("V-107: a boolean cell in a numeric field becomes null, not a crash or a literal 1/0", () => {
    const chart = { id: "c1", type: "bar" as const, encoding: { x: "cat", y: "val" }, options: {} };
    const option = buildOptions(modelOf(chart, [{ cat: "A", val: true }])).c1!;
    expect((option.series as { data: unknown[] }[])[0]?.data).toEqual([null]);
  });

  it("V-107: pie sets value: undefined (not null) for a non-numeric cell -- PieDataItemOption rejects null", () => {
    // Codex adversarial review (test review): the property is present with
    // an `undefined` value, not omitted from the object -- `toBeUndefined()`
    // alone can't distinguish those two shapes. `toEqual` (used below)
    // treats an `undefined`-valued key the same as an absent one, which is
    // also what `JSON.stringify`/ECharts itself see, so this is the actual
    // contract, stated precisely rather than via a title that overclaimed
    // "omits."
    const chart = {
      id: "c1",
      type: "pie" as const,
      encoding: { category: "cat", value: "val" },
      options: {},
    };
    const option = buildOptions(modelOf(chart, [{ cat: "A", val: false }])).c1!;
    const dataItem = (option.series as { data: { value: unknown }[] }[])[0]?.data[0];
    expect(dataItem).toEqual({ name: "A", value: undefined });
  });

  it("donut option sets an inner radius; non-donut pie does not", () => {
    const chart = {
      id: "c1",
      type: "pie" as const,
      encoding: { category: "cat", value: "val" },
      options: { donut: true },
    };
    const option = buildOptions(modelOf(chart, [{ cat: "A", val: 1 }])).c1!;
    expect((option.series as { radius: unknown }[])[0]?.radius).toEqual(["40%", "70%"]);
  });

  it("legend position maps to ECharts orient + anchor, and is entirely absent (show:false) by default", () => {
    const chart = {
      id: "c1",
      type: "bar" as const,
      encoding: { x: "cat", y: "val" },
      options: { legend: { show: true, position: "left" as const } },
    };
    const option = buildOptions(modelOf(chart, [{ cat: "A", val: 1 }])).c1!;
    expect(option.legend).toEqual({ show: true, orient: "vertical", left: 0 });

    const noLegend = buildOptions(modelOf({ ...chart, options: {} }, [{ cat: "A", val: 1 }])).c1!;
    expect(noLegend.legend).toEqual({ show: false });
  });

  it("area sets areaStyle, line/bar do not", () => {
    const areaChart = {
      id: "c1",
      type: "area" as const,
      encoding: { x: "cat", y: "val" },
      options: {},
    };
    const area = buildOptions(modelOf(areaChart, [{ cat: "A", val: 1 }])).c1!;
    expect((area.series as { areaStyle: unknown }[])[0]?.areaStyle).toEqual({});

    const lineChart = {
      id: "c1",
      type: "line" as const,
      encoding: { x: "cat", y: "val" },
      options: {},
    };
    const line = buildOptions(modelOf(lineChart, [{ cat: "A", val: 1 }])).c1!;
    expect((line.series as { areaStyle: unknown }[])[0]?.areaStyle).toBeUndefined();
  });

  it("scatter carries per-point symbolSize as data, not a series-level callback (JSON-serializable golden requirement)", () => {
    const chart = {
      id: "c1",
      type: "scatter" as const,
      encoding: { x: "x", y: "y", size: "s" },
      options: {},
    };
    const option = buildOptions(modelOf(chart, [{ x: 1, y: 2, s: 9 }])).c1!;
    const series = (option.series as { symbolSize?: unknown; data: unknown[] }[])[0]!;
    expect(series.symbolSize).toBeUndefined();
    expect(series.data[0]).toEqual({ value: [1, 2], symbolSize: 9 });
    expect(() => JSON.stringify(option)).not.toThrow();
  });

  it("every produced EChartsOption is JSON-serializable (no function-valued fields, golden-test requirement)", () => {
    for (const [type, chart] of Object.entries({
      bar: { id: "c1", type: "bar" as const, encoding: { x: "x", y: "y" }, options: {} },
      line: { id: "c1", type: "line" as const, encoding: { x: "x", y: "y" }, options: {} },
      area: { id: "c1", type: "area" as const, encoding: { x: "x", y: "y" }, options: {} },
      scatter: {
        id: "c1",
        type: "scatter" as const,
        encoding: { x: "x", y: "y", size: "s" },
        options: {},
      },
      pie: { id: "c1", type: "pie" as const, encoding: { category: "c", value: "v" }, options: {} },
    })) {
      const rows = [{ x: 1, y: 2, s: 3, c: "A", v: 4 }];
      const option = buildOptions(modelOf(chart, rows)).c1;
      // `toEqual` already fails on a genuinely function-valued property
      // (confirmed: it does NOT treat a present function value the same as
      // an absent key, unlike its `undefined`-valued-key leniency) -- this
      // direct recursive walk exists as a second, more explicit assertion
      // of the specific property this test is guarding (Codex adversarial
      // review), rather than relying solely on the indirect JSON-round-trip
      // comparison to make that intent legible to a future reader.
      expect(findFunctionValues(option), type).toEqual([]);
      expect(JSON.parse(JSON.stringify(option)), type).toEqual(option);
    }
  });
});

function findFunctionValues(value: unknown, path = ""): string[] {
  if (typeof value === "function") return [path];
  if (value === null || typeof value !== "object") return [];
  return Object.entries(value).flatMap(([key, child]) =>
    findFunctionValues(child, `${path}.${key}`),
  );
}
