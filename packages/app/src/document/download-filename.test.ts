import { describe, expect, it } from "vitest";
import { downloadFilename } from "./download-filename.js";

const NOW = new Date(2026, 6, 26, 15, 32); // 2026-07-26T15:32 local

describe("downloadFilename", () => {
  it("appends a local-time YYYYMMDD-HHmm timestamp and .json", () => {
    expect(downloadFilename("月次KPI", NOW)).toBe("月次KPI_20260726-1532.json");
  });

  it("preserves CJK text (unlike generateSourceId's sanitizer)", () => {
    expect(downloadFilename("令和6年度予算", NOW)).toBe("令和6年度予算_20260726-1532.json");
  });

  it("preserves emoji", () => {
    expect(downloadFilename("進捗📊レポート", NOW)).toBe("進捗📊レポート_20260726-1532.json");
  });

  it("strips path separators", () => {
    expect(downloadFilename("a/b\\c", NOW)).toBe("abc_20260726-1532.json");
  });

  it("does not let a title of only dots produce a bare-extension name", () => {
    const result = downloadFilename("..", NOW);
    expect(result).not.toBe(".json");
    expect(result.startsWith("dashboard")).toBe(true);
  });

  it("strips C0 control characters (U+0000-U+001F)", () => {
    expect(downloadFilename("a b", NOW)).toBe("a b_20260726-1532.json");
  });

  it("strips Unicode bidi-control characters (RTL override extension-spoofing)", () => {
    // "evil" + U+202E + "gpj.exe" would DISPLAY as "evil.exe.jpg" if the
    // override character survived into the downloaded filename. Written as
    // an explicit \u escape, not a literal invisible character in the
    // source, for the same reason download-filename.ts's own regex is.
    const spoofed = "evil" + "\u202e" + "gpj.exe";
    expect(downloadFilename(spoofed, NOW)).toBe("evilgpj.exe_20260726-1532.json");
  });

  // issue #15/F7, Codex Round 1 P1: U+061C ARABIC LETTER MARK is a
  // Bidi_Control=Yes character the original range omitted.
  it("strips U+061C ARABIC LETTER MARK", () => {
    expect(downloadFilename("a\u061cb", NOW)).toBe("ab_20260726-1532.json");
  });

  it("truncates to 60 characters before the timestamp suffix", () => {
    const longTitle = "あ".repeat(200);
    const result = downloadFilename(longTitle, NOW);
    const [name] = result.split("_20260726");
    expect(name).toHaveLength(60);
  });

  // issue #15/F7, Codex Round 1 P2: String.prototype.slice counts UTF-16
  // code units, so a naive 60-unit truncation could split a surrogate pair
  // (emoji) in half, leaving a lone surrogate in the filename.
  it("does not split a surrogate pair (emoji) at the 60-codepoint truncation boundary", () => {
    const title = "a".repeat(59) + "\ud83d\ude00"; // 59 ASCII + 1 emoji = exactly 60 code points
    const result = downloadFilename(title, NOW);
    const name = result.split("_20260726")[0] ?? "";
    expect(name).toBe(title);
    // A lone surrogate (half of a split pair) would fail this -- a high
    // surrogate with no following low surrogate, or vice versa.
    expect(name).not.toMatch(
      /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u,
    );
  });

  it("falls back to 'dashboard' for an empty title", () => {
    expect(downloadFilename("", NOW)).toBe("dashboard_20260726-1532.json");
  });

  it("falls back to 'dashboard' for a whitespace-only title", () => {
    expect(downloadFilename("   ", NOW)).toBe("dashboard_20260726-1532.json");
  });

  it("collapses internal runs of whitespace", () => {
    expect(downloadFilename("月次   KPI", NOW)).toBe("月次 KPI_20260726-1532.json");
  });
});
