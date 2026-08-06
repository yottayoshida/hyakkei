import { describe, expect, it } from "vitest";
import rawGuidelineRules from "./guideline-rules.json" with { type: "json" };
import { validateGuidelineRules } from "./rules.js";
import { GUIDEBOOK_SOURCE } from "./guidebook-source.js";

describe("GUIDEBOOK_SOURCE", () => {
  it("pins the publisher label and dated source record", () => {
    expect(GUIDEBOOK_SOURCE).toEqual({
      version: "v02",
      pdfUrl:
        "https://www.digital.go.jp/assets/contents/node/basic_page/field_ref_resources/1948e3cd-736a-4378-9e31-039b08d11106/2a3a0ebc/20260331_resources_dashboard-guidebook_guidebook_02.pdf",
      retrievedAt: "2026-08-02",
      sourceLastModified: "2026-07-17",
    });
  });

  it("keeps every shipped guidebook PDF citation on this versioned source", () => {
    const rules = validateGuidelineRules(rawGuidelineRules);
    const pdfCitations = rules.filter(({ citation }) => {
      const url = new URL(citation.url);
      return url.hostname === "www.digital.go.jp" && url.pathname.endsWith(".pdf");
    });

    expect(pdfCitations.length).toBeGreaterThan(0);
    for (const rule of pdfCitations) {
      expect(rule.citation.url.startsWith(`${GUIDEBOOK_SOURCE.pdfUrl}#`)).toBe(true);
      expect(rule.citation.label).toContain(GUIDEBOOK_SOURCE.version);
    }
  });
});
