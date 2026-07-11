// Real editor (file load, chart builder, guideline nudges, grid layout)
// lands in M2 (issues #11-#16). This is the thin preview wrapper plan §PR-B
// step 7 calls for: framework-independent `mount()` (packages/core/src/
// renderer/mount.ts) called from `useRef`+`useEffect` -- the same function
// the editor and export pipeline will call, not a React-specific
// reimplementation.
import { mount, normalizeBaked, unmount } from "@hyakkei/core/renderer";
import type { BakedDashboard } from "@hyakkei/schema";
import { useEffect, useRef } from "react";

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
  return <DashboardPreview dashboard={SAMPLE_DASHBOARD} />;
}
