/** @vitest-environment jsdom */
import type { Chart } from "@hyakkei/schema";
import { act, type ReactElement } from "react";
import { createRoot } from "react-dom/client";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ChartRowState } from "../intake/types.js";

// Same convention as ChartPreview.test.tsx: mount/unmount/patch mocked so
// these tests pin the React lifecycle wiring (when they're called, with
// what model), not the real ECharts/patch() diffing contract (that's
// core's own test surface, packages/core/src/renderer/mount.test.ts).
const { patchSpy, unmountSpy } = vi.hoisted(() => ({
  patchSpy: vi.fn(),
  unmountSpy: vi.fn(),
}));
vi.mock("@hyakkei/core/renderer", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@hyakkei/core/renderer")>();
  return { ...actual, patch: patchSpy, unmount: unmountSpy };
});

import { AuthoringDashboardPreview, toRowsByQuery } from "./AuthoringDashboardPreview.js";

const CHART_A: Chart = {
  id: "c1",
  type: "bar",
  encoding: { x: "category", y: "total" },
  query: "q1",
  options: {},
};
const LAYOUT = {
  grid: "guidebook-12col" as const,
  items: [{ chart: "c1", x: 0, y: 0, w: 6, h: 6 }],
};
// /simplify (Simplification finding): one shared no-op instead of the same
// `() => {}` literal repeated at every render/rerender call site below.
const NOOP_REORDER = () => {};

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  patchSpy.mockClear();
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
    unmount: async () => {
      await act(async () => {
        root.unmount();
      });
    },
  };
}

describe("toRowsByQuery", () => {
  it("passes through rows only for status:ready, and [] for pending/error (silent-fail=zero)", () => {
    const map = new Map<string, ChartRowState>([
      ["q1", { status: "ready", rows: [{ a: 1 }], truncated: false }],
      ["q2", { status: "pending" }],
      ["q3", { status: "error", kind: "query" }],
    ]);
    expect(toRowsByQuery(map)).toEqual({ q1: [{ a: 1 }], q2: [], q3: [] });
  });

  // V-013: query id "__proto__" must become a real, retrievable own
  // property, not silently reassign the record's own prototype -- the same
  // class of bug `ChartPreview.tsx`'s own computed-key rowsByQuery already
  // pins (this PR's Map->Record helper is the second such boundary).
  it('handles a query id of "__proto__" as a real own property (prototype pollution discipline)', () => {
    const map = new Map<string, ChartRowState>([
      ["__proto__", { status: "ready", rows: [{ n: 1 }], truncated: false }],
    ]);
    const record = toRowsByQuery(map);
    expect(Object.hasOwn(record, "__proto__")).toBe(true);
    expect(record["__proto__"]).toEqual([{ n: 1 }]);
    expect(Object.getPrototypeOf({})).not.toHaveProperty("n"); // real Object.prototype untouched
  });
});

