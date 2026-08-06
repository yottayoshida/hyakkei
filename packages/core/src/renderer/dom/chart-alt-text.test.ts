/** @vitest-environment jsdom */
import { describe, expect, it } from "vitest";
import { buildChartAltTextElement, normalizedAltText } from "./chart-alt-text.js";

describe("chart alternative text", () => {
  it("normalizes prose with the shared display-text sanitizer", () => {
    expect(normalizedAltText("  月別推移です。  ")).toBe("月別推移です。");
    expect(normalizedAltText("\u202e<script>alert(1)</script>\u202c")).toBe(
      "<script>alert(1)</script>",
    );
    expect(normalizedAltText("   ")).toBeUndefined();
  });

  it("builds one dir=auto visually-hidden paragraph with textContent", () => {
    const element = buildChartAltTextElement("<b>本文</b>");
    expect(element?.className).toBe("hyakkei-chart-alt-text");
    expect(element?.getAttribute("dir")).toBe("auto");
    expect(element?.textContent).toBe("<b>本文</b>");
    expect(element?.style.position).toBe("absolute");
    expect(element?.style.overflow).toBe("hidden");
  });

  it("omits blank prose", () => {
    expect(buildChartAltTextElement("\u202e\u202c")).toBeUndefined();
  });
});
