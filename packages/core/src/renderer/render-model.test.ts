import type { BakedDashboard, Dashboard } from "@hyakkei/schema";
import { describe, expect, it } from "vitest";
import { normalizeAuthoring, normalizeBaked } from "./render-model.js";

// issue #124. The footer's own builders are pinned in dom/dashboard-footer.test.ts;
// this file pins the WIRING, which is where the PR's claim actually lives.
//
// The distinction is not academic. A test that calls `authoringProvenance()`
// directly proves that helper never returns a `recorded` item — and stays green
// while the call site maps every item to `recorded` on the way out. Adversarial
// review found four such mutants surviving the whole 660-test suite, all of
// them at these two functions, precisely because every assertion pointed at the
// pieces rather than at the seam between them.
const theme = { tokens: "@digital-go-jp/design-tokens@2.0.1", palette: "guidebook-blue" } as const;

const bakedDoc = (meta: Record<string, unknown> = {}): BakedDashboard =>
  ({
    version: 1,
    meta: {
      title: "t",
      generatedAt: "2026-08-02T09:00:00Z",
      sourceDataAsOf: "2026-07-10",
      hyakkeiVersion: "0.1.0",
      ...meta,
    },
    theme,
    charts: [],
    layout: { grid: "guidebook-12col", items: [] },
  }) as BakedDashboard;

const authoringDoc = (meta: Record<string, unknown> = {}): Dashboard =>
  ({
    version: 1,
    meta: { title: "t", ...meta },
    theme,
    sources: [],
    queries: [],
    charts: [],
    layout: { grid: "guidebook-12col", items: [] },
  }) as Dashboard;

describe("normalizeBaked wires provenance into every render model", () => {
  it("emits a footer for a baked document whose author declared nothing", () => {
    // The PR's headline claim, asserted where it is established: the three
    // stamps are `required` on `BakedMeta`, so there is no baked document for
    // which this can be empty. Deleting the `footer:` line in normalizeBaked
    // used to pass the entire suite.
    const model = normalizeBaked(bakedDoc());
    expect(model.footer).toBeDefined();
    expect(model.footer!.provenance.map((item) => [item.kind, item.label])).toEqual([
      ["recorded", "データ時点"],
      ["recorded", "作成"],
      ["recorded", "作成ツール"],
    ]);
  });

  it("wires an optional baked guidebookVersion as recorded provenance", () => {
    const model = normalizeBaked(bakedDoc({ guidebookVersion: "v02" }));
    expect(model.footer!.provenance.map((item) => [item.kind, item.label, item.value])).toEqual([
      ["recorded", "データ時点", "2026-07-10"],
      ["recorded", "作成", "2026-08-02T09:00:00Z"],
      ["recorded", "ガイドブック", "v02"],
      ["recorded", "作成ツール", "0.1.0"],
    ]);
  });

  it("carries the author's own fields alongside the recorded ones", () => {
    const model = normalizeBaked(
      bakedDoc({ updatedAt: "2026-06-30", sourceNote: "統計局", summary: "要約" }),
    );
    expect(model.footer!.summary).toBe("要約");
    expect(model.footer!.provenance.map((item) => [item.kind, item.value])).toEqual([
      ["declared", "統計局"],
      ["declared", "2026-06-30"],
      ["recorded", "2026-07-10"],
      ["recorded", "2026-08-02T09:00:00Z"],
      ["recorded", "0.1.0"],
    ]);
  });

  it("passes meta.summary through rather than dropping it", () => {
    // Its own assertion: `summary` travels on a different field from
    // `provenance`, so a footer object missing it still looks populated.
    expect(normalizeBaked(bakedDoc({ summary: "p56 の要約" })).footer!.summary).toBe("p56 の要約");
  });
});

describe("normalizeAuthoring cannot express bake-recorded provenance", () => {
  it("V-116: emits only declared items, even when the document hand-writes the bake stamps", () => {
    // `BaseMeta` is additive-open, so this document parses: `generatedAt` and
    // friends arrive as unknown, untyped keys. `normalizeAuthoring` receives a
    // `BaseMeta`, which has no such fields to read — the type is the guard.
    // This is its runtime half, asserted at the call site rather than on the
    // helper, because a call site that re-tagged the items would satisfy any
    // assertion made on the helper alone.
    const model = normalizeAuthoring(
      authoringDoc({
        updatedAt: "2026-06-30",
        sourceNote: "統計局",
        generatedAt: "1999-01-01T00:00:00Z",
        sourceDataAsOf: "1999-01-01",
        hyakkeiVersion: "9.9.9",
        guidebookVersion: "v99",
      }),
      {},
    );
    expect(model.footer!.provenance.every((item) => item.kind === "declared")).toBe(true);
    const values = model.footer!.provenance.map((item) => item.value);
    expect(values).not.toContain("9.9.9");
    expect(values).not.toContain("v99");
    expect(values).not.toContain("1999-01-01");
  });

  it("still carries what the author legitimately declared", () => {
    // The control: without it, a normalizeAuthoring that returned an empty
    // footer would satisfy the assertion above.
    const model = normalizeAuthoring(authoringDoc({ sourceNote: "統計局", summary: "要約" }), {});
    expect(model.footer!.summary).toBe("要約");
    expect(model.footer!.provenance.map((item) => item.value)).toEqual(["統計局"]);
  });

  it("emits an empty provenance list for a document that declares nothing", () => {
    expect(normalizeAuthoring(authoringDoc(), {}).footer!.provenance).toEqual([]);
  });
});
