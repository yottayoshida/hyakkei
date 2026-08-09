import type { LayoutItem } from "@hyakkei/schema";
import { packItems } from "./layout-placement.js";

const MIN_TILE_SIZE = 1;
const MAX_TILE_HEIGHT = 12;

/** Resizes one tile by integer deltas, then repacks every tile deterministically. */
export function resizeLayout(
  items: LayoutItem[],
  chartId: string,
  deltaW: number,
  deltaH: number,
  gridWidth: number,
): LayoutItem[] {
  if (!Number.isInteger(deltaW) || !Number.isInteger(deltaH)) return items;
  if (!Number.isInteger(gridWidth) || gridWidth < 1) return items;
  const index = items.findIndex((item) => item.chart === chartId);
  if (index === -1) return items;
  const current = items[index]!;
  const resized = items.slice();
  resized[index] = {
    ...current,
    w: Math.max(MIN_TILE_SIZE, Math.min(gridWidth, current.w + deltaW)),
    h: Math.max(MIN_TILE_SIZE, Math.min(MAX_TILE_HEIGHT, current.h + deltaH)),
  };
  try {
    return packItems(resized, gridWidth);
  } catch {
    return items;
  }
}
