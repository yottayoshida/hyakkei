/** @vitest-environment jsdom */
import type { Chart } from "@hyakkei/schema";
import { act, type ReactElement } from "react";
import { createRoot } from "react-dom/client";
import { beforeEach, describe, expect, it, vi } from "vitest";

// Same convention as App.test.tsx: mount/unmount mocked so this test pins the
// React lifecycle wiring (when they're called, with what element), not the
// real ECharts rendering contract (that's core's own test surface).
const { mountSpy, unmountSpy } = vi.hoisted(() => ({
  mountSpy: vi.fn(),
  unmountSpy: vi.fn(),
}));
vi.mock("@hyakkei/core/renderer", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@hyakkei/core/renderer")>();
  return { ...actual, mount: mountSpy, unmount: unmountSpy };
});

import { ChartPreview } from "./ChartPreview.js";

const CHART: Chart = {
  id: "c1",
  type: "bar",
  encoding: { x: "category", y: "total" },
  query: "q1",
  options: { title: "テストチャート" },
};

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
    unmount: async () => {
      await act(async () => {
        root.unmount();
      });
    },
  };
}

describe("ChartPreview", () => {
  it('shows "計算中…" and never calls mount() while rowState is pending', async () => {
    const { host, unmount } = await renderInJsdom(
      <ChartPreview chart={CHART} rowState={{ status: "pending" }} />,
    );
    expect(host.textContent).toContain("計算中…");
    expect(mountSpy).not.toHaveBeenCalled();
    await unmount();
  });

  it("shows an alert and never calls mount() when rowState is error", async () => {
    const { host, unmount } = await renderInJsdom(
      <ChartPreview chart={CHART} rowState={{ status: "error" }} />,
    );
    expect(host.querySelector('[role="alert"]')).not.toBeNull();
    expect(mountSpy).not.toHaveBeenCalled();
    await unmount();
  });

  it("calls mount() with a normalizeAuthoring-built model wrapping the single chart + its rows", async () => {
    const rows = [{ category: "A", total: 1 }];
    const { unmount } = await renderInJsdom(
      <ChartPreview chart={CHART} rowState={{ status: "ready", rows, truncated: false }} />,
    );
    expect(mountSpy).toHaveBeenCalledTimes(1);
    const [element, model] = mountSpy.mock.calls[0]!;
    expect(element).toBeInstanceOf(HTMLElement);
    expect(model.charts).toHaveLength(1);
    expect(model.charts[0].id).toBe("c1");
    expect(model.charts[0].rows).toEqual(rows);
    await unmount();
  });

  it("calls unmount() with the mounted element on unmount (no leaked ECharts instance)", async () => {
    const { unmount } = await renderInJsdom(
      <ChartPreview chart={CHART} rowState={{ status: "ready", rows: [], truncated: false }} />,
    );
    const mountedElement = mountSpy.mock.calls[0]?.[0];
    await unmount();
    expect(unmountSpy).toHaveBeenCalledWith(mountedElement);
  });

  it("re-mounts with an empty rowsByQuery when chart.query is unset (never crashes on an unconfigured chart)", async () => {
    const unconfigured: Chart = { id: "c2", type: "stat", encoding: { value: "n" }, options: {} };
    const { unmount } = await renderInJsdom(
      <ChartPreview chart={unconfigured} rowState={{ status: "ready", rows: [], truncated: false }} />,
    );
    expect(mountSpy).toHaveBeenCalledTimes(1);
    const model = mountSpy.mock.calls[0]![1];
    expect(model.charts[0].state).toBe("unconfigured");
    await unmount();
  });

  // Plan conformance audit note: `rowsByQuery`'s `{ [chart.query]: rows }`
  // is a COMPUTED-key object literal (`CreateDataPropertyOrThrow` per spec),
  // not the object-literal `__proto__:` shorthand or a later bracket
  // ASSIGNMENT -- even a `chart.query` of `"__proto__"` (never reachable in
  // practice, ids are always app-generated, but worth pinning directly)
  // must land as a real, retrievable own property. If it instead silently
  // reassigned `rowsByQuery`'s own prototype, `normalizeAuthoring`'s
  // `Object.hasOwn`-based lookup (render-model.ts's `lookupRows`) would
  // fail to find it and this chart would render with NO rows instead of
  // the real ones -- that's the failure this assertion actually catches.
  it("handles chart.query === \"__proto__\" as a real own rowsByQuery key, correctly retrieved (not silently dropped)", async () => {
    const protoQueryChart: Chart = {
      id: "c3",
      type: "stat",
      encoding: { value: "n" },
      query: "__proto__",
      options: {},
    };
    const rows = [{ n: 1 }];
    const { unmount } = await renderInJsdom(
      <ChartPreview chart={protoQueryChart} rowState={{ status: "ready", rows, truncated: false }} />,
    );
    expect(mountSpy).toHaveBeenCalledTimes(1);
    const model = mountSpy.mock.calls[0]![1];
    expect(model.charts[0].rows).toEqual(rows);
    await unmount();
  });
});
