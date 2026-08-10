// PRD §7 acceptance ("100% of nudge rules pass on all gallery templates,
// CI check") and this PR's ADR-0016. That ADR settled this by reusing what
// existed -- "the 3 existing GOLDEN_SAMPLES (applications/budget/regional)
// already serve as the gallery, no new fixture directory is created for this"
// -- which held while the fixtures carried invented data. ADR-0021 splits the
// two: the published gallery is `../gallery-samples/` and runs this same
// acceptance in its own roundtrip test. These fixtures stay under the rule as
// well, since a rendering pin that trips a nudge is still an example nobody
// should copy.
import { describe, expect, it } from "vitest";
import { lookupRows } from "../renderer/render-model.js";
import { GOLDEN_SAMPLES } from "../golden-fixtures/sample-dashboards.js";
import { evaluateGuidelines, getGuidelineRules } from "./rules.js";

describe("guideline acceptance: every GOLDEN_SAMPLES chart passes every active rule", () => {
  // QA (Phase 8, vacuous-pass guard): pin the number of active rules AND the
  // number of charts actually evaluated -- an empty active-rule set or an
  // empty chart list would otherwise make the "0 nudges" assertion below
  // trivially, meaninglessly true.
  it("exactly 1 active rule exists (pie-too-many-slices) -- guards the assertion below against silently becoming vacuous", () => {
    const active = getGuidelineRules().filter((r) => r.status === "active");
    expect(active.map((r) => r.id)).toEqual(["pie-too-many-slices"]);
  });

  it("GOLDEN_SAMPLES collectively have at least 1 chart to evaluate (non-empty gallery)", () => {
    const totalCharts = GOLDEN_SAMPLES.reduce((sum, sample) => sum + sample.doc.charts.length, 0);
    expect(totalCharts).toBeGreaterThan(0);
  });

  describe.each(GOLDEN_SAMPLES)("golden sample '$id'", (sample) => {
    for (const chart of sample.doc.charts) {
      it(`chart '${chart.id}' (${chart.type}) produces 0 nudges`, () => {
        const rows = chart.query ? lookupRows(sample.rowsByQuery, chart.query) : [];
        expect(evaluateGuidelines(chart.type, rows)).toEqual([]);
      });
    }
  });

  // V-008: budget's pie ("budget-breakdown", 4 categories: 人件費/委託費/
  // 物件費/その他) is the one chart in the gallery that COULD trigger
  // pie-too-many-slices if the >6 threshold were ever narrowed -- pinned by
  // name so a future threshold change that breaks this specific fixture is
  // immediately traceable, not just a generic "some chart somewhere failed".
  it("budget's pie chart specifically has a safe margin under the >6 threshold (4 categories)", () => {
    const budget = GOLDEN_SAMPLES.find((s) => s.id === "budget");
    if (!budget) throw new Error("budget sample not found in GOLDEN_SAMPLES");
    const pie = budget.doc.charts.find((c) => c.type === "pie");
    if (!pie) throw new Error("budget sample has no pie chart");
    const rows = pie.query ? lookupRows(budget.rowsByQuery, pie.query) : [];
    expect(rows.length).toBe(4);
    expect(evaluateGuidelines(pie.type, rows)).toEqual([]);
  });
});
