// Auto-placement for newly created charts (issue #12, plan §自動レイアウト配置).
// Deterministic first-fit shelf packing -- same chart set always produces
// the same layout (no randomness), reading order left-to-right, top-to-bottom.
// Correctness (no overlap, no out-of-bounds) is verified against the schema's
// own public oracle (`validateDashboardReferences`), not re-implemented here.
import {
  MAX_LAYOUT_Y,
  rectsOverlap,
  type ChartVariant,
  type LayoutItem,
  type Rect,
} from "@hyakkei/schema";

/**
 * One fixed default size per chart type (plan §自動レイアウト配置, tunable
 * during /develop Phase 4 UI verification). `table`/`stat` intentionally
 * differ from the 5 ECharts-backed types: a table reads better full-width,
 * a stat tile is a small single number.
 */
export const CHART_DEFAULT_SIZE: Record<ChartVariant["type"], { w: number; h: number }> = {
  bar: { w: 6, h: 6 },
  line: { w: 6, h: 6 },
  area: { w: 6, h: 6 },
  scatter: { w: 6, h: 6 },
  pie: { w: 4, h: 4 },
  table: { w: 12, h: 6 },
  stat: { w: 3, h: 2 },
};

/**
 * First-fit shelf packing: scans rows top-to-bottom, each row left-to-right,
 * and returns the first (x, y) where a `w`x`h` box fits without overlapping
 * any existing item and without exceeding the grid's width. `w` is clamped
 * to `gridWidth` defensively (a `CHART_DEFAULT_SIZE` wider than the grid
 * would otherwise never find a fit and loop forever). Overlap check reuses
 * the schema's own `rectsOverlap` (`/simplify` Reuse finding) rather than a
 * second, independently-drifting copy of the same formula.
 */
export function nextFreeCell(
  items: LayoutItem[],
  w: number,
  h: number,
  gridWidth: number,
): { x: number; y: number } {
  const clampedW = Math.min(w, gridWidth);
  // issue #14 (Security review): `w`/`gridWidth` are currently always finite,
  // in-range values from CHART_DEFAULT_SIZE/GRID_WIDTHS -- but reorder (this
  // PR) increases how often this runs, and a future F7 (dashboard.json load,
  // not yet implemented) could feed a hand-edited, out-of-range `w` straight
  // through. A non-finite/sub-1 `clampedW` would otherwise make the inner
  // loop's condition permanently false and spin `y` forever (a client-side
  // hang). Fail fast instead of hanging.
  if (!Number.isInteger(clampedW) || clampedW < 1) {
    throw new RangeError(`nextFreeCell: invalid width (w=${w}, gridWidth=${gridWidth})`);
  }
  for (let y = 0; y <= MAX_LAYOUT_Y; y++) {
    for (let x = 0; x + clampedW <= gridWidth; x++) {
      const candidate: Rect = { x, y, w: clampedW, h };
      if (!items.some((item) => rectsOverlap(candidate, item))) return { x, y };
    }
  }
  throw new RangeError("nextFreeCell: no free cell within grid bounds");
}

/**
 * Re-packs a full, ordered `LayoutItem[]` from scratch (issue #14, reorder):
 * each item keeps its own `chart`/`w`/`h`, but `x`/`y` are recomputed via
 * `nextFreeCell` against only the items already placed earlier in the
 * array -- the same first-fit shelf packing a single new chart already gets
 * (`handleAddChart`), just run once per item in the caller's chosen order.
 * The result is always overlap-free and in-bounds by construction, so a
 * reorder can never reintroduce a layout the schema's own oracle
 * (`validateLayoutReferences`) would reject.
 */
export function packItems(orderedItems: LayoutItem[], gridWidth: number): LayoutItem[] {
  const packed: LayoutItem[] = [];
  for (const item of orderedItems) {
    const { x, y } = nextFreeCell(packed, item.w, item.h, gridWidth);
    packed.push({ ...item, x, y });
  }
  return packed;
}
