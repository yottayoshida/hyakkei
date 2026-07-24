// @vitest-environment jsdom
// V-105 (missing encoding column) / V-106 (empty rows) / V-109 (unresolved
// layout reference, unconfigured chart, no layout items): mount() must never
// leave a blank grid slot (plan §非機能要件 可用性 "白画面にしない").
import type { Chart, Dashboard, LayoutItem } from "@hyakkei/schema";
import * as echarts from "echarts";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as accessibleTable from "./accessible-table.js";
import { mount, patch, unmount } from "./mount.js";
import { normalizeAuthoring, normalizeBaked } from "./render-model.js";
import type { RenderChart, RenderModel, Row } from "./render-model.js";
import { buildEChartsTheme } from "../theme/echarts-theme.js";

// `echarts.init`'s named export is not directly `vi.spyOn`-able (ESM
// namespace properties from a real, non-Vitest-transformed package are
// non-configurable) -- wrapping it in `vi.fn(actual.init)` at mock-factory
// time is what makes `vi.mocked(echarts.init).mockImplementationOnce(...)`
// work in the "mount() resilience" describe block below, while every OTHER
// test in this file (which never touches the mock) still gets the real
// ECharts behavior unchanged.
vi.mock("echarts", async (importOriginal) => {
  const actual = await importOriginal<typeof import("echarts")>();
  return { ...actual, init: vi.fn(actual.init) };
});

// Same pattern as echarts above, for the "throw AFTER renderChartBody
// already returned successfully" orphan path (mount.ts's renderTile "ok"
// case) -- buildAccessibleDataTable is the only thing between a successful
// renderChartBody and buildTile ever attaching the canvas.
vi.mock("./accessible-table.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./accessible-table.js")>();
  return { ...actual, buildAccessibleDataTable: vi.fn(actual.buildAccessibleDataTable) };
});

function container(): HTMLElement {
  return document.createElement("div");
}

/**
 * A spyable ResizeObserver stand-in (unlike `resize-observer-stub.ts`'s
 * shared no-op, which the OTHER test files in this package use just to
 * unblock `mount()` from throwing) -- this file's own new tests need to
 * observe `observe()`/`disconnect()` call counts and manually fire the
 * registered callback (jsdom does no real layout, so a genuine resize
 * event never occurs here) to verify issue #68's own bookkeeping, not just
 * that `mount()` tolerates ResizeObserver's absence.
 */
class SpyableResizeObserver {
  static instances: SpyableResizeObserver[] = [];
  observeCalls = 0;
  disconnectCalls = 0;
  constructor(readonly callback: ResizeObserverCallback) {
    SpyableResizeObserver.instances.push(this);
  }
  observe(): void {
    this.observeCalls++;
    // Real ResizeObserver reports an initial size synchronously-ish on
    // observe() for an already-laid-out element (mount.ts's own `primed`
    // guard exists to absorb exactly this) -- jsdom never does real
    // layout, so this stand-in fires it itself to keep observe()'s
    // contract faithful; every `fire()` a test calls afterward is then a
    // genuine SECOND-or-later notification, same as in a real browser.
    this.callback([], this as unknown as ResizeObserver);
  }
  unobserve(): void {}
  disconnect(): void {
    this.disconnectCalls++;
  }
  fire(): void {
    this.callback([], this as unknown as ResizeObserver);
  }
}

