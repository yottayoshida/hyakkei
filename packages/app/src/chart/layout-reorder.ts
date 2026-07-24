// Grid layout editor: drag reorder (issue #14, F5). Pure array-index
// reordering + full repack -- no free placement, no resize. See
// docs/adr/0015-grid-interaction-library.md for why this is a thin
// custom implementation rather than react-grid-layout/@dnd-kit.
import type { LayoutItem } from "@hyakkei/schema";
import { packItems } from "./layout-placement.js";

/**
 * Moves the item at `fromIndex` to `toIndex` and re-packs the whole array
 * in the new order via `packItems` (first-fit shelf packing, same as new-
 * chart auto-placement) -- the output is always overlap-free and in-bounds
 * by construction, and never keyed by `chart` id (a duplicate id, possible
 * once F7's dashboard.json load path exists, would make an id-keyed reducer
 * ambiguous about which item moved).
 *
 * Fails closed (returns the SAME `items` reference, not a copy) on any
 * invalid input, rather than guessing an intent:
 * - `fromIndex` out of range or non-integer -- there is no item to move.
 * - `toIndex` non-integer -- no sensible destination.
 * - `toIndex` resolves (after clamping) to the same slot `fromIndex` is
 *   already in -- nothing would actually move (this also covers dragging
 *   past the last tile: `toIndex === items.length` and
 *   `toIndex === items.length - 1` both clamp to "last position").
 *
 * `toIndex` itself is clamped rather than rejected when out of range
 * (Security review): a drag that overshoots past the first/last tile
 * should still resolve to "move to that end", not silently do nothing.
 * `fromIndex` is validated by an async re-check at the caller (Security
 * review, TOCTOU): a chart add/delete between drag-start and drop can make
 * a `fromIndex` captured earlier stale by the time this runs, so callers
 * must re-derive `fromIndex` from the current `items` array at call time,
 * not from a value captured when the drag began.
 */
export function reorderLayout(
  items: LayoutItem[],
  fromIndex: number,
  toIndex: number,
  gridWidth: number,
): LayoutItem[] {
  if (!Number.isInteger(fromIndex) || fromIndex < 0 || fromIndex >= items.length) return items;
  if (!Number.isInteger(toIndex)) return items;

  const to = Math.max(0, Math.min(toIndex, items.length - 1));
  if (to === fromIndex) return items;

  // `items[fromIndex]` (not `splice`'s own return) -- `fromIndex` is already
  // validated in-range above, but `Array.prototype.splice`'s return type is
  // `T[]`, so destructuring it back out would widen to `T | undefined`.
  const moved = items[fromIndex]!;
  const reordered = items.slice();
  reordered.splice(fromIndex, 1);
  reordered.splice(to, 0, moved);
  return packItems(reordered, gridWidth);
}
