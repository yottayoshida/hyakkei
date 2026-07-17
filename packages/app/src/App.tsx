// Real editor (file load, chart builder, guideline nudges, grid layout)
// lands in M2 (issues #11-#16). This is the thin preview wrapper plan §PR-B
// step 7 calls for: framework-independent `mount()` (packages/core/src/
// renderer/mount.ts) called from `useRef`+`useEffect` -- the same function
// the editor and export pipeline will call, not a React-specific
// reimplementation.
import { mount, normalizeBaked, unmount } from "@hyakkei/core/renderer";
import type { BakedDashboard } from "@hyakkei/schema";
import { Component, useEffect, useRef, type ReactNode } from "react";

/**
 * Last line of defense around `DashboardPreview`'s `mount()` call (issue
 * #69): `mount.ts`'s own `renderTileSafely`/`resizeAllCanvases` already
 * isolate any single chart's throw to that chart's own tile -- this
 * boundary exists for whatever's OUTSIDE that per-tile scope
 * (`normalizeBaked`/`normalizeAuthoring` on an unexpected shape,
 * `buildOptions`, `gridStyle` itself) so a genuinely unexpected error still
 * degrades to a message instead of blanking the whole app (React unmounts
 * the entire tree past an uncaught render/effect-phase error).
 *
 * Catches: synchronous throws during render and inside `useEffect`
 * callbacks (React's error-boundary contract explicitly covers effects,
 * unlike event handlers/`setTimeout`/`requestAnimationFrame`). Does NOT
 * catch: errors from event handlers, or ECharts' own internal async
 * scheduling (zrender timers/rAF) -- those run outside any React-managed
 * callback entirely, a residual risk this PR records rather than closes.
 *
 * The fallback render is deliberately static text only (no dynamic value
 * interpolation) -- this IS the "double-failure" containment plan calls
 * for: a fallback that can itself throw would need a second, nested
 * boundary to catch that, but a fallback with nothing to fail on doesn't.
 */
class DashboardErrorBoundary extends Component<{ children: ReactNode }, { hasError: boolean }> {
  state = { hasError: false };

  static getDerivedStateFromError(): { hasError: boolean } {
    return { hasError: true };
  }

  componentDidCatch(error: unknown): void {
    console.error("hyakkei: dashboard preview crashed", error);
  }

  render(): ReactNode {
    if (this.state.hasError) {
      // UX review (Phase 8): errorCopy.ts's own discipline elsewhere in this
      // repo is two-layer (what happened + what to do next) -- this fallback
      // had only the first layer. A second, still-static sentence (no
      // interpolation, so the "double-failure containment" comment above
      // still holds) closes that gap without adding a new failure surface.
      return (
        <div role="alert">
          ダッシュボードを表示できませんでした。お手数ですが、ページを再読み込みしてください。
        </div>
      );
    }
    return this.props.children;
  }
}

export type DashboardPreviewProps = { dashboard: BakedDashboard };

export function DashboardPreview({ dashboard }: DashboardPreviewProps) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // The cleanup closes over the element, never re-reads the ref: React
    // detaches host refs (sets `.current` to null) during the commit
    // mutation phase BEFORE passive-effect cleanups run on unmount, so a
    // `containerRef.current` read inside the cleanup skips disposal in
    // exactly the case it exists for -- this component unmounting
    // (tab/dashboard switch in a future M2 editor). The dep-change path
    // happens to keep refs attached, which masked that gap (issue #55).
    // `mount()`'s own internal cleanup only covers *remounting the same
    // container* (a new `dashboard` prop) -- without this cleanup, every
    // unmount leaks the ECharts instance's event listeners and zrender
    // scheduling (/simplify Efficiency finding).
    const container = containerRef.current;
    if (!container) return;
    mount(container, normalizeBaked(dashboard));
    return () => unmount(container);
  }, [dashboard]);

  return <div ref={containerRef} />;
}

const SAMPLE_DASHBOARD: BakedDashboard = {
  version: 1,
  meta: {
    title: "サンプルダッシュボード",
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
      options: { title: "区分別申請額" },
      rows: [
        { category: "建築", total: 120 },
        { category: "農地", total: 90 },
        { category: "その他", total: 45 },
      ],
    },
  ],
  layout: { grid: "guidebook-12col", items: [{ chart: "c1", x: 0, y: 0, w: 6, h: 6 }] },
};

export function App() {
  return (
    <DashboardErrorBoundary>
      <DashboardPreview dashboard={SAMPLE_DASHBOARD} />
    </DashboardErrorBoundary>
  );
}
