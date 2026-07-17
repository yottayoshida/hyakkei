// @vitest-environment jsdom
// V-105 (missing encoding column) / V-106 (empty rows) / V-109 (unresolved
// layout reference, unconfigured chart, no layout items): mount() must never
// leave a blank grid slot (plan §非機能要件 可用性 "白画面にしない").
import type { Dashboard } from "@hyakkei/schema";
import * as echarts from "echarts";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as accessibleTable from "./accessible-table.js";
import { mount, unmount } from "./mount.js";
import { normalizeAuthoring, normalizeBaked } from "./render-model.js";
import type { RenderModel } from "./render-model.js";

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
