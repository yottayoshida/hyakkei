// PR-C pixel-golden/narrow-viewport harness (e2e/pixel-golden/,
// e2e/golden-narrow-viewport.spec.ts). NOT part of `index.html`'s bundle
// (see golden.html + golden-main.tsx) -- it is the ONLY file in
// packages/app allowed to import `bake` (main `@hyakkei/core` barrel) and
// `@hyakkei/core/golden-fixtures`. `App.tsx`/`index.html` must stay
// confined to `@hyakkei/core/renderer`'s viewer-safe subpath (ADR-0005: "a
// viewer must import `@hyakkei/core/renderer`, NOT this file... duckdb-
// wasm/exceljs... have no reason to exist in a viewer bundle"). Keeping the
// harness on its own Vite entry point makes that boundary a build-graph
// fact instead of a hope that tree-shaking silently discards these imports
// from the real app's bundle (/simplify Altitude finding: it did, empirically
// verified via a dist string-marker check, but that's coincidental and
// unverified by any test -- unlike renderer/bundle-isolation.test.ts,
// which enforces the ./renderer subpath's own isolation as a real gate).
import { bake } from "@hyakkei/core";
import { GOLDEN_BAKE_META, GOLDEN_SAMPLES } from "@hyakkei/core/golden-fixtures";
import type { Appearance, BakedDashboard, Palette } from "@hyakkei/schema";
import { DashboardPreview } from "./App.js";

function goldenDashboardFromQuery(search: string): BakedDashboard {
  const params = new URLSearchParams(search);
  const sampleId = params.get("sample");
  if (!sampleId) throw new Error("golden harness: '?sample=<id>' query param is required");

  const sample = GOLDEN_SAMPLES.find((s) => s.id === sampleId);
  if (!sample) throw new Error(`golden harness: unknown sample id '${sampleId}'`);

  const appearance = (params.get("appearance") ?? undefined) as Appearance | undefined;
  const palette = (params.get("palette") ?? undefined) as Palette | undefined;
  const doc = {
    ...sample.doc,
    theme: {
      ...sample.doc.theme,
      ...(palette ? { palette } : {}),
      ...(appearance ? { appearance } : {}),
    },
  };
  return bake(doc, sample.rowsByQuery, GOLDEN_BAKE_META);
}

export function GoldenHarness() {
  const dashboard = goldenDashboardFromQuery(window.location.search);
  return <DashboardPreview dashboard={dashboard} />;
}
