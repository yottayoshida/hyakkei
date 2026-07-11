// Shared by mount.ts for every non-rendering state (dangling layout
// reference, missing encoding column, unconfigured chart, empty rows):
// textContent only (plan §設計方針 6 -- no innerHTML, no formatter-style
// interpolation), so a malicious title/column-name/message can never
// execute as markup here.
export type TileKind = "error" | "info";

export function buildMessageTile(message: string, kind: TileKind): HTMLElement {
  const tile = document.createElement("div");
  tile.className = kind === "error" ? "hyakkei-error-tile" : "hyakkei-info-tile";
  tile.setAttribute("role", kind === "error" ? "alert" : "status");
  tile.textContent = message;
  return tile;
}
