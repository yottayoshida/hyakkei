/** @vitest-environment jsdom */
import type { BakedDashboard } from "@hyakkei/schema";
import { act, type ReactElement } from "react";
import { createRoot } from "react-dom/client";
import { beforeEach, describe, expect, it, vi } from "vitest";

// mount/unmount are mocked so this test pins the React lifecycle wiring
// itself (when they are called, with what element) without rendering real
// ECharts under jsdom -- that rendering contract is core's own test surface
// (packages/core/src/renderer/mount.test.ts), not this component's.
const { mountSpy, unmountSpy } = vi.hoisted(() => ({
  mountSpy: vi.fn(),
  unmountSpy: vi.fn(),
}));
vi.mock("@hyakkei/core/renderer", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@hyakkei/core/renderer")>();
  return { ...actual, mount: mountSpy, unmount: unmountSpy };
});

import {
  App,
  DashboardErrorBoundary,
  DashboardPreview,
  emptyBuilderState,
  mergeWorkspaceSource,
  upsertOverride,
} from "./App.js";
import type { IntakeSample } from "./intake/types.js";

const SAMPLE: BakedDashboard = {
  version: 1,
  meta: {
    title: "テスト用ダッシュボード",
    generatedAt: "2026-07-11T00:00:00Z",
    sourceDataAsOf: "2026-07-10",
    hyakkeiVersion: "0.1.0",
  },
  theme: {
    tokens: "@digital-go-jp/design-tokens@2.0.1",
    palette: "guidebook-blue",
    appearance: "light",
  },
  charts: [
    {
      id: "c1",
      type: "bar",
      encoding: { x: "category", y: "total" },
      options: { title: "テスト" },
      rows: [{ category: "A", total: 1 }],
    },
  ],
  layout: { grid: "guidebook-12col", items: [{ chart: "c1", x: 0, y: 0, w: 6, h: 6 }] },
};

// Set once for the whole file rather than repeated in every test
// (/simplify Simplification finding): never reset back, so a one-time
// `beforeEach` is equivalent to the per-test assignment it replaces.
beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

/**
 * Host/root creation + `act`-wrapped render, extracted from what was
 * 5 near-identical copies across this file (/simplify Simplification
 * finding). `rerender`/`unmount` reuse the SAME root -- required for the
 * key-based-remount tests below, which need one continuous tree, not two
 * independently mounted ones.
 */
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

describe("app package scaffold", () => {
  it("exports a component", () => {
    expect(typeof App).toBe("function");
  });

  // issue #64: the pre-existing "exports a component" test above only
  // asserts `typeof App === 'function'` -- it would pass even if App threw
  // on render or rendered nothing.
  it("render(<App/>) does not throw and starts in the onboarding state (no sources registered yet, issue #11a)", async () => {
    mountSpy.mockClear();
    const { host, unmount } = await renderInJsdom(<App />);
    expect(host.querySelector("div")).not.toBeNull();
    expect(host.textContent).toContain("データ取り込み");
    // Nothing to preview before any source exists -- the editor shell's
    // first render must not reach DashboardPreview/mount() at all (real
    // chart rendering, once a source IS registered, is an e2e concern:
    // reaching it needs a real DuckDB registration, which jsdom cannot do,
    // same convention data-layer.test.ts's own comment documents).
    expect(mountSpy).not.toHaveBeenCalled();

    await unmount();
  });
});

