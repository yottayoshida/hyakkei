// Single-SPA editor shell (ADR-0010, issue #11a). `index.html` is now the
// product's sole entry -- the former separate intake.html/IntakeApp entry is
// embedded here directly, since DuckDB-WASM is in-memory and session-scoped
// (a page navigation would discard every registered table). Chart
// building/grid layout/guideline nudges still land in later M2 PRs
// (#11b/#11c/#12-16); this shell owns onboarding->workspace transition,
// accumulated `sources[]`, and the sample dashboard preview.
import { mount, normalizeBaked, unmount } from "@hyakkei/core/renderer";
import type { BakedDashboard } from "@hyakkei/schema";
import { Component, useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { getDuckDBHandleWithLayer } from "./data-layer.js";
import { IntakeApp } from "./intake/IntakeApp.js";
import { RegisteredSummary } from "./intake/RegisteredSummary.js";
import type { IntakeSample } from "./intake/types.js";

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
 *
 * Recovery from `hasError` is a `key` prop the PARENT assigns, not a method
 * on this class (issue #11a): React remounts (and re-initializes state for)
 * any component whose `key` changes, which is the standard, zero-extra-code
 * way to make an error boundary recoverable. No dashboard-swap feature
 * exists yet in this PR's scope (#11c) to exercise this organically -- this
 * PR's job is exporting the class (so it's directly unit-testable) and
 * wiring a `key` in `App()` below, so #11c's dashboard swap "just works"
 * without touching this class again.
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

/**
 * `RegisteredTable` (core) carries no display label (`{id, columns,
 * rowCount}` only, by design -- `identifier.ts`'s own doc: the sanitized
 * `id` is an internal DuckDB name, never shown on its own) -- the label the
 * user actually typed/dropped is tracked separately here, alongside the
 * sample, since `IntakeApp`'s `onComplete` callback hands both over
 * distinctly.
 */
type WorkspaceSource = { sourceLabel: string; sample: IntakeSample };

/**
 * Pure and exported so the one correctness property review couldn't verify
 * through `App()`'s rendered behavior alone -- deduping by `table.id` -- is
 * directly unit-testable without needing to reproduce a genuine duplicate
 * `onComplete` call through React (independent review, DeepWiki-verified:
 * React 18 StrictMode's dev-only effect double-invoke applies only at a
 * component's initial mount, and `IntakeApp`'s "registered" transition
 * always happens well after mount, via async file/DuckDB work -- so
 * StrictMode cannot actually double-fire THIS specific effect the way an
 * earlier version of this comment claimed). Kept as a defensive, cheap
 * idempotency guarantee regardless of how a duplicate call could arise
 * (a future `onComplete` caller bug, React internals, Fast Refresh) --
 * there is no legitimate case where the same `table.id` should ever
 * produce two workspace cards.
 */
export function mergeWorkspaceSource(
  prev: WorkspaceSource[],
  sourceLabel: string,
  sample: IntakeSample,
): WorkspaceSource[] {
  return prev.some((existing) => existing.sample.table.id === sample.table.id)
    ? prev
    : [...prev, { sourceLabel, sample }];
}

export function App() {
  const [sources, setSources] = useState<WorkspaceSource[]>([]);
  const [panelOpen, setPanelOpen] = useState(false);
  const [announcement, setAnnouncement] = useState<string | null>(null);
  // Shell-owned (mirror-review Major 3): every id this session has ever
  // reserved must outlive each individual `IntakeApp` mount ("add source"
  // mounts a fresh instance per attempt), so it lives here, not inside
  // IntakeApp. Injected into IntakeApp as a mutable `Set` -- the same
  // `.add()`/`.delete()` mutation style the prior internal ref used, only
  // its ownership moved. `useState`'s lazy initializer, not `useRef`
  // (react-hooks/refs): the `Set` instance is only ever read for its
  // stable IDENTITY (never for a "current value" that render logic
  // branches on), but `ref.current` is disallowed during render regardless
  // -- `useState`'s returned value carries the same one-time-created,
  // referentially-stable object without that restriction.
  const [usedIds] = useState<Set<string>>(() => new Set());

  const workspaceHeadingRef = useRef<HTMLHeadingElement>(null);
  // /simplify (Altitude): a real ref, not a DOM `id` string matched across
  // files -- the previous version relied on `IntakeApp.tsx` keeping a
  // literal `id="hyakkei-onboard-heading"` attribute in sync with this
  // file's own copy of the same string, a link TypeScript cannot verify.
  // Threaded down as a prop the same way `usedIds`/`onComplete` already are.
  const onboardHeadingRef = useRef<HTMLHeadingElement>(null);
  const addSourceButtonRef = useRef<HTMLButtonElement>(null);
  const panelContainerRef = useRef<HTMLDivElement>(null);
  const prevSourcesCountRef = useRef(0);
  const wasPanelOpenRef = useRef(false);

  // Without this, dropping a file OUTSIDE the intake UI's own bounds (its
  // `onDrop` only covers its own element) falls through to the browser's
  // native default: navigating the tab to open the dropped file, which
  // tears down this entire page -- discarding every table already
  // registered into DuckDB-WASM's in-memory, session-scoped database. Lives
  // at the shell level (moved from IntakeApp, issue #11a) so it protects the
  // whole workspace, not just the onboarding/panel intake surface. A native
  // `drop` handler only suppresses the browser default if the ALSO-native
  // `dragover` for that drop was itself prevented -- both are required.
  useEffect(() => {
    const preventDefault = (event: DragEvent) => event.preventDefault();
    window.addEventListener("dragover", preventDefault);
    window.addEventListener("drop", preventDefault);
    return () => {
      window.removeEventListener("dragover", preventDefault);
      window.removeEventListener("drop", preventDefault);
    };
  }, []);

  // Focus management across the transitions this shell drives (UX review,
  // SheetPickPanel's own focus-on-mount precedent): onboarding's FIRST
  // successful registration moves focus to the workspace's own heading
  // (0 -> >0); a source deletion that leaves others behind returns focus to
  // "データを追加" (a decreasing, still-positive count); deleting the LAST
  // remaining source returns to onboarding, whose heading a fresh
  // `IntakeApp` mount renders -- `onboardHeadingRef` (threaded down as a
  // prop) is what makes that heading reachable even though this component
  // remounts. All three keyed off the same previous-count ref so exactly
  // one branch fires per change.
  //
  // `!panelOpen` guards the "still others left" branch (code review P2 #3):
  // without it, deleting a source card while mid-interaction with the "add
  // source" panel would yank focus away from whatever the user was doing in
  // that panel, onto a button behind it.
  useEffect(() => {
    const prev = prevSourcesCountRef.current;
    const curr = sources.length;
    if (prev === 0 && curr > 0) {
      workspaceHeadingRef.current?.focus();
    } else if (curr === 0 && prev > 0) {
      onboardHeadingRef.current?.focus();
    } else if (curr < prev && curr > 0 && !panelOpen) {
      addSourceButtonRef.current?.focus();
    }
    prevSourcesCountRef.current = curr;
  }, [sources.length, panelOpen]);

  useEffect(() => {
    if (panelOpen) {
      panelContainerRef.current?.focus();
    } else if (wasPanelOpenRef.current) {
      addSourceButtonRef.current?.focus();
    }
    wasPanelOpenRef.current = panelOpen;
  }, [panelOpen]);

  const handleSourceComplete = useCallback((sourceLabel: string, sample: IntakeSample) => {
    setSources((prev) => mergeWorkspaceSource(prev, sourceLabel, sample));
    setAnnouncement(
      `「${sourceLabel}」を${sample.table.rowCount.toLocaleString("ja-JP")}行取り込みました。`,
    );
    setPanelOpen(false);
  }, []);

  const handleSourceDelete = useCallback(
    async (tableId: string, sourceLabel: string) => {
      try {
        const {
          layer,
          handle: { conn },
        } = await getDuckDBHandleWithLayer();
        // Best-effort, same discipline as the former IntakeApp `handleRedo`
        // (/code-review precedent): a failure here leaves one abandoned table
        // in DuckDB's in-memory catalog, not worth blocking the user's delete
        // action to report.
        await conn.query(`DROP TABLE IF EXISTS ${layer.datasource.quoteIdentifier(tableId)}`);
        usedIds.delete(tableId);
      } catch {
        // best-effort cleanup
      } finally {
        setSources((prev) => prev.filter((s) => s.sample.table.id !== tableId));
        setAnnouncement(`「${sourceLabel}」を削除しました。`);
      }
    },
    [usedIds],
  );

  const hasSources = sources.length > 0;

  // Rendered OUTSIDE either branch below (code review finding): deleting
  // the last remaining source flips `hasSources` back to `false` in the
  // SAME commit `setAnnouncement` fires in -- an announcement rendered only
  // inside the workspace branch would vanish the instant it would otherwise
  // appear, since that branch is exactly what stops existing at that
  // moment.
  const announcementRegion = announcement ? <p role="status">{announcement}</p> : null;

  if (!hasSources) {
    return (
      <>
        {announcementRegion}
        <IntakeApp
          mode="onboard"
          usedIds={usedIds}
          onComplete={handleSourceComplete}
          onboardHeadingRef={onboardHeadingRef}
        />
      </>
    );
  }

  return (
    <div style={{ maxWidth: 960, margin: "0 auto", padding: 24, fontFamily: "sans-serif" }}>
      <h1 ref={workspaceHeadingRef} tabIndex={-1} style={{ fontSize: 20 }}>
        データワークスペース
      </h1>
      {announcementRegion}

      {/* UX review (post-implementation, H-1): before #11a, index.html
          showed ONLY this sample -- no real user data ever shared the page
          with it, so there was nothing to mistake it FOR. #11a's own
          integration creates the confusing juxtaposition (a first-time,
          non-technical user's real data card sitting right next to a
          chart that looks equally authoritative but has nothing to do
          with it) -- a new risk this PR introduces, not one it merely
          inherits. The label goes ABOVE the chart (not a de-emphasized
          note below it, the prior placement) so it's read before the
          chart itself, and states plainly that this is not the user's
          own data -- directly protects the #16 five-minute-test's
          success criterion. */}
      <p style={{ color: "#6b7280", fontSize: 14, marginBottom: 4 }}>
        サンプル表示です。取り込んだデータではありません。グラフ作成機能は今後の更新で追加されます。
      </p>
      <div style={{ border: "1px dashed #d1d5db", borderRadius: 8, padding: 8 }}>
        <DashboardErrorBoundary key={SAMPLE_DASHBOARD.meta.title}>
          <DashboardPreview dashboard={SAMPLE_DASHBOARD} />
        </DashboardErrorBoundary>
      </div>

      {sources.map(({ sourceLabel, sample }) => (
        <RegisteredSummary
          key={sample.table.id}
          sourceLabel={sourceLabel}
          sample={sample}
          // The SAME stable callback reference passed to every card,
          // unchanged across renders (/simplify Efficiency finding --
          // `sources.map(...)` previously allocated a fresh closure per
          // card on every render, defeating memoization entirely).
          // `RegisteredSummary` is `memo`-wrapped, so a card whose own
          // props haven't changed now skips re-rendering when some OTHER
          // source is added/removed or `announcement` updates.
          onDelete={handleSourceDelete}
        />
      ))}

      <div style={{ marginTop: 16 }}>
        <button
          ref={addSourceButtonRef}
          type="button"
          onClick={() => setPanelOpen(true)}
          style={{
            minHeight: 44,
            padding: "0 16px",
            background: "#1a56db",
            color: "#fff",
            border: "none",
            borderRadius: 4,
          }}
        >
          データを追加
        </button>
      </div>

      {panelOpen && (
        <div ref={panelContainerRef} tabIndex={-1}>
          {/* code review P1 #1: without this, opening this panel was a
              dead end -- the only ways out were registering SOME source
              (even an unwanted one) or reloading (which, since DuckDB-WASM
              is in-memory, discards every already-registered source).
              Closing here is a plain `setPanelOpen(false)`, not routed
              through IntakeApp at all: an in-flight registration abandoned
              this way unmounts IntakeApp before its `onComplete` effect can
              ever see `phase === "registered"`, the same "closing mid-load
              acts as cancel" guarantee Δ6 already established. */}
          <div style={{ display: "flex", justifyContent: "flex-end" }}>
            <button
              type="button"
              onClick={() => setPanelOpen(false)}
              style={{ minHeight: 44, padding: "0 12px", background: "transparent" }}
            >
              閉じる
            </button>
          </div>
          <IntakeApp mode="panel" usedIds={usedIds} onComplete={handleSourceComplete} />
        </div>
      )}
    </div>
  );
}
