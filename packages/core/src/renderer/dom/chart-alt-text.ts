import { sanitizeDisplayText } from "./display-text.js";

/** Normalize author-provided chart prose at the renderer boundary. */
export function normalizedAltText(raw?: string): string | undefined {
  if (raw === undefined) return undefined;
  const text = sanitizeDisplayText(raw).text.trim();
  return text === "" ? undefined : text;
}

/**
 * Builds the non-visual DOM alternative used by table/stat charts. The text
 * is assigned through `textContent`, never parsed as HTML, and the inline
 * styles keep the contract self-contained for export and air-gapped viewers.
 */
export function buildChartAltTextElement(raw?: string): HTMLParagraphElement | undefined {
  const text = normalizedAltText(raw);
  if (text === undefined) return undefined;

  const element = document.createElement("p");
  element.className = "hyakkei-chart-alt-text";
  element.dir = "auto";
  element.textContent = text;
  Object.assign(element.style, {
    position: "absolute",
    width: "1px",
    height: "1px",
    padding: "0",
    margin: "-1px",
    overflow: "hidden",
    clip: "rect(0, 0, 0, 0)",
    whiteSpace: "nowrap",
    border: "0",
  });
  return element;
}
