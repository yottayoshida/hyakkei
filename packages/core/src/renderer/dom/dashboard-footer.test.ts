// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import {
  FOOTER_CLASS,
  FOOTER_ITEM_CLASS,
  FOOTER_PROVENANCE_CLASS,
  FOOTER_SUMMARY_CLASS,
  authoringProvenance,
  bakedProvenance,
  buildDashboardFooter,
  type FooterModel,
} from "./dashboard-footer.js";

const RLO = "\u202e";

const bakedMeta = {
  generatedAt: "2026-08-02T09:00:00Z",
  sourceDataAsOf: "2026-07-10",
  hyakkeiVersion: "0.1.0",
};

const model = (over: Partial<FooterModel> = {}): FooterModel => ({
  provenance: bakedProvenance(bakedMeta),
  ...over,
});

const SEP = "\u00a0/\u00a0";

// The trailing separator belongs to the item it follows (so it wraps at the
// end of a line rather than the start of the next), which would otherwise make
// every expected string in this file carry it. Dropped here; the one test that
// cares about separation asserts on the joined line instead.
const stripSeparator = (text: string) => (text.endsWith(SEP) ? text.slice(0, -SEP.length) : text);

const itemsOf = (el: HTMLElement) =>
  [...el.querySelectorAll(`.${FOOTER_ITEM_CLASS}`)].map((n) => ({
    kind: (n as HTMLElement).dataset.kind,
    text: stripSeparator(n.textContent!),
  }));

