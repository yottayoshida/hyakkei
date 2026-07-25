import { afterEach, describe, expect, it, vi } from "vitest";
import type { Row } from "../renderer/render-model.js";
import { evaluateGuidelines, getGuidelineRules, validateGuidelineRules } from "./rules.js";

function pieRows(n: number): Row[] {
  return Array.from({ length: n }, (_, i) => ({ category: `cat-${i}`, value: i + 1 }));
}

describe("evaluateGuidelines: pie-too-many-slices", () => {
  // V-001: 6/7 boundary.
  it.each([5, 6])("does NOT nudge at %s slices (<=6)", (n) => {
    expect(evaluateGuidelines("pie", pieRows(n))).toEqual([]);
  });

  it.each([7, 8])("nudges at %s slices (>6)", (n) => {
    const nudges = evaluateGuidelines("pie", pieRows(n));
    expect(nudges).toHaveLength(1);
    expect(nudges[0]?.ruleId).toBe("pie-too-many-slices");
  });

  // V-002: empty result.
  it("does not nudge on an empty result", () => {
    expect(evaluateGuidelines("pie", [])).toEqual([]);
  });

  // V-003: single row.
  it("does not nudge on a single row", () => {
    expect(evaluateGuidelines("pie", pieRows(1))).toEqual([]);
  });

  // V-017: CHART_ROW_LIMIT-truncated result (5000 cap) does not break the count.
  it("still nudges correctly against a 5000-row (truncated-limit-sized) result", () => {
    expect(evaluateGuidelines("pie", pieRows(5000))).toHaveLength(1);
  });

  // V-018 (Codex②): duplicate category values across rows still count as
  // separate wedges (rows.length, not distinct-category count) -- this is
  // the visual-clutter concern the rule targets, matching pieOption()'s own
  // 1-row-1-wedge rendering (build-options.ts).
  it("counts duplicate-category rows as separate slices (rows.length, not distinct count)", () => {
    const rows: Row[] = Array.from({ length: 7 }, () => ({ category: "同じ分類", value: 1 }));
    expect(evaluateGuidelines("pie", rows)).toHaveLength(1);
  });

  // Non-pie charts never fire this rule, regardless of row count.
  it("does not fire for a non-pie chart type", () => {
    expect(evaluateGuidelines("bar", pieRows(10))).toEqual([]);
  });

  // V-015: null/empty category values still produce a row -- and thus a
  // wedge -- so they count toward the slice total the same as any other row.
  it("counts rows with null/empty category values toward the slice total", () => {
    const rows: Row[] = [...pieRows(5), { category: null, value: 1 }, { category: "", value: 1 }];
    expect(evaluateGuidelines("pie", rows)).toHaveLength(1);
  });
});

describe("getGuidelineRules / validateGuidelineRules", () => {
  it("the real guideline-rules.json validates without throwing", () => {
    expect(() => getGuidelineRules()).not.toThrow();
    expect(getGuidelineRules().length).toBeGreaterThan(0);
  });

  it("exactly 1 active rule (pie-too-many-slices) and 3 doc-only rules in the real file", () => {
    const rules = getGuidelineRules();
    const active = rules.filter((r) => r.status === "active");
    const docOnly = rules.filter((r) => r.status === "doc-only");
    expect(active.map((r) => r.id)).toEqual(["pie-too-many-slices"]);
    expect(docOnly.map((r) => r.id).sort()).toEqual(
      ["3d-anything", "palette-order", "truncated-axis"].sort(),
    );
  });

  // Codex 6-B (test adversarial review, Blind Spot 5): pins the production
  // threshold value itself, not just the boundary BEHAVIOR against a
  // hand-written fixture rule elsewhere in this file -- a future edit to
  // guideline-rules.json changing 6 to some other number would otherwise
  // pass every boundary test above (they'd just shift with it) without
  // anything failing to say the real file's threshold actually changed.
  it("the real pie-too-many-slices rule has threshold: 6", () => {
    const rule = getGuidelineRules().find((r) => r.id === "pie-too-many-slices");
    expect(rule?.threshold).toBe(6);
  });

  // V-021: an active rule with no registered predicate must fail CI (fail-closed).
  it("throws when a status:active rule has no registered predicate", () => {
    expect(() =>
      validateGuidelineRules([
        {
          id: "not-a-real-predicate",
          status: "active",
          severity: "warning",
          message: "x",
          citation: { label: "x", url: null },
        },
      ]),
    ).toThrow(/no predicate is registered/);
  });

  it("throws on a duplicate rule id", () => {
    const rule = {
      id: "dup",
      status: "doc-only",
      severity: "warning",
      message: "x",
      citation: { label: "x", url: null },
    };
    expect(() => validateGuidelineRules([rule, rule])).toThrow(/duplicate rule id/);
  });

  it("throws on an unknown status", () => {
    expect(() =>
      validateGuidelineRules([
        {
          id: "x",
          status: "enabled",
          severity: "warning",
          message: "x",
          citation: { label: "x", url: null },
        },
      ]),
    ).toThrow(/unknown status/);
  });

  it("throws when citation.url is neither a string nor null", () => {
    expect(() =>
      validateGuidelineRules([
        {
          id: "x",
          status: "doc-only",
          severity: "warning",
          message: "x",
          citation: { label: "x", url: 42 },
        },
      ]),
    ).toThrow(/citation\.url/);
  });

  it("throws on a negative/non-integer threshold", () => {
    expect(() =>
      validateGuidelineRules([
        {
          id: "x",
          status: "doc-only",
          severity: "warning",
          message: "x",
          citation: { label: "x", url: null },
          threshold: -1,
        },
      ]),
    ).toThrow(/threshold/);
  });

  it("throws when the top-level value is not an array", () => {
    expect(() => validateGuidelineRules({ id: "x" })).toThrow(/expected an array/);
  });

  // V-020, Codex 6-B (test adversarial review, false-confidence finding):
  // the earlier version of this test only re-implemented getGuidelineRules'
  // own try/catch shape by hand and asserted against ITS OWN copy -- a
  // mutation deleting the real catch/fallback in rules.ts would still pass
  // that test, since the real function was never actually called with bad
  // input. This exercises `getGuidelineRules()` itself: mocks the imported
  // JSON module to malformed content, resets the module registry (fresh
  // `cachedRules` state), and calls the REAL function through a dynamic
  // re-import -- same technique as palette.test.ts's own
  // `vi.doMock`+`vi.resetModules()` convention for testing a module-level
  // cache against injected-bad upstream data.
  describe("getGuidelineRules(): fail-open against a malformed rules file", () => {
    afterEach(() => {
      vi.doUnmock("./guideline-rules.json");
    });

    it("returns [] (not a throw) when the underlying JSON is structurally invalid", async () => {
      vi.resetModules();
      vi.doMock("./guideline-rules.json", () => ({ default: { not: "an array" } }));
      const fresh = await import("./rules.js");
      let rules: unknown[] = [{ sentinel: true }];
      expect(() => {
        rules = fresh.getGuidelineRules();
      }).not.toThrow();
      expect(rules).toEqual([]);
    });

    it("returns [] when an active rule has no registered predicate (same fail-open path)", async () => {
      vi.resetModules();
      vi.doMock("./guideline-rules.json", () => ({
        default: [
          {
            id: "not-a-real-predicate",
            status: "active",
            severity: "warning",
            message: "x",
            citation: { label: "x", url: null },
          },
        ],
      }));
      const fresh = await import("./rules.js");
      expect(fresh.getGuidelineRules()).toEqual([]);
    });
  });
});
