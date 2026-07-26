import type { Theme } from "@hyakkei/schema";

/**
 * The one place `theme`'s default value is written (issue #15/F7 shape
 * enumeration, mirror (b)): before this, `AuthoringDashboardPreview.tsx`'s
 * own `THEME` constant (preview rendering) and this PR's new `theme` editor
 * state (persistence) would each hold an independently-written copy of the
 * same fact, the same "same value everywhere -- until it silently isn't"
 * risk `GRID_WIDTHS` (`@hyakkei/schema`'s `common.ts`) already exists to
 * avoid for grid width. Both call sites import this constant instead.
 */
export const DEFAULT_THEME: Theme = {
  tokens: "@digital-go-jp/design-tokens@2.0.1",
  palette: "guidebook-blue",
};
