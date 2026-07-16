/** @vitest-environment jsdom */
import { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";

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

import { App } from "./App.js";

describe("app package scaffold", () => {
  it("exports a component", () => {
    expect(typeof App).toBe("function");
  });

  it("issue #55: unmount() runs with the mounted element when the component itself unmounts", async () => {
    // React detaches host refs (nulls .current) BEFORE passive-effect
    // cleanups run on unmount -- a cleanup that re-reads the ref instead of
    // closing over the element skips disposal in exactly this case, leaking
    // one ECharts instance per dashboard/tab switch. This test fails against
    // that implementation.
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    const host = document.createElement("div");
    document.body.appendChild(host);
    const root = createRoot(host);

    await act(async () => {
      root.render(<App />);
    });
    expect(mountSpy).toHaveBeenCalledTimes(1);
    const mountedElement = mountSpy.mock.calls[0]?.[0];
    expect(mountedElement).toBeInstanceOf(HTMLElement);

    await act(async () => {
      root.unmount();
    });
    expect(unmountSpy).toHaveBeenCalledWith(mountedElement);
  });

  // issue #64: the pre-existing "exports a component" test above only
  // asserts `typeof App === 'function'` -- it would pass even if App threw
  // on render or rendered nothing. This asserts the render itself, as an
  // explicit standalone check (not just implied by the issue #55 test's
  // mount-was-called assertions above). Real chart content (canvas/a11y
  // fallback table) comes from the mocked-away `mount()` -- that's core's
  // own test surface (mount.test.ts) and e2e's (e2e/scaffold.spec.ts,
  // which navigates the real built app), not this component's.
  it("render(<App/>) does not throw and produces a non-empty DOM tree", async () => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    const host = document.createElement("div");
    document.body.appendChild(host);
    const root = createRoot(host);

    await act(async () => {
      root.render(<App />);
    });
    expect(host.querySelector("div")).not.toBeNull();

    await act(async () => {
      root.unmount();
    });
  });
});