describe("buildDashboardFooter", () => {
  it("V-104: returns null rather than an empty element when there is nothing to show", () => {
    // Not an empty <footer>: that would still occupy a grid row and still
    // announce a `contentinfo` landmark with no content behind it.
    expect(buildDashboardFooter(undefined)).toBeNull();
    expect(buildDashboardFooter({ provenance: [] })).toBeNull();
    // Present but blank after sanitizing — same outcome, different input.
    expect(buildDashboardFooter({ summary: "   ", provenance: [] })).toBeNull();
    expect(
      buildDashboardFooter({ provenance: [{ kind: "declared", label: "出典", value: RLO }] }),
    ).toBeNull();
  });

  it("V-104b: one non-blank field is enough to render", () => {
    // The control for the test above: without this, a bug that always
    // returned null would pass every assertion up there.
    const el = buildDashboardFooter({ summary: "要約", provenance: [] });
    expect(el).not.toBeNull();
    expect(el!.className).toBe(FOOTER_CLASS);
  });

  it("V-105: renders exactly the fields that are present, in guidebook p41 order", () => {
    const el = buildDashboardFooter(
      model({
        provenance: bakedProvenance({
          ...bakedMeta,
          sourceNote: "統計局",
          updatedAt: "2026-06-30",
        }),
      }),
    )!;
    expect(itemsOf(el).map((i) => i.text)).toEqual([
      "出典: 統計局",
      "更新日: 2026-06-30",
      "データ時点: 2026-07-10",
      "作成: 2026-08-02T09:00:00Z",
      "作成ツール: 0.1.0",
    ]);
  });

  it("V-105c: omits a block entirely rather than emitting it empty", () => {
    // The module returns `null` rather than an empty <footer> because an empty
    // element still takes a grid row and still announces a landmark. The same
    // argument applies one level down, and the tests above only assert what IS
    // rendered — so an unconditional `<p class="…summary">` with nothing in it
    // passed all of them.
    const noSummary = buildDashboardFooter(model())!;
    expect(noSummary.querySelectorAll(`.${FOOTER_SUMMARY_CLASS}`)).toHaveLength(0);
    expect(noSummary.children).toHaveLength(1);

    const noProvenance = buildDashboardFooter({
      summary: "要約",
      provenance: [{ kind: "declared", label: "出典", value: RLO }],
    })!;
    expect(noProvenance.querySelectorAll(`.${FOOTER_PROVENANCE_CLASS}`)).toHaveLength(0);
    expect(noProvenance.children).toHaveLength(1);
  });

  it("V-105b: absent author fields drop out without leaving an empty label", () => {
    const el = buildDashboardFooter(model())!;
    expect(itemsOf(el).map((i) => i.text)).toEqual([
      "データ時点: 2026-07-10",
      "作成: 2026-08-02T09:00:00Z",
      "作成ツール: 0.1.0",
    ]);
  });

  it("renders the optional recorded guidebook version between creation and tool", () => {
    const el = buildDashboardFooter(
      model({
        provenance: bakedProvenance({ ...bakedMeta, guidebookVersion: "v02" }),
      }),
    )!;
    expect(itemsOf(el).map((i) => i.text)).toEqual([
      "データ時点: 2026-07-10",
      "作成: 2026-08-02T09:00:00Z",
      "ガイドブック: v02",
      "作成ツール: 0.1.0",
    ]);
  });

  it("tags each item with who asserted it, and never lets a document supply a label", () => {
    const el = buildDashboardFooter(
      model({
        provenance: bakedProvenance({ ...bakedMeta, sourceNote: "自称", updatedAt: "2026-06-30" }),
      }),
    )!;
    expect(itemsOf(el).map((i) => i.kind)).toEqual([
      "declared",
      "declared",
      "recorded",
      "recorded",
      "recorded",
    ]);
    // The provenance-laundering guard, stated as an assertion rather than a
    // comment: no text node that a `recorded` item owns may contain a string
    // the document chose. Mutating the kind mapping is what this catches —
    // grepping the label constants would not.
    const recorded = [...el.querySelectorAll(`.${FOOTER_ITEM_CLASS}`)].filter(
      (n) => (n as HTMLElement).dataset.kind === "recorded",
    );
    for (const node of recorded) {
      expect(node.textContent).not.toContain("自称");
    }
  });

  it("V-107: draws document text as text, never as markup", () => {
    const payload = "<img src=x onerror=alert(1)><script>alert(2)</script>";
    const el = buildDashboardFooter(
      model({
        summary: payload,
        provenance: bakedProvenance({ ...bakedMeta, sourceNote: payload }),
      }),
    )!;
    expect(el.querySelectorAll("img, script")).toHaveLength(0);
    // Positive control: the payload really did reach the footer, so the
    // assertion above is about escaping rather than about the value being
    // dropped somewhere upstream.
    expect(el.textContent).toContain("onerror=alert(1)");
  });

  it("strips bidi controls that would reorder the provenance beside them", () => {
    const el = buildDashboardFooter(model({ summary: `要約${RLO}` }))!;
    const summary = el.querySelector(`.${FOOTER_SUMMARY_CLASS}`)!;
    expect(summary.textContent).toBe("要約");
    expect(/\p{Bidi_Control}/u.test(el.textContent ?? "")).toBe(false);
  });

  it("puts every text-bearing block in its own element with dir=auto", () => {
    // Structural half of the bidi defence: an HTML bidi paragraph ends at a
    // block boundary, so one field cannot reorder the next even if the
    // sanitizer above it ever misses a character.
    const el = buildDashboardFooter(model({ summary: "要約" }))!;
    const summary = el.querySelector(`.${FOOTER_SUMMARY_CLASS}`) as HTMLElement;
    const provenance = el.querySelector(`.${FOOTER_PROVENANCE_CLASS}`) as HTMLElement;
    expect(summary.tagName).toBe("P");
    expect(provenance.tagName).toBe("P");
    expect(summary.dir).toBe("auto");
    for (const node of el.querySelectorAll(`.${FOOTER_ITEM_CLASS}`)) {
      expect((node as HTMLElement).dir).toBe("auto");
    }
  });

  it("separates provenance items in the text a reader actually gets", () => {
    // Asserts the JOINED line, not the individual spans. Every other test in
    // this file reads each span on its own, which is how a run-on line
    // (「…「家計調査」更新日: …」) passed review: per-element assertions can
    // only see per-element facts, while both a sighted reader and a screen
    // reader consume the concatenation. There is no stylesheet in this repo,
    // so a CSS gap would have satisfied nothing.
    const el = buildDashboardFooter(
      model({
        provenance: bakedProvenance({
          ...bakedMeta,
          sourceNote: "総務省統計局「家計調査」",
          updatedAt: "2026-06-30",
        }),
      }),
    )!;
    const line = el.querySelector(`.${FOOTER_PROVENANCE_CLASS}`)!.textContent!;
    expect(line).toBe(
      `出典: 総務省統計局「家計調査」${SEP}更新日: 2026-06-30${SEP}データ時点: 2026-07-10${SEP}作成: 2026-08-02T09:00:00Z${SEP}作成ツール: 0.1.0`,
    );
    // Stated twice on purpose: the exact string above is precise but brittle,
    // and this is the property it exists to protect — no value may sit
    // directly against the next label.
    for (const label of ["更新日:", "データ時点:", "作成:", "作成ツール:"]) {
      expect(line).toContain(`${SEP}${label}`);
    }
    // The last item carries no trailing separator: a line ending in 「\u00a0/\u00a0」
    // reads as a truncated list.
    expect(line.endsWith(SEP)).toBe(false);
  });

  it("keeps each separator attached to the item before it, so a wrap breaks cleanly", () => {
    // The provenance line wraps on a narrow viewport. A separator held in its
    // own text node can land at the START of the next line, reading as a
    // continuation of the item above («す。\u00a0/\u00a0更新日: …» — seen in the real
    // browser). Keeping it inside the preceding span makes it wrap with that
    // span. jsdom cannot show the wrap, so this asserts the structure that
    // causes it.
    const el = buildDashboardFooter(model())!;
    const spans = [...el.querySelectorAll(`.${FOOTER_ITEM_CLASS}`)];
    expect(spans.length).toBeGreaterThan(1);
    for (const [i, span] of spans.entries()) {
      const isLast = i === spans.length - 1;
      expect(span.textContent!.endsWith(SEP), `item ${i} trailing separator`).toBe(!isLast);
    }
    // No separator lives outside a span, which is what would let it wrap alone.
    const list = el.querySelector(`.${FOOTER_PROVENANCE_CLASS}`)!;
    const looseText = [...list.childNodes]
      .filter((n) => n.nodeType === 3)
      .map((n) => n.textContent)
      .join("");
    expect(looseText).toBe("");
  });

  it("keeps the summary in a separate element from the provenance list", () => {
    // They answer different questions -- the summary is a claim about the
    // DATA, the rest describe the FILE -- and a later move of the summary to
    // a header row should be a DOM reparent, not a re-parse of one string.
    const el = buildDashboardFooter(model({ summary: "要約" }))!;
    expect(el.querySelector(`.${FOOTER_SUMMARY_CLASS}`)!.textContent).toBe("要約");
    expect(el.querySelector(`.${FOOTER_PROVENANCE_CLASS}`)!.textContent).not.toContain("要約");
  });

  it("uses a plain <footer> and adds no ARIA of its own", () => {
    const el = buildDashboardFooter(model())!;
    expect(el.tagName).toBe("FOOTER");
    expect(el.getAttribute("role")).toBeNull();
    expect(el.getAttribute("aria-label")).toBeNull();
  });

  it("spans the full grid width", () => {
    expect(buildDashboardFooter(model())!.style.gridColumn).toBe("1 / -1");
  });
});

describe("provenance builders", () => {
  it("an authoring document can never produce a bake-recorded item", () => {
    // The runtime half of the guarantee `RenderModel` states at the type
    // level. `normalizeAuthoring` cannot even read `generatedAt`, but this
    // pins the behaviour so a future signature change has to break a test
    // rather than quietly widening what an author can assert.
    const items = authoringProvenance({ updatedAt: "2026-06-30", sourceNote: "統計局" });
    expect(items.every((i) => i.kind === "declared")).toBe(true);
    expect(items).toHaveLength(2);
  });

  it("a baked document always carries the three required freshness/tool stamps", () => {
    const items = bakedProvenance(bakedMeta);
    expect(items.filter((i) => i.kind === "recorded")).toHaveLength(3);
  });
});