// issue #11a: DashboardPreview/DashboardErrorBoundary are tested directly
// here, decoupled from App()'s onboarding gate -- reaching the workspace
// branch of App() itself requires a real registered source (DuckDB, e2e
// concern), but the boundary/preview contract these tests pin (mount
// lifecycle, per-tile error containment, key-based recovery) does not
// depend on how the parent decides to render them.
describe("DashboardPreview / DashboardErrorBoundary", () => {
  it("issue #55: unmount() runs with the mounted element when the component itself unmounts", async () => {
    // React detaches host refs (nulls .current) BEFORE passive-effect
    // cleanups run on unmount -- a cleanup that re-reads the ref instead of
    // closing over the element skips disposal in exactly this case, leaking
    // one ECharts instance per dashboard/tab switch. This test fails against
    // that implementation.
    mountSpy.mockClear();
    unmountSpy.mockClear();
    const { unmount } = await renderInJsdom(
      <DashboardErrorBoundary>
        <DashboardPreview dashboard={SAMPLE} />
      </DashboardErrorBoundary>,
    );
    expect(mountSpy).toHaveBeenCalledTimes(1);
    const mountedElement = mountSpy.mock.calls[0]?.[0];
    expect(mountedElement).toBeInstanceOf(HTMLElement);

    await unmount();
    expect(unmountSpy).toHaveBeenCalledWith(mountedElement);
  });

  // Issue #69: mount.ts's own per-tile/per-instance try/catch (core's test
  // surface, mount.test.ts) covers throws INSIDE mount() -- this test is
  // for what's outside that scope: mount() itself throwing synchronously
  // (the mock below stands in for `normalizeBaked`/`buildOptions`/
  // `gridStyle` failing before mount.ts's own tile loop even starts).
  // React's error-boundary contract explicitly covers useEffect callbacks
  // (unlike event handlers/setTimeout/rAF), so DashboardErrorBoundary must
  // catch this without the whole tree unmounting.
  it("issue #69: a synchronous throw from mount() inside useEffect is caught by the error boundary, not left to blank the whole app", async () => {
    mountSpy.mockClear();
    mountSpy.mockImplementationOnce(() => {
      throw new Error("simulated mount() failure");
    });
    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const { host, unmount } = await renderInJsdom(
      <DashboardErrorBoundary>
        <DashboardPreview dashboard={SAMPLE} />
      </DashboardErrorBoundary>,
    );

    const alert = host.querySelector('[role="alert"]');
    expect(alert).not.toBeNull();
    expect(alert?.textContent).toBe(
      "ダッシュボードを表示できませんでした。お手数ですが、ページを再読み込みしてください。",
    );

    consoleErrorSpy.mockRestore();
    await unmount();
  });

  // issue #11a: DashboardErrorBoundary's ONLY recovery mechanism is the
  // PARENT reassigning its `key` (App.tsx wires one; no #11c dashboard-swap
  // feature exists yet to exercise this organically) -- this proves the
  // mechanism directly, against the exported class.
  it("changing the boundary's key remounts it and clears a prior hasError, recovering from a crash", async () => {
    mountSpy.mockClear();
    mountSpy.mockImplementationOnce(() => {
      throw new Error("simulated mount() failure");
    });
    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const { host, rerender, unmount } = await renderInJsdom(
      <DashboardErrorBoundary key="a">
        <DashboardPreview dashboard={SAMPLE} />
      </DashboardErrorBoundary>,
    );
    expect(host.querySelector('[role="alert"]')).not.toBeNull();

    await rerender(
      <DashboardErrorBoundary key="b">
        <DashboardPreview dashboard={SAMPLE} />
      </DashboardErrorBoundary>,
    );
    expect(host.querySelector('[role="alert"]')).toBeNull();
    // mount() was NOT re-mocked to throw for the second render -- reaching
    // the real (non-throwing) mock call is what proves the remount actually
    // happened, not just that a stale hasError=true render was reused.
    expect(mountSpy).toHaveBeenCalledTimes(2);

    consoleErrorSpy.mockRestore();
    await unmount();
  });

  // Regression guard for a footgun the key-reset mechanism itself invites
  // (mirror-review QA V-056): a naive "reset on any re-render" boundary
  // would infinite-loop (render -> throw -> catch -> reset -> render ->
  // throw...) against a persistently-crashing input. This proves the SAME
  // key across a re-render does NOT reset hasError -- React only remounts
  // on a key CHANGE, never on an ordinary re-render with an unchanged key.
  it("re-rendering with the SAME key does not reset a prior hasError (no reset-render-throw loop)", async () => {
    mountSpy.mockClear();
    mountSpy.mockImplementationOnce(() => {
      throw new Error("simulated mount() failure");
    });
    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const { host, rerender, unmount } = await renderInJsdom(
      <DashboardErrorBoundary key="a">
        <DashboardPreview dashboard={SAMPLE} />
      </DashboardErrorBoundary>,
    );
    expect(host.querySelector('[role="alert"]')).not.toBeNull();
    expect(mountSpy).toHaveBeenCalledTimes(1);

    await rerender(
      <DashboardErrorBoundary key="a">
        <DashboardPreview dashboard={SAMPLE} />
      </DashboardErrorBoundary>,
    );
    expect(host.querySelector('[role="alert"]')).not.toBeNull();
    // Still 1 -- the boundary was never remounted, so DashboardPreview (and
    // its mount() call) never ran a second time.
    expect(mountSpy).toHaveBeenCalledTimes(1);

    consoleErrorSpy.mockRestore();
    await unmount();
  });
});