function installSpyableResizeObserver(): void {
  SpyableResizeObserver.instances = [];
  (globalThis as unknown as { ResizeObserver: typeof SpyableResizeObserver }).ResizeObserver =
    SpyableResizeObserver;
}
installSpyableResizeObserver();

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

  it("sizes grid rows explicitly and lets the canvas flex inside the tile (real-browser collapse regression)", () => {
    // jsdom does no layout, so this can only pin the style *contract*, not
    // the rendered box: without an explicit `gridAutoRows` the grid's
    // implicit rows are content-sized, a canvas `height: 100%` of that
    // resolves to ~0, and the chart renders collapsed — invisible to every
    // test in this file, found only on real-browser verification. The
    // rendered-box counterpart of this pin belongs in the Playwright e2e
    // suite once the app is served there (M1/M3, playwright.config.ts).
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

    expect(el.style.gridAutoRows).not.toBe("");
    const tile = el.querySelector(".hyakkei-tile") as HTMLElement;
    expect(tile.style.display).toBe("flex");
    expect(tile.style.minHeight).toBe("0px");
    const canvas = el.querySelector(".hyakkei-chart-canvas") as HTMLElement;
    expect(canvas.style.flexGrow).toBe("1");
    // The collapsed form this replaces: 100% of an auto-height parent.
    expect(canvas.style.height).not.toBe("100%");
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

function twoChartModel(): RenderModel {
  return normalizeBaked({
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
      {
        id: "c2",
        type: "bar",
        encoding: { x: "cat", y: "val" },
        options: {},
        rows: [{ cat: "B", val: 2 }],
      },
    ],
    layout: {
      grid: "guidebook-12col",
      items: [
        { chart: "c1", x: 0, y: 0, w: 6, h: 4 },
        { chart: "c2", x: 6, y: 0, w: 6, h: 4 },
      ],
    },
  });
}

// Issue #69: per-tile blast-radius containment. Every test in this
// describe block asserts BOTH halves of the claim -- the thrown tile
// degrades AND its siblings are unaffected -- since either half alone
// (an error tile appears / two canvases exist) would also pass if the
// blast radius were actually the whole grid, just with different framing.
describe("mount() resilience (issue #69/#68)", () => {
  // Tests in THIS block (unlike the rest of the file) assert directly on
  // `SpyableResizeObserver.instances`' length -- every other test in this
  // file also calls mount() (and therefore registers an observer), so
  // without a fresh array before each test here, an assertion would see
  // leftover instances from whatever ran before it, including tests
  // outside this describe block entirely. Only beforeEach needs this: an
  // afterEach reset here would just get overwritten by the next test's own
  // beforeEach, and nothing outside this block ever reads `instances`
  // (/code-review (xhigh) finding).
  beforeEach(() => {
    SpyableResizeObserver.instances = [];
  });
  afterEach(() => {
    vi.restoreAllMocks();
    // /code-review (xhigh) finding: several tests below use fake timers --
    // a failed assertion before a test's own vi.useRealTimers() (or, for
    // the one test that restores mid-test to run its later assertions
    // under real timers, before that point) throws past it, leaking fake
    // timers into whatever test runs next. Safe to call unconditionally: a
    // no-op when real timers are already active.
    vi.useRealTimers();
  });

  it("a chart that throws during render degrades to an error tile without affecting sibling tiles", () => {
    const model = twoChartModel();
    // `vi.fn(actual.init)` (module-level mock factory above) runs the REAL
    // init unless overridden -- `mockImplementationOnce` fails only c1's
    // init call; c2's call automatically falls through to real ECharts.
    vi.mocked(echarts.init).mockImplementationOnce(() => {
      throw new Error("simulated ECharts init failure");
    });
    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const el = container();
    mount(el, model);

    expect(consoleErrorSpy).toHaveBeenCalledWith(
      'hyakkei: chart "c1" failed to render',
      expect.any(Error),
    );
    const tiles = el.querySelectorAll(".hyakkei-tile");
    expect(tiles).toHaveLength(2);
    expect(tiles[0]?.querySelector(".hyakkei-error-tile")).not.toBeNull();
    expect(tiles[0]?.querySelector(".hyakkei-chart-canvas")).toBeNull();
    // The sibling tile is what proves the blast radius stayed local.
    expect(tiles[1]?.querySelector(".hyakkei-chart-canvas")).not.toBeNull();
    expect(tiles[1]?.querySelector(".hyakkei-error-tile")).toBeNull();
  });

  // /code-review (xhigh) finding, confirmed independently by 4 review
  // angles: unlike the init-throw test above (no instance ever created,
  // nothing to leak), a THROW AFTER echarts.init succeeds used to leave
  // that instance orphaned -- init() registers it in ECharts' own
  // module-level registry before setOption runs, but the canvas holding it
  // never reached `container` (renderTileSafely discarded it), so
  // `unmount()`'s DOM-based lookup could never find it to dispose it.
  it("a setOption throw AFTER echarts.init succeeds disposes the orphaned instance instead of leaking it", async () => {
    const actualEcharts = await vi.importActual<typeof import("echarts")>("echarts");
    let capturedInstance: echarts.ECharts | undefined;
    vi.mocked(echarts.init).mockImplementationOnce((dom, theme, opts) => {
      const instance = actualEcharts.init(dom, theme, opts);
      capturedInstance = instance;
      vi.spyOn(instance, "setOption").mockImplementation(() => {
        throw new Error("simulated setOption failure");
      });
      return instance;
    });
    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const el = container();
    mount(el, twoChartModel());

    expect(consoleErrorSpy).toHaveBeenCalledWith(
      'hyakkei: chart "c1" failed to render',
      expect.any(Error),
    );
    expect(capturedInstance).toBeDefined();
    expect(capturedInstance!.isDisposed()).toBe(true);
  });

  // The OTHER orphan path (mount.ts's renderTile "ok" case): by the time
  // buildAccessibleDataTable runs, renderChartBody already returned a
  // canvas with a live, registered ECharts instance -- a throw here, before
  // buildTile ever attaches that canvas, is a distinct code path from the
  // setOption-throw test above (setOption throws INSIDE renderChartBody,
  // this throws AFTER it returns) and needs its own dispose call.
  it("an accessible-fallback throw AFTER renderChartBody already succeeded disposes the orphaned instance instead of leaking it", () => {
    vi.mocked(accessibleTable.buildAccessibleDataTable).mockImplementationOnce(() => {
      throw new Error("simulated accessible-fallback failure");
    });
    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const el = container();
    mount(el, twoChartModel());

    expect(consoleErrorSpy).toHaveBeenCalledWith(
      'hyakkei: chart "c1" failed to render',
      expect.any(Error),
    );
    // c1's echarts.init call is the mock's first recorded result -- its
    // real return value (vi.fn(actual.init) falls through to real ECharts).
    const firstInstance = vi.mocked(echarts.init).mock.results[0]?.value as
      echarts.ECharts | undefined;
    expect(firstInstance).toBeDefined();
    expect(firstInstance!.isDisposed()).toBe(true);
  });

  it("one chart instance's resize() throwing does not prevent the other instance from resizing", () => {
    const el = container();
    mount(el, twoChartModel());

    const canvases = el.querySelectorAll(".hyakkei-chart-canvas");
    const instance1 = echarts.getInstanceByDom(canvases[0] as HTMLElement)!;
    const instance2 = echarts.getInstanceByDom(canvases[1] as HTMLElement)!;
    vi.spyOn(instance1, "resize").mockImplementation(() => {
      throw new Error("simulated resize failure");
    });
    const resize2 = vi.spyOn(instance2, "resize");
    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    // Re-trigger the (debounced) resize pass via the observer this mount()
    // registered, rather than duplicating resizeAllCanvases's own logic --
    // this exercises the real ResizeObserver-driven path, not just the
    // post-attach one-shot resize from mount() itself.
    vi.useFakeTimers();
    SpyableResizeObserver.instances.at(-1)!.fire();
    vi.advanceTimersByTime(100);
    vi.useRealTimers();

    expect(consoleErrorSpy).toHaveBeenCalledWith("hyakkei: chart resize failed", expect.any(Error));
    expect(resize2).toHaveBeenCalled();
    // Both canvases still exist -- the throw was in resize(), not render.
    expect(el.querySelectorAll(".hyakkei-chart-canvas")).toHaveLength(2);
  });

  it("registers exactly one ResizeObserver per mount(), and disconnects it on unmount()", () => {
    const el = container();
    mount(el, twoChartModel());

    expect(SpyableResizeObserver.instances).toHaveLength(1);
    const observer = SpyableResizeObserver.instances[0]!;
    expect(observer.observeCalls).toBe(1);
    expect(observer.disconnectCalls).toBe(0);

    unmount(el);
    expect(observer.disconnectCalls).toBe(1);
  });

  it("remounting the SAME container disconnects the previous observer instead of accumulating a second one", () => {
    const el = container();
    mount(el, twoChartModel());
    const first = SpyableResizeObserver.instances[0]!;

    mount(el, twoChartModel());

    expect(SpyableResizeObserver.instances).toHaveLength(2);
    expect(first.disconnectCalls).toBe(1);
    const second = SpyableResizeObserver.instances[1]!;
    expect(second.disconnectCalls).toBe(0);
  });

  // /code-review (xhigh) Efficiency finding: a real ResizeObserver reports
  // an initial size on observe() (SpyableResizeObserver's own observe()
  // fires it automatically, same as a real browser) -- mount()'s one-shot
  // resizeAllCanvases() just before observeResize() already measured that
  // same initial size, so this notification must be absorbed, not queue a
  // second, redundant debounce timer.
  it("does not queue a debounce timer for the observer's own initial notification on observe()", () => {
    // Warm up ECharts OUTSIDE fake timers first: its lazy internal init can
    // itself queue a timer on a cold first run (same root cause as the
    // "unmounting while a debounced resize" test's baseline comment below)
    // -- unrelated to observeResize(), but indistinguishable from it if it
    // fires AFTER vi.useFakeTimers() starts counting.
    const warmup = container();
    mount(warmup, twoChartModel());
    unmount(warmup);

    vi.useFakeTimers();
    const baseline = vi.getTimerCount();

    const el = container();
    mount(el, twoChartModel());

    // mount() has already returned -- observe()'s initial notification
    // (fired synchronously by SpyableResizeObserver above) already ran.
    expect(vi.getTimerCount()).toBe(baseline);
  });

  it("debounces the observer callback: several rapid notifications trigger only one resize() batch", () => {
    vi.useFakeTimers();
    const el = container();
    mount(el, twoChartModel());
    const observer = SpyableResizeObserver.instances[0]!;

    const canvases = el.querySelectorAll(".hyakkei-chart-canvas");
    const instance = echarts.getInstanceByDom(canvases[0] as HTMLElement)!;
    const resizeSpy = vi.spyOn(instance, "resize");

    observer.fire();
    observer.fire();
    observer.fire();
    expect(resizeSpy).not.toHaveBeenCalled(); // debounced, not yet fired

    vi.advanceTimersByTime(100);
    expect(resizeSpy).toHaveBeenCalledTimes(1);
  });

  // Codex proxy R1 blind spot: resizeAllCanvases()'s own per-instance catch
  // (echarts.getInstanceByDom(canvas)?.resize()) makes a stale post-unmount
  // fire silently harmless (disposed instances drop out of ECharts' own
  // registry, so the optional chain just no-ops) -- a resize-call-count
  // assertion can't tell a cleared timer from one that fired into a no-op.
  // vi.getTimerCount() checks the timer itself, not its downstream effect.
  it("unmounting while a debounced resize is pending clears the timer, instead of leaving it to fire later", () => {
    vi.useFakeTimers();
    const el = container();
    mount(el, twoChartModel());
    const observer = SpyableResizeObserver.instances[0]!;

    // Baseline AFTER mount(), not 0 -- ECharts' own init/setOption can (in
    // isolation, e.g. this test's first cold run in a file/worker) queue a
    // fake timer of its own that's unrelated to this test's debounce timer.
    // Asserting against that baseline, not a literal 0, is what makes this
    // test's pass/fail track ONLY disconnectResize's own clearTimeout, not
    // an incidental count ECharts happens to leave behind.
    const baseline = vi.getTimerCount();

    observer.fire();
    expect(vi.getTimerCount()).toBeGreaterThan(baseline);

    unmount(el);
    expect(vi.getTimerCount()).toBe(baseline);
  });
});

// issue #70/#12(B): patch()'s differential-update path. Every "unchanged"
// test below deliberately reuses the SAME `RenderChart`/rows/theme object
// reference across two patch() calls (mirroring App.tsx's own established
// "unedited entries keep their prior reference" update pattern) -- a test
// that instead rebuilds an equal-looking-but-different object would prove
// nothing about reference-based reuse (V-015's own "contrast" test pins
// this the other way: a fresh reference is correctly treated as changed).
describe("patch()", () => {
  function barChart(id: string, rows: Row[], options: Record<string, unknown> = {}): RenderChart {
    return {
      id,
      chart: { id, type: "bar", encoding: { x: "cat", y: "val" }, options } as Chart,
      rows,
      state: "ok",
    };
  }

  function pieChart(id: string, rows: Row[]): RenderChart {
    return {
      id,
      chart: { id, type: "pie", encoding: { category: "cat", value: "val" }, options: {} } as Chart,
      rows,
      state: "ok",
    };
  }

  function tableChart(id: string, rows: Row[]): RenderChart {
    return {
      id,
      chart: { id, type: "table", encoding: { columns: ["cat", "val"] }, options: {} } as Chart,
      rows,
      state: "ok",
    };
  }

  function nonOkEntry(
    id: string,
    state: "empty" | "unconfigured" | "pending" | "error",
  ): RenderChart {
    return {
      id,
      chart: { id, type: "bar", encoding: { x: "cat", y: "val" }, options: {} } as Chart,
      rows: [],
      state,
    };
  }

  function item(id: string, x = 0, y = 0, w = 6, h = 4): LayoutItem {
    return { chart: id, x, y, w, h };
  }

  function model(
    charts: RenderChart[],
    items: LayoutItem[],
    theme = buildEChartsTheme("guidebook-blue", "light"),
  ): RenderModel {
    return { charts, layout: { grid: "guidebook-12col", items }, theme };
  }

  it("V-001: rows change on the same id+type re-renders via the same live instance, with no stale data", () => {
    const el = container();
    patch(el, model([barChart("c1", [{ cat: "A", val: 1 }])], [item("c1")]));
    const instance1 = echarts.getInstanceByDom(
      el.querySelector(".hyakkei-chart-canvas") as HTMLElement,
    );

    patch(
      el,
      model(
        [
          barChart("c1", [
            { cat: "B", val: 2 },
            { cat: "C", val: 3 },
          ]),
        ],
        [item("c1")],
      ),
    );
    const instance2 = echarts.getInstanceByDom(
      el.querySelector(".hyakkei-chart-canvas") as HTMLElement,
    );

    expect(instance2).toBe(instance1);
    const series = instance2!.getOption().series as Array<{ data: unknown[] }>;
    expect(series[0]!.data).toEqual([2, 3]);
  });

  it("V-002: reusing a surviving instance always calls setOption with {notMerge: true}", () => {
    const el = container();
    patch(el, model([barChart("c1", [{ cat: "A", val: 1 }])], [item("c1")]));
    const instance = echarts.getInstanceByDom(
      el.querySelector(".hyakkei-chart-canvas") as HTMLElement,
    )!;
    const setOptionSpy = vi.spyOn(instance, "setOption");

    patch(el, model([barChart("c1", [{ cat: "B", val: 2 }])], [item("c1")]));

    expect(setOptionSpy).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ notMerge: true }),
    );
  });

  it("V-003: same id, type change (bar -> pie) disposes the old instance and builds a new one, never reusing across types", () => {
    const el = container();
    patch(el, model([barChart("c1", [{ cat: "A", val: 1 }])], [item("c1")]));
    const oldInstance = echarts.getInstanceByDom(
      el.querySelector(".hyakkei-chart-canvas") as HTMLElement,
    )!;

    patch(el, model([pieChart("c1", [{ cat: "A", val: 1 }])], [item("c1")]));
    const newInstance = echarts.getInstanceByDom(
      el.querySelector(".hyakkei-chart-canvas") as HTMLElement,
    );

    expect(oldInstance.isDisposed()).toBe(true);
    expect(newInstance).not.toBe(oldInstance);
    expect(newInstance?.isDisposed()).toBeFalsy();
  });

  it("V-004: same id, ECharts type -> DOM type (bar -> table) disposes the instance and swaps to a table element", () => {
    const el = container();
    patch(el, model([barChart("c1", [{ cat: "A", val: 1 }])], [item("c1")]));
    const oldInstance = echarts.getInstanceByDom(
      el.querySelector(".hyakkei-chart-canvas") as HTMLElement,
    )!;

    patch(el, model([tableChart("c1", [{ cat: "A", val: 1 }])], [item("c1")]));

    expect(oldInstance.isDisposed()).toBe(true);
    expect(el.querySelector(".hyakkei-chart-canvas")).toBeNull();
    expect(el.querySelector("table")).not.toBeNull();
  });

  it.each([
    ["empty", "empty"] as const,
    ["unconfigured", "unconfigured"] as const,
    ["pending", "pending"] as const,
    ["error", "error"] as const,
  ])(
    "V-005: ok -> %s disposes the live instance and shows a message tile, not a stale canvas",
    (_label, state) => {
      const el = container();
      patch(el, model([barChart("c1", [{ cat: "A", val: 1 }])], [item("c1")]));
      const oldInstance = echarts.getInstanceByDom(
        el.querySelector(".hyakkei-chart-canvas") as HTMLElement,
      )!;

      patch(el, model([nonOkEntry("c1", state)], [item("c1")]));

      expect(oldInstance.isDisposed()).toBe(true);
      expect(el.querySelector(".hyakkei-chart-canvas")).toBeNull();
    },
  );

  // Phase 6-B (Codex adversarial test review, suggested test): the reverse
  // of V-005 -- a chart that WAS a message tile (no live instance at all)
  // resolving to "ok" must build a real, live canvas, not remain stuck
  // showing the stale message tile forever.
  it.each([["pending", "pending"] as const, ["error", "error"] as const])(
    "%s -> ok builds a live canvas, replacing the message tile",
    (_label, state) => {
      const el = container();
      patch(el, model([nonOkEntry("c1", state)], [item("c1")]));
      expect(el.querySelector(".hyakkei-chart-canvas")).toBeNull();

      patch(el, model([barChart("c1", [{ cat: "A", val: 1 }])], [item("c1")]));

      const canvas = el.querySelector(".hyakkei-chart-canvas");
      expect(canvas).not.toBeNull();
      expect(echarts.getInstanceByDom(canvas as HTMLElement)?.isDisposed()).toBeFalsy();
    },
  );

  it("V-006: the accessible fallback table is rebuilt (not stale) when reusing a live instance via setOption", () => {
    const el = container();
    patch(el, model([barChart("c1", [{ cat: "A", val: 1 }])], [item("c1")]));

    patch(el, model([barChart("c1", [{ cat: "B", val: 2 }])], [item("c1")]));

    const fallbackText = el.querySelector(".hyakkei-accessible-data-table")?.textContent ?? "";
    expect(fallbackText).toContain("B");
    expect(fallbackText).not.toContain("A");
  });

  it("V-007: a layout-only position/size change never touches the ECharts instance's OPTION (no init/setOption), but DOES resize() it, and the tile's grid placement actually updates", () => {
    const el = container();
    const entry = barChart("c1", [{ cat: "A", val: 1 }]); // built ONCE, reused by reference below
    patch(el, model([entry], [item("c1", 0, 0, 6, 4)]));
    const instance = echarts.getInstanceByDom(
      el.querySelector(".hyakkei-chart-canvas") as HTMLElement,
    )!;
    const tileBefore = el.querySelector(".hyakkei-tile") as HTMLElement;
    // Phase 6-B (Codex adversarial test review, Medium finding): pin the
    // ACTUAL style contract, not just "no ECharts call" -- a mutation that
    // silently skipped `tileStyle()` on the moved-only branch would
    // otherwise still pass this test.
    expect(tileBefore.style.gridColumn).toBe("1 / span 6");
    expect(tileBefore.style.gridRow).toBe("1 / span 4");
    vi.mocked(echarts.init).mockClear();
    const setOptionSpy = vi.spyOn(instance, "setOption");
    // Phase 6-C (Codex working-tree review, P0 fix verification): a w/h
    // change resizes this tile's own box without necessarily resizing
    // `container` itself, so the ResizeObserver on `container` won't fire --
    // the reused instance must be resized explicitly by patch() itself.
    const resizeSpy = vi.spyOn(instance, "resize");

    patch(el, model([entry], [item("c1", 6, 0, 6, 4)])); // same entry reference, moved only

    expect(vi.mocked(echarts.init)).not.toHaveBeenCalled();
    expect(setOptionSpy).not.toHaveBeenCalled();
    expect(resizeSpy).toHaveBeenCalledTimes(1);
    expect(echarts.getInstanceByDom(el.querySelector(".hyakkei-chart-canvas") as HTMLElement)).toBe(
      instance,
    );
    const tileAfter = el.querySelector(".hyakkei-tile") as HTMLElement;
    expect(tileAfter.style.gridColumn).toBe("7 / span 6");
    expect(tileAfter.style.gridRow).toBe("1 / span 4");
  });

  // QA Phase 8 finding (Minor): V-007's resize() assertion above only
  // varies x -- w/h is covered by `samePosition` comparing all 4 fields
  // together, but no test literally mutates w or h alone. This one does.
  it("V-008: a w/h-only layout change (x/y unchanged) still resize()s the reused instance", () => {
    const el = container();
    const entry = barChart("c1", [{ cat: "A", val: 1 }]);
    patch(el, model([entry], [item("c1", 0, 0, 6, 4)]));
    const instance = echarts.getInstanceByDom(
      el.querySelector(".hyakkei-chart-canvas") as HTMLElement,
    )!;
    vi.mocked(echarts.init).mockClear();
    const setOptionSpy = vi.spyOn(instance, "setOption");
    const resizeSpy = vi.spyOn(instance, "resize");

    patch(el, model([entry], [item("c1", 0, 0, 6, 8)])); // same x/y, h grows 4 -> 8

    expect(vi.mocked(echarts.init)).not.toHaveBeenCalled();
    expect(setOptionSpy).not.toHaveBeenCalled();
    expect(resizeSpy).toHaveBeenCalledTimes(1);
    expect(echarts.getInstanceByDom(el.querySelector(".hyakkei-chart-canvas") as HTMLElement)).toBe(
      instance,
    );
    const tileAfter = el.querySelector(".hyakkei-tile") as HTMLElement;
    expect(tileAfter.style.gridRow).toBe("1 / span 8");
  });

  it("V-009: a structural theme change triggers setOption on every live instance, with no dispose/init", () => {
    const el = container();
    const entry = barChart("c1", [{ cat: "A", val: 1 }]);
    patch(el, model([entry], [item("c1")], buildEChartsTheme("guidebook-blue", "light")));
    const instance = echarts.getInstanceByDom(
      el.querySelector(".hyakkei-chart-canvas") as HTMLElement,
    )!;
    vi.mocked(echarts.init).mockClear();
    const setOptionSpy = vi.spyOn(instance, "setOption");

    patch(el, model([entry], [item("c1")], buildEChartsTheme("guidebook-blue", "dark")));

    expect(vi.mocked(echarts.init)).not.toHaveBeenCalled();
    expect(setOptionSpy).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ notMerge: true }),
    );
  });

  it("V-010: a title-only change (same type/encoding/rows) still calls setOption -- never silently skipped", () => {
    const el = container();
    const rows = [{ cat: "A", val: 1 }];
    patch(el, model([barChart("c1", rows, { title: "A" })], [item("c1")]));
    const instance = echarts.getInstanceByDom(
      el.querySelector(".hyakkei-chart-canvas") as HTMLElement,
    )!;
    const setOptionSpy = vi.spyOn(instance, "setOption");

    patch(el, model([barChart("c1", rows, { title: "B" })], [item("c1")]));

    expect(setOptionSpy).toHaveBeenCalledWith(
      expect.objectContaining({ title: { text: "B" } }),
      expect.objectContaining({ notMerge: true }),
    );
  });

  it("V-011: adding a chart inits only the new id; removing it later disposes only that id, the survivor untouched throughout", () => {
    const el = container();
    const c1 = barChart("c1", [{ cat: "A", val: 1 }]);
    patch(el, model([c1], [item("c1")]));
    const instance1 = echarts.getInstanceByDom(
      el.querySelectorAll(".hyakkei-chart-canvas")[0] as HTMLElement,
    );

    const c2 = barChart("c2", [{ cat: "B", val: 2 }]);
    patch(el, model([c1, c2], [item("c1", 0), item("c2", 6)]));
    let canvases = el.querySelectorAll(".hyakkei-chart-canvas");
    expect(canvases).toHaveLength(2);
    expect(echarts.getInstanceByDom(canvases[0] as HTMLElement)).toBe(instance1);
    const instance2 = echarts.getInstanceByDom(canvases[1] as HTMLElement);
    expect(instance2?.isDisposed()).toBeFalsy();

    patch(el, model([c1], [item("c1")]));
    expect(instance2?.isDisposed()).toBe(true);
    canvases = el.querySelectorAll(".hyakkei-chart-canvas");
    expect(canvases).toHaveLength(1);
    expect(echarts.getInstanceByDom(canvases[0] as HTMLElement)).toBe(instance1);
  });

  // Phase 6-B (Codex adversarial test review, Medium finding): V-011 above
  // only covers removing a chart from BOTH `charts` and `layout.items`
  // together. Disposal is actually driven by which ids the CURRENT
  // `layout.items` walk visits (`processedIds`), independent of whether the
  // chart object itself still exists in `model.charts` -- a schema-valid
  // shape (a chart defined but not currently placed anywhere) that an
  // implementation keying removal off `charts` instead would get wrong.
  it("removing a chart from layout.items while it still exists in model.charts disposes its instance", () => {
    const el = container();
    const c1 = barChart("c1", [{ cat: "A", val: 1 }]);
    const c2 = barChart("c2", [{ cat: "B", val: 2 }]);
    patch(el, model([c1, c2], [item("c1", 0), item("c2", 6)]));
    const instance2 = echarts.getInstanceByDom(
      el.querySelectorAll(".hyakkei-chart-canvas")[1] as HTMLElement,
    )!;

    // c2 stays in `charts` but is no longer placed in `layout.items`.
    patch(el, model([c1, c2], [item("c1", 0)]));

    expect(instance2.isDisposed()).toBe(true);
    expect(el.querySelectorAll(".hyakkei-chart-canvas")).toHaveLength(1);
  });

  it("V-015: identical charts/rows/theme references across two patch() calls trigger zero init/dispose", () => {
    const el = container();
    const entry = barChart("c1", [{ cat: "A", val: 1 }]);
    const theme = buildEChartsTheme("guidebook-blue", "light");
    patch(el, model([entry], [item("c1")], theme));
    const instance = echarts.getInstanceByDom(
      el.querySelector(".hyakkei-chart-canvas") as HTMLElement,
    )!;
    vi.mocked(echarts.init).mockClear();
    const setOptionSpy = vi.spyOn(instance, "setOption");

    patch(el, model([entry], [item("c1")], theme));

    expect(vi.mocked(echarts.init)).not.toHaveBeenCalled();
    expect(setOptionSpy).not.toHaveBeenCalled();
    expect(echarts.getInstanceByDom(el.querySelector(".hyakkei-chart-canvas") as HTMLElement)).toBe(
      instance,
    );
  });

  it("V-015 (contrast): a fresh chart reference with equal-looking content is still treated as changed, not silently skipped", () => {
    const el = container();
    const rows = [{ cat: "A", val: 1 }];
    patch(el, model([barChart("c1", rows)], [item("c1")]));
    const instance = echarts.getInstanceByDom(
      el.querySelector(".hyakkei-chart-canvas") as HTMLElement,
    )!;
    const setOptionSpy = vi.spyOn(instance, "setOption");

    patch(el, model([barChart("c1", rows)], [item("c1")])); // new chart object, same rows reference

    expect(setOptionSpy).toHaveBeenCalled();
  });

  it("V-016: the same chart id appearing twice in layout.items degrades the whole container to a full rebuild, still rendering 2 correct canvases", () => {
    const el = container();
    const c1 = barChart("c1", [{ cat: "A", val: 1 }]);
    patch(el, model([c1], [item("c1")]));

    // Adversarial but schema-valid (shape enumeration A1): validateLayoutReferences
    // only checks dangling/out-of-bounds/overlap, never duplicate chart ids.
    patch(el, model([c1], [item("c1", 0, 0, 6, 4), item("c1", 6, 0, 6, 4)]));

    const canvases = el.querySelectorAll(".hyakkei-chart-canvas");
    expect(canvases).toHaveLength(2);
    for (const canvas of canvases) {
      expect(echarts.getInstanceByDom(canvas as HTMLElement)?.isDisposed()).toBeFalsy();
    }
  });

  // Codex review Round 1, P0 (Block): the FIRST duplicate-triggered rebuild
  // creates 2 live instances for "c1" but `held` (a Map, one entry per id)
  // can only track the LAST one -- the earlier instance would be silently
  // untouched by any tracked-instance disposal. Transitioning back to a
  // UNIQUE model afterward (which does NOT re-trigger the duplicate-degrade
  // branch, since that model has no duplicates of its own) must still
  // dispose every instance from the duplicate round, not just the tracked
  // one.
  it("Codex review P0: unique -> duplicate -> unique disposes EVERY duplicate-era instance, none leaked", () => {
    const el = container();
    const c1 = barChart("c1", [{ cat: "A", val: 1 }]);
    patch(el, model([c1], [item("c1")]));

    patch(el, model([c1], [item("c1", 0, 0, 6, 4), item("c1", 6, 0, 6, 4)]));
    const duplicateEraInstances = [...el.querySelectorAll(".hyakkei-chart-canvas")].map((canvas) =>
      echarts.getInstanceByDom(canvas as HTMLElement)!,
    );
    expect(duplicateEraInstances).toHaveLength(2);

    patch(el, model([c1], [item("c1")])); // back to unique -- no duplicate-degrade branch this time

    for (const instance of duplicateEraInstances) {
      expect(instance.isDisposed()).toBe(true);
    }
  });

  // Codex review Round 2: the R1 fix above only checked for duplicates
  // INSIDE the "prev exists" branch -- a duplicate model on the very FIRST
  // patch() call for a container (no `mountStates` entry at all yet) took
  // the untouched "!prev" branch, which still seeded `mountStates` from
  // `buildFullyFromScratch`'s own (necessarily incomplete, Map-based)
  // `held` map, reintroducing the identical leak from a different entry
  // point.
  it("Codex review R2: a duplicate chart id on the VERY FIRST patch() call for a container still disposes every instance on a later transition to unique", () => {
    const el = container();
    const c1 = barChart("c1", [{ cat: "A", val: 1 }]);

    // First-ever patch() call for this container, and it's already duplicated.
    patch(el, model([c1], [item("c1", 0, 0, 6, 4), item("c1", 6, 0, 6, 4)]));
    const duplicateEraInstances = [...el.querySelectorAll(".hyakkei-chart-canvas")].map((canvas) =>
      echarts.getInstanceByDom(canvas as HTMLElement)!,
    );
    expect(duplicateEraInstances).toHaveLength(2);

    patch(el, model([c1], [item("c1")])); // resolves to unique

    for (const instance of duplicateEraInstances) {
      expect(instance.isDisposed()).toBe(true);
    }
  });

  // Codex review Round 1, P1: patch()'s own "no previous mountStates"
  // branch previously called buildFullyFromScratch directly, whose first
  // action is container.replaceChildren() -- discarding whatever DOM nodes
  // (and their live ECharts instances) were already there WITHOUT disposing
  // them, unlike mount() itself (which always calls unmount() first).
  it("Codex review P1: patch() over a container previously driven by mount() disposes the old instance, not just discards its DOM node", () => {
    const el = container();
    mount(el, model([barChart("c1", [{ cat: "A", val: 1 }])], [item("c1")]));
    const oldInstance = echarts.getInstanceByDom(
      el.querySelector(".hyakkei-chart-canvas") as HTMLElement,
    )!;

    patch(el, model([barChart("c1", [{ cat: "B", val: 2 }])], [item("c1")]));

    expect(oldInstance.isDisposed()).toBe(true);
  });

  it('V-017: a "pending" chart shows a 計算中… tile, never "データがありません"', () => {
    const el = container();
    patch(el, model([nonOkEntry("c1", "pending")], [item("c1")]));

    expect(el.textContent).toContain("計算中…");
    expect(el.textContent).not.toContain("データがありません");
    expect(el.querySelector(".hyakkei-chart-canvas")).toBeNull();
  });

  it("V-018: patching the same chart id into two different containers keeps them independent -- unmounting one never disposes the other's instance", () => {
    const containerA = container();
    const containerB = container();
    const c1 = barChart("c1", [{ cat: "A", val: 1 }]);
    patch(containerA, model([c1], [item("c1")]));
    patch(containerB, model([c1], [item("c1")]));
    const instanceA = echarts.getInstanceByDom(
      containerA.querySelector(".hyakkei-chart-canvas") as HTMLElement,
    )!;
    const instanceB = echarts.getInstanceByDom(
      containerB.querySelector(".hyakkei-chart-canvas") as HTMLElement,
    )!;

    unmount(containerA);

    expect(instanceA.isDisposed()).toBe(true);
    expect(instanceB.isDisposed()).toBeFalsy();
  });

  it("V-020: a failed reuse removes the registry entry for that id -- the next patch() builds fresh instead of touching the disposed instance", () => {
    const el = container();
    patch(el, model([barChart("c1", [{ cat: "A", val: 1 }])], [item("c1")]));
    const firstInstance = echarts.getInstanceByDom(
      el.querySelector(".hyakkei-chart-canvas") as HTMLElement,
    )!;
    vi.spyOn(firstInstance, "setOption").mockImplementationOnce(() => {
      throw new Error("boom");
    });

    patch(el, model([barChart("c1", [{ cat: "B", val: 2 }])], [item("c1")]));
    expect(firstInstance.isDisposed()).toBe(true);
    expect(el.querySelector(".hyakkei-error-tile")).not.toBeNull();

    patch(el, model([barChart("c1", [{ cat: "C", val: 3 }])], [item("c1")]));
    const newInstance = echarts.getInstanceByDom(
      el.querySelector(".hyakkei-chart-canvas") as HTMLElement,
    );
    expect(newInstance).toBeDefined();
    expect(newInstance?.isDisposed()).toBeFalsy();
  });

  it('V-021: an "error" chart shows the same recovery-guidance copy (A) ChartPreview uses', () => {
    const el = container();
    patch(el, model([nonOkEntry("c1", "error")], [item("c1")]));

    expect(el.querySelector('[role="alert"]')?.textContent).toBe(
      "プレビューを表示できませんでした。集計の内容を確認してください。",
    );
  });

  it("V-022: a layout.items order change re-orders the DOM without touching either instance", () => {
    const el = container();
    const c1 = barChart("c1", [{ cat: "A", val: 1 }]);
    const c2 = barChart("c2", [{ cat: "B", val: 2 }]);
    patch(el, model([c1, c2], [item("c1", 0), item("c2", 6)]));
    const instance1 = echarts.getInstanceByDom(
      el.querySelectorAll(".hyakkei-chart-canvas")[0] as HTMLElement,
    )!;
    const instance2 = echarts.getInstanceByDom(
      el.querySelectorAll(".hyakkei-chart-canvas")[1] as HTMLElement,
    )!;

    // Same two items, order swapped in the array (each keeps its own x).
    patch(el, model([c1, c2], [item("c2", 6), item("c1", 0)]));

    const canvasesAfter = el.querySelectorAll(".hyakkei-chart-canvas");
    expect(echarts.getInstanceByDom(canvasesAfter[0] as HTMLElement)).toBe(instance2);
    expect(echarts.getInstanceByDom(canvasesAfter[1] as HTMLElement)).toBe(instance1);
    expect(instance1.isDisposed()).toBeFalsy();
    expect(instance2.isDisposed()).toBeFalsy();
  });

  // issue #14 (QA/Codex both flagged this as the top regression risk for
  // the grid layout editor's reorder feature): V-007 above only moves ONE
  // item's x while its array position stays the same slot; V-022 above only
  // swaps array order while EACH item keeps its own x. Neither covers what
  // `reorderLayout`+`packItems` (packages/app/src/chart/layout-reorder.ts)
  // actually produces on every reorder -- array order AND every affected
  // item's x/y changing in the SAME patch() call. This pins that the
  // position-only fast path still reuses both instances (no
  // dispose/init/setOption) and resizes both, even when it's also
  // reordering the DOM.
  it("V-023: an order change AND a position change on the SAME patch() call still reuses and resizes both instances, no setOption", () => {
    const el = container();
    const c1 = barChart("c1", [{ cat: "A", val: 1 }]);
    const c2 = barChart("c2", [{ cat: "B", val: 2 }]);
    patch(el, model([c1, c2], [item("c1", 0), item("c2", 6)]));
    const instance1 = echarts.getInstanceByDom(
      el.querySelectorAll(".hyakkei-chart-canvas")[0] as HTMLElement,
    )!;
    const instance2 = echarts.getInstanceByDom(
      el.querySelectorAll(".hyakkei-chart-canvas")[1] as HTMLElement,
    )!;
    vi.mocked(echarts.init).mockClear();
    const setOption1Spy = vi.spyOn(instance1, "setOption");
    const setOption2Spy = vi.spyOn(instance2, "setOption");
    const resize1Spy = vi.spyOn(instance1, "resize");
    const resize2Spy = vi.spyOn(instance2, "resize");

    // Array order swapped (c2 now first) AND both items' x swapped too --
    // exactly what reorderLayout+packItems produces for a 2-chart reorder.
    patch(el, model([c1, c2], [item("c2", 0), item("c1", 6)]));

    expect(vi.mocked(echarts.init)).not.toHaveBeenCalled();
    expect(setOption1Spy).not.toHaveBeenCalled();
    expect(setOption2Spy).not.toHaveBeenCalled();
    expect(resize1Spy).toHaveBeenCalledTimes(1);
    expect(resize2Spy).toHaveBeenCalledTimes(1);

    const canvasesAfter = el.querySelectorAll(".hyakkei-chart-canvas");
    expect(echarts.getInstanceByDom(canvasesAfter[0] as HTMLElement)).toBe(instance2);
    expect(echarts.getInstanceByDom(canvasesAfter[1] as HTMLElement)).toBe(instance1);
    expect(instance1.isDisposed()).toBeFalsy();
    expect(instance2.isDisposed()).toBeFalsy();

    const tilesAfter = el.querySelectorAll(".hyakkei-tile");
    expect((tilesAfter[0] as HTMLElement).style.gridColumn).toBe("1 / span 6");
    expect((tilesAfter[1] as HTMLElement).style.gridColumn).toBe("7 / span 6");
  });
});
