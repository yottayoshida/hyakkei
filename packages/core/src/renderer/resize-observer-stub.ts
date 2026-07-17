// jsdom has no native ResizeObserver (a longstanding jsdom gap, not a
// polyfill this project needs to ship for real browsers -- every target
// browser has it natively). Any test that calls mount()/unmount() needs
// this installed first, or `new ResizeObserver(...)` inside mount.ts's
// `observeResize` throws `ReferenceError: ResizeObserver is not defined`.
//
// A no-op stub is correct for THIS package's unit tests: they exist to
// verify render/dispose/catch logic, not real resize-detection behavior --
// jsdom does no layout at all, so a real resize callback firing here would
// be unobservable anyway. Actual resize-follows-container coverage lives
// in e2e (real browser, real layout): e2e/golden-narrow-viewport.spec.ts
// and the mount-resilience e2e added alongside this stub (issue #68).
export class ResizeObserverStub {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}

export function installResizeObserverStub(): void {
  (globalThis as unknown as { ResizeObserver: typeof ResizeObserverStub }).ResizeObserver =
    ResizeObserverStub;
}