function sample(id: string, rowCount = 1): IntakeSample {
  return {
    table: { id, columns: [{ name: "category", type: "VARCHAR", category: "text" }], rowCount },
    rows: [{ category: "A" }],
  };
}

// issue #11b: `mergeWorkspaceSource`'s `prev` parameter is `WorkspaceSource[]`,
// which now carries override/validation/preview state alongside the sample --
// this helper fills in the same empty defaults `mergeWorkspaceSource` itself
// uses for a freshly-merged source, so these dedup-focused tests don't need
// to restate that shape at every call site.
function workspaceSource(sourceLabel: string, intakeSample: IntakeSample) {
  return {
    sourceLabel,
    sample: intakeSample,
    typeOverrides: [],
    validation: new Map(),
    previewRows: null,
    previewPending: false,
  };
}

// code review CRITICAL finding: `onComplete`'s dedup-by-table-id guard
// (App.tsx's `handleSourceComplete`) has no test path that actually forces
// a genuine duplicate call through rendered React -- extracted as a pure
// function specifically so this property is directly testable without one.
describe("mergeWorkspaceSource", () => {
  it("appends a source with a new table id", () => {
    const prev = [workspaceSource("a.csv", sample("a"))];
    const next = mergeWorkspaceSource(prev, "b.csv", sample("b"));
    expect(next.map((s) => s.sample.table.id)).toEqual(["a", "b"]);
  });

  it("is a no-op when the table id already exists -- the guarantee onComplete's dedup exists for", () => {
    const prev = [workspaceSource("a.csv", sample("a", 5))];
    // Same table.id, different rowCount/sourceLabel -- a genuine duplicate
    // onComplete call always carries the SAME registration's own sample, so
    // the dedup must key on identity (table.id) alone, not deep-equality.
    const next = mergeWorkspaceSource(prev, "a-again.csv", sample("a", 99));
    expect(next).toHaveLength(1);
    expect(next[0]).toBe(prev[0]);
  });

  it("does not mutate its input array", () => {
    const prev = [workspaceSource("a.csv", sample("a"))];
    mergeWorkspaceSource(prev, "b.csv", sample("b"));
    expect(prev).toHaveLength(1);
  });
});

// issue #11b, shape enumeration F8/ADV-5: a real UI-driven duplicate (the
// user re-picks a different category for the same column before the first
// change's validation query even resolves) must resolve deterministically,
// not depend on the order two async results happen to settle in.
describe("upsertOverride", () => {
  it("appends a new column's override", () => {
    const next = upsertOverride([], "amount", "number");
    expect(next).toEqual([{ column: "amount", category: "number" }]);
  });

  it("replaces (last-wins), not duplicates, an existing entry for the same column", () => {
    const prev = [{ column: "amount", category: "number" as const }];
    const next = upsertOverride(prev, "amount", "text");
    expect(next).toEqual([{ column: "amount", category: "text" }]);
  });

  it("leaves other columns' overrides untouched", () => {
    const prev = [
      { column: "amount", category: "number" as const },
      { column: "date", category: "date" as const },
    ];
    const next = upsertOverride(prev, "amount", "text");
    expect(next).toEqual([
      { column: "date", category: "date" },
      { column: "amount", category: "text" },
    ]);
  });

  it("does not mutate its input array", () => {
    const prev = [{ column: "amount", category: "number" as const }];
    upsertOverride(prev, "amount", "text");
    expect(prev).toEqual([{ column: "amount", category: "number" }]);
  });
});

// issue 11c, shape enumeration G1: `{}` (all three arrays missing) is
// Ajv-invalid; the three-empty-array shape below is the one legal "nothing
// configured yet" state `Query.builderState` accepts.
describe("emptyBuilderState", () => {
  it("returns all three arrays present and empty", () => {
    expect(emptyBuilderState()).toEqual({ filters: [], groupBy: [], measures: [] });
  });

  it("returns a fresh object each call (no shared-reference mutation across queries)", () => {
    const a = emptyBuilderState();
    const b = emptyBuilderState();
    expect(a).not.toBe(b);
    expect(a.filters).not.toBe(b.filters);
    expect(a.groupBy).not.toBe(b.groupBy);
    expect(a.measures).not.toBe(b.measures);
  });
});
