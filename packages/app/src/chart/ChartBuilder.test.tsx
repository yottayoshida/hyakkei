/** @vitest-environment jsdom */
import type { Chart } from "@hyakkei/schema";
import { act, type ReactElement } from "react";
import { createRoot } from "react-dom/client";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { WorkspaceQuery } from "../intake/types.js";

const { mountSpy, unmountSpy } = vi.hoisted(() => ({
  mountSpy: vi.fn(),
  unmountSpy: vi.fn(),
}));
vi.mock("@hyakkei/core/renderer", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@hyakkei/core/renderer")>();
  return { ...actual, mount: mountSpy, unmount: unmountSpy };
});

import { ChartBuilder, type ChartBuilderProps } from "./ChartBuilder.js";
import { CHART_ROW_LIMIT } from "./chart-encoding.js";

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  mountSpy.mockClear();
  unmountSpy.mockClear();
});

async function renderInJsdom(node: ReactElement) {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  await act(async () => {
    root.render(node);
  });
  return {
    host,
    rerender: async (next: ReactElement) => {
      await act(async () => {
        root.render(next);
      });
    },
  };
}

function query(overrides: Partial<WorkspaceQuery> = {}): WorkspaceQuery {
  return {
    id: "q1",
    sourceTableId: "t1",
    builderState: {
      filters: [],
      groupBy: ["category"],
      measures: [{ column: "amount", aggregate: "sum" }],
    },
    sql: "SELECT category, SUM(amount) AS sum_amount FROM t1 GROUP BY category",
    previewRows: [],
    previewColumns: ["category", "sum_amount"],
    diagnostics: null,
    previewPending: false,
    ...overrides,
  };
}

const BAR_CHART: Chart = {
  id: "c1",
  type: "bar",
  encoding: { x: "category", y: "sum_amount" },
  query: "q1",
  options: {},
};

function baseProps(overrides: Partial<ChartBuilderProps> = {}): ChartBuilderProps {
  return {
    chart: BAR_CHART,
    query: query(),
    sourceLabel: "売上.csv",
    rowState: { status: "ready", rows: [{ category: "A", sum_amount: 100 }], truncated: false },
    onChange: vi.fn(),
    onDelete: vi.fn(),
    ...overrides,
  };
}

