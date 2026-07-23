// Extracted from App.tsx (issue #12): both `DashboardPreview` (baked-only)
// and the new authoring-path `ChartPreview`/`AuthoringDashboardPreview`
// (chart/) need this same boundary. Living here (not in App.tsx) lets
// `chart/ChartBuilder.tsx` import it without a circular App.tsx <-> chart/
// dependency. Re-exported from App.tsx so existing imports (`./App.js`)
// keep working unchanged.
import { Component, type ReactNode } from "react";

/**
 * Last line of defense around a `mount()` call (issue #69): `mount.ts`'s own
 * `renderTileSafely`/`resizeAllCanvases` already isolate any single chart's
 * throw to that chart's own tile -- this boundary exists for whatever's
 * OUTSIDE that per-tile scope (`normalizeBaked`/`normalizeAuthoring` on an
 * unexpected shape, `buildOptions`, `gridStyle` itself) so a genuinely
 * unexpected error still degrades to a message instead of blanking the
 * whole app (React unmounts the entire tree past an uncaught render/effect-
 * phase error).
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
 *
 * Recovery from `hasError` is a `key` prop the PARENT assigns, not a method
 * on this class (issue #11a): React remounts (and re-initializes state for)
 * any component whose `key` changes, which is the standard, zero-extra-code
 * way to make an error boundary recoverable.
 */
export class DashboardErrorBoundary extends Component<
  { children: ReactNode },
  { hasError: boolean }
> {
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