describe("AuthoringDashboardPreview", () => {
  it("calls patch() once on mount with a Dashboard document built from charts+layout", async () => {
    const chartRowsByQuery = new Map<string, ChartRowState>([
      ["q1", { status: "ready", rows: [{ category: "A", total: 1 }], truncated: false }],
    ]);
    const { unmount: cleanup } = await renderInJsdom(
      <AuthoringDashboardPreview
        charts={[CHART_A]}
        layout={LAYOUT}
        chartRowsByQuery={chartRowsByQuery}
        onReorderLayout={NOOP_REORDER}
      />,
    );

    expect(patchSpy).toHaveBeenCalledTimes(1);
    const [element, model] = patchSpy.mock.calls[0]!;
    expect(element).toBeInstanceOf(HTMLElement);
    expect(model.charts).toHaveLength(1);
    expect(model.charts[0].id).toBe("c1");
    expect(model.charts[0].rows).toEqual([{ category: "A", total: 1 }]);
    await cleanup();
  });

  // issue #70's entire point: a re-render with the SAME charts/layout/
  // chartRowsByQuery references must still call patch() (patch() itself,
  // not this component, is responsible for deciding nothing changed) --
  // but must NOT call unmount() on cleanup, since this isn't the
  // component's own final teardown.
  //
  // issue #70's entire point, at the React layer: re-rendering with the
  // EXACT SAME charts/layout/chartRowsByQuery references never re-runs the
  // patch-effect at all (React's own dependency-array comparison skips the
  // effect body entirely) -- an even cheaper outcome than patch() itself
  // being called and internally no-opping.
  it("a re-render with identical props calls neither patch() nor unmount() again (patch-effect vs teardown-effect split)", async () => {
    const chartRowsByQuery = new Map<string, ChartRowState>([
      ["q1", { status: "ready", rows: [], truncated: false }],
    ]);
    const props = {
      charts: [CHART_A],
      layout: LAYOUT,
      chartRowsByQuery,
      onReorderLayout: NOOP_REORDER,
    };
    const { rerender, unmount: cleanup } = await renderInJsdom(
      <AuthoringDashboardPreview {...props} />,
    );
    patchSpy.mockClear();

    await rerender(<AuthoringDashboardPreview {...props} />);

    expect(patchSpy).not.toHaveBeenCalled();
    expect(unmountSpy).not.toHaveBeenCalled();
    await cleanup();
  });

  // Phase 6-B (Codex adversarial test review, High finding): the previous
  // test only proved the NO-OP case (identical references). The actual
  // edit path -- a genuinely new `chartRowsByQuery` reference reaching
  // patch() again, WITHOUT the teardown-effect's unmount() firing -- was
  // untested. A regression that accidentally added `chartRowsByQuery` to
  // the teardown-effect's own deps (unmounting on every edit instead of
  // only the component's final teardown) would have passed every other
  // test in this file.
  it("a re-render with a genuinely changed chartRowsByQuery calls patch() again, without unmount() firing", async () => {
    const chartRowsByQuery1 = new Map<string, ChartRowState>([
      ["q1", { status: "ready", rows: [{ category: "A", total: 1 }], truncated: false }],
    ]);
    const { rerender, unmount: cleanup } = await renderInJsdom(
      <AuthoringDashboardPreview
        charts={[CHART_A]}
        layout={LAYOUT}
        chartRowsByQuery={chartRowsByQuery1}
        onReorderLayout={NOOP_REORDER}
      />,
    );
    patchSpy.mockClear();

    const chartRowsByQuery2 = new Map<string, ChartRowState>([
      ["q1", { status: "ready", rows: [{ category: "B", total: 2 }], truncated: false }],
    ]);
    await rerender(
      <AuthoringDashboardPreview
        charts={[CHART_A]}
        layout={LAYOUT}
        chartRowsByQuery={chartRowsByQuery2}
        onReorderLayout={NOOP_REORDER}
      />,
    );

    expect(patchSpy).toHaveBeenCalledTimes(1);
    expect(patchSpy.mock.calls[0]![1].charts[0].rows).toEqual([{ category: "B", total: 2 }]);
    expect(unmountSpy).not.toHaveBeenCalled();
    await cleanup();
  });

  it("calls unmount() exactly once when the component itself unmounts (teardown-effect)", async () => {
    const chartRowsByQuery = new Map<string, ChartRowState>();
    const { unmount: cleanup } = await renderInJsdom(
      <AuthoringDashboardPreview
        charts={[]}
        layout={{ grid: "guidebook-12col", items: [] }}
        chartRowsByQuery={chartRowsByQuery}
        onReorderLayout={NOOP_REORDER}
      />,
    );
    await cleanup();
    expect(unmountSpy).toHaveBeenCalledTimes(1);
  });

  // V-017: a chart whose query is pending must render as "pending" (計算
  // 中…), not silently collapse through toRowsByQuery's [] into
  // normalizeAuthoring's own "empty" (データがありません, a false negative).
  it('overlays state:"pending" onto a chart whose query is still pending', async () => {
    const chartRowsByQuery = new Map<string, ChartRowState>([["q1", { status: "pending" }]]);
    const { unmount: cleanup } = await renderInJsdom(
      <AuthoringDashboardPreview
        charts={[CHART_A]}
        layout={LAYOUT}
        chartRowsByQuery={chartRowsByQuery}
        onReorderLayout={NOOP_REORDER}
      />,
    );
    const model = patchSpy.mock.calls[0]![1];
    expect(model.charts[0].state).toBe("pending");
    await cleanup();
  });

  // V-021 counterpart: same overlay, for a failed query.
  it('overlays state:"error" onto a chart whose query failed', async () => {
    const chartRowsByQuery = new Map<string, ChartRowState>([
      ["q1", { status: "error", kind: "query" }],
    ]);
    const { unmount: cleanup } = await renderInJsdom(
      <AuthoringDashboardPreview
        charts={[CHART_A]}
        layout={LAYOUT}
        chartRowsByQuery={chartRowsByQuery}
        onReorderLayout={NOOP_REORDER}
      />,
    );
    const model = patchSpy.mock.calls[0]![1];
    expect(model.charts[0].state).toBe("error");
    await cleanup();
  });

  it("shows a safe memory-specific alert for a failed chart query", async () => {
    const chartRowsByQuery = new Map<string, ChartRowState>([["q1", { status: "error", kind: "oom" }]]);
    const { host, unmount: cleanup } = await renderInJsdom(
      <AuthoringDashboardPreview
        charts={[CHART_A]}
        layout={LAYOUT}
        chartRowsByQuery={chartRowsByQuery}
        onReorderLayout={NOOP_REORDER}
      />,
    );

    expect(host.textContent).toContain("メモリ不足でグラフを表示できませんでした");
    expect(host.textContent).not.toContain("Out of Memory Error");
    await cleanup();
  });

  it('a genuinely-ready query with zero rows stays "empty" (not reclassified as pending/error)', async () => {
    const chartRowsByQuery = new Map<string, ChartRowState>([
      ["q1", { status: "ready", rows: [], truncated: false }],
    ]);
    const { unmount: cleanup } = await renderInJsdom(
      <AuthoringDashboardPreview
        charts={[CHART_A]}
        layout={LAYOUT}
        chartRowsByQuery={chartRowsByQuery}
        onReorderLayout={NOOP_REORDER}
      />,
    );
    const model = patchSpy.mock.calls[0]![1];
    expect(model.charts[0].state).toBe("empty");
    await cleanup();
  });

  // Phase 8 QA finding (V-014): `layout` (order) and `chartRowsByQuery` (row
  // readiness) are independent props updated on their own timelines -- a
  // DIFFERENT chart's query resolving from pending to ready must not revert
  // or corrupt a reorder that already landed while it was still pending.
  it("a reorder that lands while a different chart's query is still pending survives that query later becoming ready", async () => {
    const CHART_B: Chart = {
      id: "c2",
      type: "bar",
      encoding: { x: "category", y: "total" },
      query: "q2",
      options: {},
    };
    const LAYOUT_AB = {
      grid: "guidebook-12col" as const,
      items: [
        { chart: "c1", x: 0, y: 0, w: 6, h: 6 },
        { chart: "c2", x: 6, y: 0, w: 6, h: 6 },
      ],
    };
    // The prop shape a completed reorder produces (App.tsx's reorderLayout is
    // exercised end-to-end at the e2e layer; this test only needs the layout
    // PROP CHANGE it results in): c2 now first, c1 second.
    const LAYOUT_BA = {
      grid: "guidebook-12col" as const,
      items: [
        { chart: "c2", x: 0, y: 0, w: 6, h: 6 },
        { chart: "c1", x: 6, y: 0, w: 6, h: 6 },
      ],
    };
    const rowsPending = new Map<string, ChartRowState>([
      ["q1", { status: "ready", rows: [{ category: "A", total: 1 }], truncated: false }],
      ["q2", { status: "pending" }],
    ]);
    const { rerender, unmount: cleanup } = await renderInJsdom(
      <AuthoringDashboardPreview
        charts={[CHART_A, CHART_B]}
        layout={LAYOUT_AB}
        chartRowsByQuery={rowsPending}
        onReorderLayout={NOOP_REORDER}
      />,
    );

    // The reorder lands WHILE q2 is still pending.
    await rerender(
      <AuthoringDashboardPreview
        charts={[CHART_A, CHART_B]}
        layout={LAYOUT_BA}
        chartRowsByQuery={rowsPending}
        onReorderLayout={NOOP_REORDER}
      />,
    );

    // q2 settles to ready -- only chartRowsByQuery changes, layout does not.
    const rowsReady = new Map<string, ChartRowState>([
      ["q1", { status: "ready", rows: [{ category: "A", total: 1 }], truncated: false }],
      ["q2", { status: "ready", rows: [{ category: "B", total: 2 }], truncated: false }],
    ]);
    await rerender(
      <AuthoringDashboardPreview
        charts={[CHART_A, CHART_B]}
        layout={LAYOUT_BA}
        chartRowsByQuery={rowsReady}
        onReorderLayout={NOOP_REORDER}
      />,
    );

    const finalModel = patchSpy.mock.calls.at(-1)![1];
    // The reorder survives: c2 is still first, not reverted to the
    // pre-reorder order by the later, unrelated chartRowsByQuery change.
    expect(finalModel.layout.items.map((item: { chart: string }) => item.chart)).toEqual([
      "c2",
      "c1",
    ]);
    // And the settled query's rows correctly reached the RIGHT chart (c2),
    // not left stale/pending despite the reorder happening in between.
    const chartB = finalModel.charts.find((c: { id: string }) => c.id === "c2");
    expect(chartB.state).toBe("ok");
    expect(chartB.rows).toEqual([{ category: "B", total: 2 }]);
    await cleanup();
  });

  // Codex review Round 1, P1: the boundary must wrap the component whose
  // OWN effect calls patch() -- an ancestor's effect throw is NOT caught by
  // a boundary rendered as that ancestor's own descendant (React error
  // boundaries only catch descendant errors). This pins the fix: the
  // fallback renders instead of the error propagating uncaught out of the
  // whole component.
  it("a patch() throw is caught by DashboardErrorBoundary, not left to propagate uncaught", async () => {
    const chartRowsByQuery = new Map<string, ChartRowState>([
      ["q1", { status: "ready", rows: [], truncated: false }],
    ]);
    patchSpy.mockImplementationOnce(() => {
      throw new Error("boom");
    });
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const { host, unmount: cleanup } = await renderInJsdom(
      <AuthoringDashboardPreview
        charts={[CHART_A]}
        layout={LAYOUT}
        chartRowsByQuery={chartRowsByQuery}
        onReorderLayout={NOOP_REORDER}
      />,
    );

    expect(host.querySelector('[role="alert"]')?.textContent).toBe(
      "ダッシュボードを表示できませんでした。お手数ですが、ページを再読み込みしてください。",
    );
    errorSpy.mockRestore();
    await cleanup();
  });

  it("the reset button calls unmount() then patch() again, forcing a full rebuild", async () => {
    const chartRowsByQuery = new Map<string, ChartRowState>([
      ["q1", { status: "ready", rows: [], truncated: false }],
    ]);
    const { host, unmount: cleanup } = await renderInJsdom(
      <AuthoringDashboardPreview
        charts={[CHART_A]}
        layout={LAYOUT}
        chartRowsByQuery={chartRowsByQuery}
        onReorderLayout={NOOP_REORDER}
      />,
    );
    patchSpy.mockClear();
    unmountSpy.mockClear();

    const resetButton = host.querySelector(
      'button[aria-label="配置ビューを再構築"]',
    ) as HTMLButtonElement;
    await act(async () => {
      resetButton.click();
    });

    expect(unmountSpy).toHaveBeenCalledTimes(1);
    expect(patchSpy).toHaveBeenCalledTimes(1);
    // unmount() must be called BEFORE the follow-up patch(), not after --
    // otherwise the fresh patch() call would immediately be undone.
    const unmountOrder = unmountSpy.mock.invocationCallOrder[0]!;
    const patchOrder = patchSpy.mock.invocationCallOrder[0]!;
    expect(unmountOrder).toBeLessThan(patchOrder);
    await cleanup();
  });

  // QA Phase 8 (Major, Nielsen #1): clicking reset must not be silent --
  // the button's whole reason to exist is giving a user who suspects a
  // silent-wrong render a way to confirm the view was rebuilt.
  it("the reset button announces its own effect via role=status", async () => {
    const chartRowsByQuery = new Map<string, ChartRowState>([
      ["q1", { status: "ready", rows: [], truncated: false }],
    ]);
    const { host, unmount: cleanup } = await renderInJsdom(
      <AuthoringDashboardPreview
        charts={[CHART_A]}
        layout={LAYOUT}
        chartRowsByQuery={chartRowsByQuery}
        onReorderLayout={NOOP_REORDER}
      />,
    );

    expect(host.querySelector('[role="status"]')).toBeNull();
    const resetButton = host.querySelector(
      'button[aria-label="配置ビューを再構築"]',
    ) as HTMLButtonElement;
    await act(async () => {
      resetButton.click();
    });

    expect(host.querySelector('[role="status"]')?.textContent).toBe("配置ビューを再構築しました。");
    await cleanup();
  });

  // QA Phase 8 (Major, Jakob's Law): (A) ChartBuilder.tsx discloses
  // truncation per-chart; toRowsByQuery discards the same `truncated` flag
  // when building (B)'s model, so without this aggregate notice the SAME
  // chart would tell two different completeness stories depending which of
  // (A)/(B) a user reads.
  describe("truncation advisory", () => {
    it("shows an aggregate notice when at least one chart's query was truncated", async () => {
      const chartRowsByQuery = new Map<string, ChartRowState>([
        ["q1", { status: "ready", rows: [], truncated: true }],
      ]);
      const { host, unmount: cleanup } = await renderInJsdom(
        <AuthoringDashboardPreview
          charts={[CHART_A]}
          layout={LAYOUT}
          chartRowsByQuery={chartRowsByQuery}
          onReorderLayout={NOOP_REORDER}
        />,
      );

      expect(host.textContent).toContain("一部のグラフはデータが多いため");
      await cleanup();
    });

    it("shows no notice when no chart's query was truncated", async () => {
      const chartRowsByQuery = new Map<string, ChartRowState>([
        ["q1", { status: "ready", rows: [], truncated: false }],
      ]);
      const { host, unmount: cleanup } = await renderInJsdom(
        <AuthoringDashboardPreview
          charts={[CHART_A]}
          layout={LAYOUT}
          chartRowsByQuery={chartRowsByQuery}
          onReorderLayout={NOOP_REORDER}
        />,
      );

      expect(host.textContent).not.toContain("一部のグラフはデータが多いため");
      await cleanup();
    });
  });
});