describe("ChartBuilder", () => {
  it("renders the type-picker, x/y encoding selects for bar, and a friendly measure-alias label", async () => {
    const { host } = await renderInJsdom(<ChartBuilder {...baseProps()} />);
    expect(host.querySelectorAll('button[aria-pressed="true"]')).toHaveLength(1);
    expect(host.querySelector('button[aria-pressed="true"]')?.textContent).toBe("棒グラフ");
    const ySelect = host.querySelector('select[aria-label="縦軸"]') as HTMLSelectElement;
    expect(ySelect.value).toBe("sum_amount");
    expect(ySelect.textContent).toContain("合計(amount)");
  });

  it("switching to pie calls onChange with a fully rebuilt encoding (category/value, no leftover x/y)", async () => {
    const onChange = vi.fn();
    const { host } = await renderInJsdom(<ChartBuilder {...baseProps({ onChange })} />);
    const pieButton = [...host.querySelectorAll("button")].find(
      (b) => b.textContent === "円グラフ",
    )!;
    await act(async () => {
      pieButton.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(onChange).toHaveBeenCalledTimes(1);
    const [chartId, nextChart] = onChange.mock.calls[0]!;
    expect(chartId).toBe("c1");
    expect(nextChart.type).toBe("pie");
    expect(nextChart.encoding).toEqual({ category: "category", value: "sum_amount" });
    expect(Object.keys(nextChart.encoding).sort()).toEqual(["category", "value"]);
  });

  it("switching to donut sets type=pie AND options.donut=true", async () => {
    const onChange = vi.fn();
    const { host } = await renderInJsdom(<ChartBuilder {...baseProps({ onChange })} />);
    const donutButton = [...host.querySelectorAll("button")].find(
      (b) => b.textContent === "ドーナツグラフ",
    )!;
    await act(async () => {
      donutButton.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    const [, nextChart] = onChange.mock.calls[0]!;
    expect(nextChart.type).toBe("pie");
    expect(nextChart.options.donut).toBe(true);
  });

  it("switching away from pie clears a previously-set donut option", async () => {
    const pieChart: Chart = {
      id: "c1",
      type: "pie",
      encoding: { category: "category", value: "sum_amount" },
      query: "q1",
      options: { donut: true, title: "円グラフ" },
    };
    const onChange = vi.fn();
    const { host } = await renderInJsdom(
      <ChartBuilder {...baseProps({ chart: pieChart, onChange })} />,
    );
    const barButton = [...host.querySelectorAll("button")].find(
      (b) => b.textContent === "棒グラフ",
    )!;
    await act(async () => {
      barButton.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    const [, nextChart] = onChange.mock.calls[0]!;
    expect(nextChart.options.donut).toBeUndefined();
    expect(nextChart.options.title).toBe("円グラフ"); // non-type-dependent options survive
  });

  it("changing an encoding select within the SAME type does a partial update, not a full rebuild", async () => {
    const onChange = vi.fn();
    const { host } = await renderInJsdom(<ChartBuilder {...baseProps({ onChange })} />);
    const xSelect = host.querySelector('select[aria-label="横軸"]') as HTMLSelectElement;
    await act(async () => {
      xSelect.value = "sum_amount";
      xSelect.dispatchEvent(new Event("change", { bubbles: true }));
    });
    const [, nextChart] = onChange.mock.calls[0]!;
    expect(nextChart.encoding).toEqual({ x: "sum_amount", y: "sum_amount" });
  });

  it("table type renders a checkbox per previewColumns entry for the columns[] encoding", async () => {
    const tableChart: Chart = {
      id: "c1",
      type: "table",
      encoding: { columns: ["category"] },
      query: "q1",
      options: {},
    };
    const { host } = await renderInJsdom(<ChartBuilder {...baseProps({ chart: tableChart })} />);
    const checkboxes = host.querySelectorAll('input[type="checkbox"]');
    // 2 preview columns + no donut/showDataLabels checkbox for table
    expect(checkboxes).toHaveLength(2);
    expect((checkboxes[0] as HTMLInputElement).checked).toBe(true);
  });

  it("donut checkbox only renders for type=pie", async () => {
    const { host } = await renderInJsdom(<ChartBuilder {...baseProps()} />);
    expect(host.textContent).not.toContain("ドーナツ表示にする");
    const pieChart: Chart = {
      ...BAR_CHART,
      type: "pie",
      encoding: { category: "category", value: "sum_amount" },
    };
    const { host: pieHost } = await renderInJsdom(
      <ChartBuilder {...baseProps({ chart: pieChart })} />,
    );
    expect(pieHost.textContent).toContain("ドーナツ表示にする");
  });

  it("calls onDelete with the chart id", async () => {
    const onDelete = vi.fn();
    const { host } = await renderInJsdom(<ChartBuilder {...baseProps({ onDelete })} />);
    const deleteButton = host.querySelector(
      "[aria-label='「売上.csv」のグラフを削除']",
    ) as HTMLButtonElement;
    await act(async () => {
      deleteButton.click();
    });
    expect(onDelete).toHaveBeenCalledWith("c1");
  });

  // UX review (Phase 8, Major finding D-3): title used to commit on every
  // keystroke, which (via the DashboardErrorBoundary key + ChartPreview's own
  // `chart`-keyed effect) rebuilt the ECharts instance once per character.
  it("does not commit a title edit until blur (no per-keystroke onChange/remount)", async () => {
    const onChange = vi.fn();
    const { host } = await renderInJsdom(
      <ChartBuilder
        {...baseProps({ rowState: { status: "ready", rows: [], truncated: false }, onChange })}
      />,
    );
    expect(mountSpy).toHaveBeenCalledTimes(1);
    const titleInput = host.querySelector(
      'input[aria-label="グラフのタイトル"]',
    ) as HTMLInputElement;
    // React patches the `<input>` instance's own `value` setter to track
    // "last known value" and suppress a synthetic onChange when nothing
    // actually changed from its perspective -- assigning `.value` directly
    // goes through THAT patched setter, so React never sees a difference.
    // The native prototype setter bypasses it, matching how a real keystroke
    // changes the underlying DOM value before React's tracker inspects it.
    const nativeValueSetter = Object.getOwnPropertyDescriptor(
      window.HTMLInputElement.prototype,
      "value",
    )!.set!;

    await act(async () => {
      nativeValueSetter.call(titleInput, "A");
      titleInput.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(onChange).not.toHaveBeenCalled();
    expect(mountSpy).toHaveBeenCalledTimes(1); // still just the initial mount

    await act(async () => {
      // React's onBlur listens for the native "focusout" event (bubbling),
      // not "blur" (which does not bubble and isn't what React delegates).
      titleInput.dispatchEvent(new FocusEvent("focusout", { bubbles: true }));
    });
    expect(onChange).toHaveBeenCalledWith(
      "c1",
      expect.objectContaining({ options: { title: "A" } }),
    );
  });

  // QA Phase 8, V-008 (Major): the truncation advisory itself didn't exist.
  // `isTruncated`'s own boundary is unit-tested in chart-encoding.test.ts;
  // this pins the UI wiring -- the flag actually reaching a visible message.
  it("shows a non-blocking truncation advisory when rowState.truncated is true, and none when false", async () => {
    const { host: truncatedHost } = await renderInJsdom(
      <ChartBuilder {...baseProps({ rowState: { status: "ready", rows: [], truncated: true } })} />,
    );
    const advisory = truncatedHost.querySelector('[role="status"]');
    expect(advisory?.textContent).toBe(
      `データが多いため、先頭${CHART_ROW_LIMIT.toLocaleString("ja-JP")}件のみ表示しています。`,
    );

    const { host: fullHost } = await renderInJsdom(
      <ChartBuilder
        {...baseProps({ rowState: { status: "ready", rows: [], truncated: false } })}
      />,
    );
    expect(fullHost.textContent).not.toContain("先頭");
  });

  it("passes rowState through to ChartPreview: pending shows 計算中… and never calls mount()", async () => {
    const { host } = await renderInJsdom(
      <ChartBuilder {...baseProps({ rowState: { status: "pending" } })} />,
    );
    expect(host.textContent).toContain("計算中…");
    expect(mountSpy).not.toHaveBeenCalled();
  });

  it("shows a non-blocking type-mismatch warning when the y column is all non-numeric, but still renders the preview", async () => {
    const { host } = await renderInJsdom(
      <ChartBuilder
        {...baseProps({
          rowState: {
            status: "ready",
            rows: [{ category: "A", sum_amount: "not a number" }],
            truncated: false,
          },
        })}
      />,
    );
    // `role="status"` (polite), not `"alert"` (UX review Phase 8 Minor,
    // finding C-5): a non-blocking advisory should not interrupt the screen
    // reader the way an assertive alert region does.
    const advisory = host.querySelector('[role="status"]');
    expect(advisory?.textContent).toBe("「縦軸」に選択した列は数値として認識できませんでした。");
    expect(mountSpy).toHaveBeenCalledTimes(1); // still rendered, warning is advisory only
  });

  it("shows no warning when the y column has at least one real numeric value", async () => {
    const { host } = await renderInJsdom(<ChartBuilder {...baseProps()} />);
    expect(host.querySelector('[role="alert"]')).toBeNull();
  });

  // Codex Round 1 P1: an existing chart card must not let the user build a
  // schema-invalid Chart once its query's previewColumns clears to [] (a
  // query error, most commonly) -- type/encoding edits are disabled, not
  // silently produce `undefined` encoding values.
  describe("no usable columns (e.g. after a query error)", () => {
    function propsWithNoColumns(overrides: Partial<ChartBuilderProps> = {}) {
      return baseProps({ query: query({ previewColumns: [] }), ...overrides });
    }

    it("disables every type tile", async () => {
      const { host } = await renderInJsdom(<ChartBuilder {...propsWithNoColumns()} />);
      for (const button of host.querySelectorAll("button[aria-pressed]")) {
        expect((button as HTMLButtonElement).disabled).toBe(true);
      }
    });

    it("clicking a type tile does not call onChange (never reaches reconcileEncoding with empty columns)", async () => {
      const onChange = vi.fn();
      const { host } = await renderInJsdom(<ChartBuilder {...propsWithNoColumns({ onChange })} />);
      const pieButton = [...host.querySelectorAll("button")].find(
        (b) => b.textContent === "円グラフ",
      )!;
      await act(async () => {
        pieButton.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      });
      expect(onChange).not.toHaveBeenCalled();
    });

    it("disables the encoding <select>s and shows an explanatory message", async () => {
      const { host } = await renderInJsdom(<ChartBuilder {...propsWithNoColumns()} />);
      expect((host.querySelector('select[aria-label="縦軸"]') as HTMLSelectElement).disabled).toBe(
        true,
      );
      expect(host.textContent).toContain("列情報を取得できません");
    });
  });

  describe("table type: last-remaining column checkbox", () => {
    it("disables (does not allow unchecking) the only checked column", async () => {
      const tableChart: Chart = {
        id: "c1",
        type: "table",
        encoding: { columns: ["category"] },
        query: "q1",
        options: {},
      };
      const { host } = await renderInJsdom(<ChartBuilder {...baseProps({ chart: tableChart })} />);
      const checkboxes = [...host.querySelectorAll('input[type="checkbox"]')] as HTMLInputElement[];
      const checkedOne = checkboxes.find((c) => c.checked)!;
      expect(checkedOne.disabled).toBe(true);
    });

    it("never commits an empty columns[] even if the disabled checkbox is force-unchecked", async () => {
      const onChange = vi.fn();
      const tableChart: Chart = {
        id: "c1",
        type: "table",
        encoding: { columns: ["category"] },
        query: "q1",
        options: {},
      };
      const { host } = await renderInJsdom(
        <ChartBuilder {...baseProps({ chart: tableChart, onChange })} />,
      );
      const checkboxes = [...host.querySelectorAll('input[type="checkbox"]')] as HTMLInputElement[];
      const checkedOne = checkboxes.find((c) => c.checked)!;
      await act(async () => {
        checkedOne.checked = false;
        checkedOne.dispatchEvent(new Event("change", { bubbles: true }));
      });
      expect(onChange).not.toHaveBeenCalled();
    });

    it("allows unchecking when more than one column is selected", async () => {
      const onChange = vi.fn();
      const tableChart: Chart = {
        id: "c1",
        type: "table",
        encoding: { columns: ["category", "sum_amount"] },
        query: "q1",
        options: {},
      };
      const { host } = await renderInJsdom(
        <ChartBuilder {...baseProps({ chart: tableChart, onChange })} />,
      );
      const checkboxes = [...host.querySelectorAll('input[type="checkbox"]')] as HTMLInputElement[];
      expect(checkboxes.every((c) => !c.disabled)).toBe(true);
      await act(async () => {
        checkboxes[0]!.click();
      });
      const [, nextChart] = onChange.mock.calls[0]!;
      expect(nextChart.encoding.columns).toEqual(["sum_amount"]);
    });
  });
});
