/** @vitest-environment jsdom */
import type { Chart } from "@hyakkei/schema";
import { act, type ReactElement } from "react";
import { createRoot } from "react-dom/client";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ChartRowState, WorkspaceQuery } from "../intake/types.js";

const { mountSpy, unmountSpy, evaluateGuidelinesSpy } = vi.hoisted(() => ({
  mountSpy: vi.fn(),
  unmountSpy: vi.fn(),
  evaluateGuidelinesSpy: vi.fn(),
}));
vi.mock("@hyakkei/core/renderer", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@hyakkei/core/renderer")>();
  return { ...actual, mount: mountSpy, unmount: unmountSpy };
});
// Defaults to the REAL evaluateGuidelines (delegates to actual, same
// pattern as the renderer mock above) -- only the one XSS test below
// overrides it, to inject a hostile message/citation that production
// guideline-rules.json (a static, developer-authored TCB constant) never
// actually contains.
vi.mock("@hyakkei/core/guideline", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@hyakkei/core/guideline")>();
  evaluateGuidelinesSpy.mockImplementation(actual.evaluateGuidelines);
  return { ...actual, evaluateGuidelines: evaluateGuidelinesSpy };
});

// Resolves through the mock above, which spreads `...actual` -- so this is the
// rule set read from the BUILT guideline-rules.json (`@hyakkei/core`'s exports
// point at dist/, gitignored): running this file without a prior `pnpm run
// build` compares against whatever was built last, not current src. CI always
// builds first (root `test` = `build && -r test`).
import { getGuidelineRules } from "@hyakkei/core/guideline";
import { ChartBuilder, type ChartBuilderProps } from "./ChartBuilder.js";
import { CHART_ROW_LIMIT } from "./chart-encoding.js";

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  mountSpy.mockClear();
  unmountSpy.mockClear();
  evaluateGuidelinesSpy.mockClear();
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

  // issue #102: a lone-tile group's heading (比較/相関/一覧/単一の値) is
  // redundant clutter above a single button -- suppressed without touching
  // `CHART_TYPE_TILES.group` itself, so 推移/割合 (each 2 tiles) keep theirs.
  it("shows a group heading only for groups with 2+ tiles, and all 8 tiles still render exactly once", async () => {
    const { host } = await renderInJsdom(<ChartBuilder {...baseProps()} />);
    const headings = [...host.querySelectorAll("fieldset > div > p")].map((p) => p.textContent);
    expect(headings.sort()).toEqual(["割合", "推移"]);
    const tileButtons = host.querySelectorAll("fieldset button[aria-pressed]");
    expect(tileButtons).toHaveLength(8);
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

  // issue #102: `chartOrdinal` disambiguates this card's delete label from a
  // sibling chart card's on the SAME query -- omitted/`null` (the baseProps
  // default) keeps the label byte-identical to pre-#102 (asserted above).
  it("inserts an ordinal into the delete label when chartOrdinal is set (2+ siblings)", async () => {
    const { host } = await renderInJsdom(<ChartBuilder {...baseProps({ chartOrdinal: 2 })} />);
    expect(host.querySelector("[aria-label='「売上.csv」のグラフ2を削除']")).not.toBeNull();
    expect(host.querySelector("[aria-label='「売上.csv」のグラフを削除']")).toBeNull();
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

  // issue #13 (guideline nudge engine).
  describe("guideline nudge: pie-too-many-slices", () => {
    function pieChart(overrides: Partial<Chart> = {}): Chart {
      return {
        id: "c1",
        type: "pie",
        encoding: { category: "category", value: "sum_amount" },
        query: "q1",
        options: {},
        ...overrides,
      } as Chart;
    }

    function pieRows(n: number) {
      return Array.from({ length: n }, (_, i) => ({ category: `cat-${i}`, sum_amount: i + 1 }));
    }

    // V-001: 6/7 boundary, at the ChartBuilder UI-wiring level (the pure
    // predicate's own boundary is unit-tested in
    // packages/core/src/guideline/guideline.test.ts -- this pins that the
    // result actually reaches a visible advisory).
    it("shows no nudge at 6 slices, shows one at 7", async () => {
      const { host: sixHost } = await renderInJsdom(
        <ChartBuilder
          {...baseProps({
            chart: pieChart(),
            rowState: { status: "ready", rows: pieRows(6), truncated: false },
          })}
        />,
      );
      expect(sixHost.textContent).not.toContain("円グラフは分類が");

      const { host: sevenHost } = await renderInJsdom(
        <ChartBuilder
          {...baseProps({
            chart: pieChart(),
            rowState: { status: "ready", rows: pieRows(7), truncated: false },
          })}
        />,
      );
      const advisory = sevenHost.querySelector('[role="status"]');
      expect(advisory?.textContent).toContain("円グラフは分類が");

      // issue #123. `toContain("出典:")` used to be the whole assertion here --
      // which the string "出典: " satisfies, so it returned the same verdict for
      // the old citation, the corrected one, and an empty label alike. Assert the
      // rendered line equals the prefix plus the WHOLE label instead: that fails
      // if the UI ever truncates or drops it.
      //
      // The label's *content* is pinned in
      // packages/core/src/guideline/guideline.test.ts against a hand-written
      // table; re-pinning the same long string here would be a second manual
      // copy of it, and the two would drift. So the full-text check reads the
      // real rule, and the one literal duplicated below is the disclosure
      // clause -- short, and the actual thesis of #123, so reverting the JSON to
      // its old wording fails this test too rather than only the core one.
      const pieRule = getGuidelineRules().find((r) => r.id === "pie-too-many-slices");
      expect(pieRule).toBeDefined();
      expect(sevenHost.textContent).toContain(`出典: ${pieRule?.citation.label}`);
      expect(sevenHost.textContent).toContain("hyakkei の判断");

      // Pins the live-region boundary documented at the JSX in ChartBuilder.tsx:
      // the citation sits outside `role="status"`, so it is not announced when
      // the nudge appears. Asserted here so it stays a decision, not an accident.
      //
      // Over ALL status regions, not the first (QA Phase 8, J-1): the previous
      // form checked `advisory` — a `querySelector` first match, i.e. the
      // message paragraph — so giving the citation paragraph its own
      // `role="status"` left every assertion green. The boundary was pinned in
      // one direction only, while the comment claimed both.
      const statusRegions = [...sevenHost.querySelectorAll('[role="status"]')];
      expect(statusRegions.length).toBeGreaterThan(0);
      expect(statusRegions.every((el) => !el.textContent?.includes("出典:"))).toBe(true);
      // And the citation paragraph itself carries no live-region role. Verified
      // against the real DOM in the Phase 8-4 dry-run (`citationRole: null`).
      const citationP = [...sevenHost.querySelectorAll("p")].find((el) =>
        el.textContent?.startsWith("出典:"),
      );
      expect(citationP).toBeDefined();
      expect(citationP?.getAttribute("role")).toBeNull();
    });

    // Codex 6-B (test adversarial review, Blind Spot 3): the test above
    // only exercises two SEPARATE fresh mounts, never one component whose
    // `rowState` prop actually changes over its lifetime -- a mutation that
    // dropped `rowState`/`rows` from the nudge `useMemo`'s dependency array
    // (matching `mismatchedChannels`' own dependency shape above) would
    // still pass a fresh-mount-only test, since useMemo would just compute
    // the right answer once, on first render, regardless of its deps array.
    it("rerendering the SAME mounted card from 6 to 7 rows makes the nudge appear (useMemo dependency correctness)", async () => {
      const { host, rerender } = await renderInJsdom(
        <ChartBuilder
          {...baseProps({
            chart: pieChart(),
            rowState: { status: "ready", rows: pieRows(6), truncated: false },
          })}
        />,
      );
      expect(host.textContent).not.toContain("円グラフは分類が");

      await rerender(
        <ChartBuilder
          {...baseProps({
            chart: pieChart(),
            rowState: { status: "ready", rows: pieRows(7), truncated: false },
          })}
        />,
      );
      expect(host.textContent).toContain("円グラフは分類が");
    });

    // V-019: rowState not yet "ready" -- must not nudge (nothing to judge
    // yet), matching the existing type-mismatch advisory's own guard.
    it.each(["pending", "error"] as const)(
      "shows no nudge while rowState.status is %s",
      async (status) => {
        const { host } = await renderInJsdom(
          <ChartBuilder {...baseProps({ chart: pieChart(), rowState: { status } })} />,
        );
        expect(host.textContent).not.toContain("円グラフは分類が");
      },
    );

    // V-006: convert reuses the SAME onChange path handleTypeSelect("bar")
    // already uses (not a hand-rolled independent implementation) -- proven
    // by the resulting Chart having the identical shape a manual "棒グラフ"
    // tile click produces (see the earlier "switching to pie/bar" tests).
    // V-004: category->x, value->y carries over correctly.
    it("clicking 「棒グラフに変換」 maps encoding category->x, value->y and switches type to bar", async () => {
      const onChange = vi.fn();
      const { host } = await renderInJsdom(
        <ChartBuilder
          {...baseProps({
            chart: pieChart(),
            rowState: { status: "ready", rows: pieRows(7), truncated: false },
            onChange,
          })}
        />,
      );
      const convertButton = [...host.querySelectorAll("button")].find(
        (b) => b.textContent === "棒グラフに変換",
      )!;
      await act(async () => {
        convertButton.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      });
      expect(onChange).toHaveBeenCalledTimes(1);
      const [chartId, nextChart] = onChange.mock.calls[0]!;
      expect(chartId).toBe("c1");
      expect(nextChart.type).toBe("bar");
      expect(nextChart.encoding).toEqual({ x: "category", y: "sum_amount" });
    });

    // V-005: donut is stripped on convert (reconcileChartOptions), same as
    // an ordinary pie->bar tile click.
    it("clicking 「棒グラフに変換」 on a donut chart strips the donut flag", async () => {
      const onChange = vi.fn();
      const { host } = await renderInJsdom(
        <ChartBuilder
          {...baseProps({
            chart: pieChart({ options: { donut: true, title: "内訳" } }),
            rowState: { status: "ready", rows: pieRows(7), truncated: false },
            onChange,
          })}
        />,
      );
      const convertButton = [...host.querySelectorAll("button")].find(
        (b) => b.textContent === "棒グラフに変換",
      )!;
      await act(async () => {
        convertButton.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      });
      const [, nextChart] = onChange.mock.calls[0]!;
      expect(nextChart.options.donut).toBeUndefined();
      expect(nextChart.options.title).toBe("内訳");
    });

    // V-011: convert is disabled (not a silent no-op button) once
    // previewColumns clears to [], same discipline as the type-picker tiles.
    it("disables the convert button when no columns are available", async () => {
      const { host } = await renderInJsdom(
        <ChartBuilder
          {...baseProps({
            chart: pieChart(),
            query: query({ previewColumns: [] }),
            rowState: { status: "ready", rows: pieRows(7), truncated: false },
          })}
        />,
      );
      const convertButton = [...host.querySelectorAll("button")].find(
        (b) => b.textContent === "棒グラフに変換",
      ) as HTMLButtonElement;
      expect(convertButton.disabled).toBe(true);
    });

    // Phase 8 QA/UX finding (Major, WCAG 4.1.3 / Nielsen #1 &#3): convert's
    // own button unmounts itself (the nudge disappears once the chart is no
    // longer pie), which used to drop focus to <body> with nothing telling
    // an AT user anything happened or that undo is available.
    it("clicking 「棒グラフに変換」 announces the result and moves focus to 「元に戻す」", async () => {
      const { host } = await renderInJsdom(
        <ChartBuilder
          {...baseProps({
            chart: pieChart(),
            rowState: { status: "ready", rows: pieRows(7), truncated: false },
          })}
        />,
      );
      const convertButton = [...host.querySelectorAll("button")].find(
        (b) => b.textContent === "棒グラフに変換",
      )!;
      await act(async () => {
        convertButton.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      });
      const statusRegions = [...host.querySelectorAll('[role="status"]')].map(
        (el) => el.textContent,
      );
      expect(statusRegions).toContain("変換しました。");
      const undoButton = [...host.querySelectorAll("button")].find(
        (b) => b.textContent === "元に戻す",
      );
      expect(document.activeElement).toBe(undoButton);
    });

    // V-016: undo restores the FULL pre-convert chart (donut included), and
    // is itself a one-shot -- a further edit clears it rather than leaving
    // a stale snapshot around.
    it("「元に戻す」 restores the exact pre-convert chart (donut included), then disappears after another edit", async () => {
      const onChange = vi.fn();
      let currentChart = pieChart({ options: { donut: true, title: "内訳" } });
      const { host, rerender } = await renderInJsdom(
        <ChartBuilder
          {...baseProps({
            chart: currentChart,
            rowState: { status: "ready", rows: pieRows(7), truncated: false },
            onChange: (id, next) => {
              onChange(id, next);
              currentChart = next;
            },
          })}
        />,
      );
      const convertButton = [...host.querySelectorAll("button")].find(
        (b) => b.textContent === "棒グラフに変換",
      )!;
      await act(async () => {
        convertButton.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      });
      await rerender(
        <ChartBuilder
          {...baseProps({
            chart: currentChart,
            rowState: { status: "ready", rows: pieRows(7), truncated: false },
            onChange: (id, next) => {
              onChange(id, next);
              currentChart = next;
            },
          })}
        />,
      );
      const undoButton = [...host.querySelectorAll("button")].find(
        (b) => b.textContent === "元に戻す",
      )!;
      await act(async () => {
        undoButton.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      });
      const restored = onChange.mock.calls[1]![1];
      expect(restored.type).toBe("pie");
      expect(restored.options.donut).toBe(true);
      expect(restored.options.title).toBe("内訳");

      // Undo is one-shot: after it restores, the button must be gone (not
      // still offering to "undo" a state that's no longer the live chart).
      await rerender(
        <ChartBuilder
          {...baseProps({
            chart: restored,
            rowState: { status: "ready", rows: pieRows(7), truncated: false },
            onChange,
          })}
        />,
      );
      expect([...host.querySelectorAll("button")].some((b) => b.textContent === "元に戻す")).toBe(
        false,
      );
    });

    // Codex 6-B (test adversarial review, false-confidence finding): the
    // test above only proves undo disappears after IT ITSELF fires
    // (`isUndoRestore` clears its own snapshot) -- it never proves the
    // OTHER branch of `commitChartChange`'s choke-point design, that an
    // ORDINARY edit (not undo, not another convert) clears a live undo
    // snapshot too. A mutation that stopped clearing on normal edits would
    // have passed every test in this file before this one was added.
    it("an ordinary edit (title blur) while undo is live clears the undo snapshot, not just after undo itself fires", async () => {
      let currentChart = pieChart({ options: { donut: true, title: "内訳" } });
      const onChange = (_id: string, next: Chart) => {
        currentChart = next;
      };
      const { host, rerender } = await renderInJsdom(
        <ChartBuilder
          {...baseProps({
            chart: currentChart,
            rowState: { status: "ready", rows: pieRows(7), truncated: false },
            onChange,
          })}
        />,
      );
      const convertButton = [...host.querySelectorAll("button")].find(
        (b) => b.textContent === "棒グラフに変換",
      )!;
      await act(async () => {
        convertButton.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      });
      await rerender(
        <ChartBuilder
          {...baseProps({
            chart: currentChart,
            rowState: { status: "ready", rows: [], truncated: false },
            onChange,
          })}
        />,
      );
      expect([...host.querySelectorAll("button")].some((b) => b.textContent === "元に戻す")).toBe(
        true,
      );

      // An ordinary edit, unrelated to convert/undo: blur the title input.
      const titleInput = host.querySelector(
        'input[aria-label="グラフのタイトル"]',
      ) as HTMLInputElement;
      const nativeValueSetter = Object.getOwnPropertyDescriptor(
        window.HTMLInputElement.prototype,
        "value",
      )!.set!;
      await act(async () => {
        nativeValueSetter.call(titleInput, "新しいタイトル");
        titleInput.dispatchEvent(new Event("input", { bubbles: true }));
      });
      await act(async () => {
        titleInput.dispatchEvent(new FocusEvent("focusout", { bubbles: true }));
      });
      await rerender(
        <ChartBuilder
          {...baseProps({
            chart: currentChart,
            rowState: { status: "ready", rows: [], truncated: false },
            onChange,
          })}
        />,
      );
      expect([...host.querySelectorAll("button")].some((b) => b.textContent === "元に戻す")).toBe(
        false,
      );
    });

    // Codex 6-B (test adversarial review, false-confidence finding): the
    // earlier version of this test only checked the OUTPUT SHAPE
    // ({category,value} -> {x,y}) in isolation, which a hand-rolled
    // convert implementation (bypassing handleTypeSelect entirely) could
    // also satisfy by coincidence. This instead compares the convert
    // button's actual output against a manual "棒グラフ" tile click's
    // output from the IDENTICAL starting chart -- proving they are the
    // SAME transformation, not just two transformations with the same
    // shape for this one input.
    it("「棒グラフに変換」 produces byte-identical output to manually clicking the 「棒グラフ」 tile from the same starting chart", async () => {
      const startingChart = pieChart({ options: { donut: true, title: "内訳" } });
      const rowState: ChartRowState = { status: "ready", rows: pieRows(7), truncated: false };

      const convertOnChange = vi.fn();
      const { host: convertHost } = await renderInJsdom(
        <ChartBuilder
          {...baseProps({ chart: startingChart, rowState, onChange: convertOnChange })}
        />,
      );
      const convertButton = [...convertHost.querySelectorAll("button")].find(
        (b) => b.textContent === "棒グラフに変換",
      )!;
      await act(async () => {
        convertButton.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      });

      const tileOnChange = vi.fn();
      const { host: tileHost } = await renderInJsdom(
        <ChartBuilder {...baseProps({ chart: startingChart, rowState, onChange: tileOnChange })} />,
      );
      const barTile = [...tileHost.querySelectorAll("button")].find(
        (b) => b.textContent === "棒グラフ",
      )!;
      await act(async () => {
        barTile.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      });

      expect(convertOnChange.mock.calls[0]![1]).toEqual(tileOnChange.mock.calls[0]![1]);
    });

    // V-012/V-023: the guideline nudge coexists with the pre-existing
    // type-mismatch advisory without either clobbering the other.
    it("coexists with the type-mismatch advisory when both conditions hold simultaneously", async () => {
      const { host } = await renderInJsdom(
        <ChartBuilder
          {...baseProps({
            chart: pieChart(),
            rowState: {
              status: "ready",
              rows: Array.from({ length: 7 }, (_, i) => ({
                category: `cat-${i}`,
                sum_amount: "not a number",
              })),
              truncated: false,
            },
          })}
        />,
      );
      const statusRegions = [...host.querySelectorAll('[role="status"]')].map(
        (el) => el.textContent,
      );
      expect(statusRegions.some((t) => t?.includes("円グラフは分類が"))).toBe(true);
      expect(statusRegions.some((t) => t?.includes("数値として認識できませんでした"))).toBe(true);
    });

    // V-013: production guideline-rules.json is a static, developer-authored
    // TCB constant today (Security Threat Model: no user-editable/external
    // path reaches its message/citation) -- but the render path itself must
    // stay safe regardless, as a residual-risk guard for the day rules.json
    // does gain an external-load path (ADR-0016). `evaluateGuidelinesSpy` is
    // overridden for just this one call (same injected-payload convention as
    // `packages/core/src/renderer/xss.test.ts`'s `SCRIPT_PAYLOAD`) to prove
    // the render path (JSX text children, no dangerouslySetInnerHTML) is
    // what makes this safe -- not merely that today's fixed message happens
    // to contain no markup.
    it("never executes/interprets markup embedded in a nudge message or citation (JSX text-only rendering)", async () => {
      const SCRIPT_PAYLOAD = "</p><script>alert(1)</script>";
      evaluateGuidelinesSpy.mockReturnValueOnce([
        {
          ruleId: "pie-too-many-slices",
          message: SCRIPT_PAYLOAD,
          // `url` is now required and https-only (issue #123). It is unread by
          // this render path, so the payload stays on `label` -- the one field
          // the UI actually prints.
          citation: { label: SCRIPT_PAYLOAD, url: "https://example.test/x" },
        },
      ]);
      const { host } = await renderInJsdom(
        <ChartBuilder
          {...baseProps({
            chart: pieChart(),
            rowState: { status: "ready", rows: pieRows(7), truncated: false },
          })}
        />,
      );
      const advisory = host.querySelector('[role="status"]');
      expect(host.innerHTML).not.toContain("<script");
      expect(advisory?.querySelector("script, img")).toBeNull();
      expect(advisory?.textContent).toBe(SCRIPT_PAYLOAD);
      expect(host.textContent).toContain(`出典: ${SCRIPT_PAYLOAD}`);
    });
  });
});
