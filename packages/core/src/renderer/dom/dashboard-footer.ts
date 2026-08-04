// The dashboard-level provenance footer (issue #124, ADR-0019). This is the
// first DOM the renderer owns that is not a chart tile: `mount()` otherwise
// applies a grid to the caller's container and fills it with tiles.
//
// Why it exists: `BakedMeta` carries `generatedAt`/`sourceDataAsOf`/
// `hyakkeiVersion` as REQUIRED fields, and `baked.ts`'s own comment calls
// `sourceDataAsOf` "the viewer's only signal of how fresh the frozen data
// is" — yet nothing drew any of them. A baked artifact is terminal
// (ADR-0005): someone opens it a year later with no way to ask when the
// numbers were current.
//
// The guidebook's p41「メタ情報を記載する」lists データのソース → データの更新日
// → いつ時点の数値なのか → 注釈 → 免責事項. `PROVENANCE_ORDER` below follows that
// enumeration rather than an order of our own, because this project's whole
// conformance claim is "we cite the guidebook" — an order we invented would
// need explaining every time.
import { sanitizeDisplayText } from "./display-text.js";

/**
 * Provenance split by WHO asserted it, not by what it says.
 *
 * `recorded` is what `bake()` stamped. `bake.ts` merges as
 * `{...document.meta, ...meta}`, so these three always come from the bake
 * call and a document cannot forge them.
 *
 * `declared` is what the author wrote and `bake()` passed through untouched.
 * Under ADR-0017 Decision 1 the author is usually an agent, so a hallucinated
 * citation is not a remote possibility — it is the expected failure mode.
 *
 * Keeping the two apart in the MODEL rather than at the drawing site is what
 * stops a later refactor from flattening them into one list of strings and
 * silently lending `bake()`'s authority to whatever the document claimed.
 */
export type ProvenanceItem = {
  kind: "recorded" | "declared";
  /**
   * One of this module's own labels. A union rather than `string`, so
   * "never document-supplied" is checked rather than asserted in prose — a
   * caller reaching for a value out of the document gets a type error.
   */
  label: (typeof PROVENANCE_ORDER)[number]["label"];
  value: string;
};

export type FooterModel = {
  /**
   * A summary is a claim about the DATA; everything in `provenance` is a
   * statement about the FILE. They are separate fields, and separate DOM
   * children, so that a re-bake that moves `sourceDataAsOf` while leaving a
   * stale summary in place shows the contradiction side by side.
   */
  summary?: string;
  provenance: ProvenanceItem[];
};

/**
 * One row per provenance field, in the order the footer draws them, carrying
 * the three facts that are fixed per field: who asserted it, what it is
 * labelled, and where it sits in the sequence.
 *
 * The order is the guidebook's own (p41「メタ情報を記載する」: データのソース →
 * データの更新日 → いつ時点の数値なのか → 注釈 → 免責事項). This project's
 * conformance claim is that it cites the guidebook, so an order of our own
 * invention would need explaining every time. 注釈 and 免責事項 fold into
 * `sourceNote`, which is why five guidebook items map to four fields.
 * `hyakkeiVersion` is not in that list at all — it describes the tool rather
 * than the data — so it goes last.
 *
 * Held as one table rather than three parallel structures (a label map, a
 * sequence of pushes, and a kind per call): the order was previously readable
 * only by reading all three in step.
 */
const PROVENANCE_ORDER = [
  { field: "sourceNote", kind: "declared", label: "出典" },
  { field: "updatedAt", kind: "declared", label: "更新日" },
  { field: "sourceDataAsOf", kind: "recorded", label: "データ時点" },
  { field: "generatedAt", kind: "recorded", label: "作成" },
  { field: "hyakkeiVersion", kind: "recorded", label: "作成ツール" },
] as const satisfies ReadonlyArray<{
  field: string;
  kind: ProvenanceItem["kind"];
  label: string;
}>;

type ProvenanceField = (typeof PROVENANCE_ORDER)[number]["field"];

/**
 * Trails the item it follows, rather than sitting between two items as its own
 * node, and uses NO-BREAK SPACE either side.
 *
 * Both details exist for the same reason, and both were found by looking at
 * the rendered page rather than at a test. The provenance line wraps on a
 * normal viewport, and a separator that can be broken away from its item lands
 * at the START of the next line, where it reads as a continuation of the item
 * above it («…あります。» / newline / «／ 更新日: …»). Attaching it to the
 * preceding span was not enough on its own: an ordinary full-width space is
 * still a break opportunity, so the line broke INSIDE the separator. U+00A0 on
 * both sides removes that opportunity, so the whole separator travels with the
 * item it terminates.
 *
 * A solidus rather than only spaces, because the values contain spaces of
 * their own (a citation, a note) and a space alone would not read as a
 * boundary. Not user-supplied and not sanitized — it is ours.
 */
const ITEM_SEPARATOR = "\u00a0/\u00a0";

export const FOOTER_CLASS = "hyakkei-dashboard-footer";
export const FOOTER_SUMMARY_CLASS = "hyakkei-dashboard-summary";
export const FOOTER_PROVENANCE_CLASS = "hyakkei-dashboard-provenance";
export const FOOTER_ITEM_CLASS = "hyakkei-dashboard-provenance-item";

/**
 * `null`, not an empty `<footer>`, when there is nothing to say: an empty
 * element still consumes a grid row and still reads as a landmark to a
 * screen reader.
 */
export function buildDashboardFooter(model: FooterModel | undefined): HTMLElement | null {
  if (!model) return null;

  const summary = model.summary ? sanitizeDisplayText(model.summary).text : "";
  const items = model.provenance
    .map((item) => ({ ...item, value: sanitizeDisplayText(item.value).text }))
    .filter((item) => item.value !== "");

  if (summary === "" && items.length === 0) return null;

  // A plain <footer>: the caller's container is a <div>, so this maps to the
  // `contentinfo` landmark without an explicit role. (If M3's packaging ever
  // wraps the grid in <main>, that mapping is lost — the fix then is to move
  // the footer out of the wrapper, NOT to add role="contentinfo" to a nested
  // footer, which is invalid.)
  const footer = document.createElement("footer");
  footer.className = FOOTER_CLASS;
  footer.style.gridColumn = "1 / -1";

  if (summary !== "") {
    const el = document.createElement("p");
    el.className = FOOTER_SUMMARY_CLASS;
    // `dir="auto"` on every text-bearing block, and one block per field: an
    // HTML bidi paragraph ends at a block boundary, so an unterminated
    // U+202E inside one field cannot reorder the field below it. That is the
    // structural half of the defence; `sanitizeDisplayText` is the other, and
    // neither is trusted alone. There is no CSS in this project (not one
    // stylesheet), so a class name alone would enforce nothing here.
    el.dir = "auto";
    el.textContent = summary;
    footer.appendChild(el);
  }

  if (items.length > 0) {
    const list = document.createElement("p");
    list.className = FOOTER_PROVENANCE_CLASS;
    items.forEach((item, index) => {
      const el = document.createElement("span");
      el.className = FOOTER_ITEM_CLASS;
      el.dataset.kind = item.kind;
      // `dir` is what keeps one item from reordering the next: the HTML
      // rendering spec gives `[dir]` elements `unicode-bidi: isolate`, so
      // each item is its own bidi run even though they share a paragraph.
      el.dir = "auto";
      // textContent, never innerHTML — the same rule every other DOM builder
      // in this directory follows.
      //
      // A real separator character, not margin or a gap: this repository ships
      // no stylesheet, so anything expressed only in CSS renders as nothing
      // here. Without it the line reads 「出典: 総務省統計局「家計調査」更新日:
      // 2026-06-30」— one value running straight into the next label — and a
      // screen reader hears the same run-on, since both audiences read the
      // concatenated text rather than the individual spans. (Caught in review;
      // the tests asserted on each span separately and so never saw the line.)
      const trailing = index < items.length - 1 ? ITEM_SEPARATOR : "";
      el.textContent = `${item.label}: ${item.value}${trailing}`;
      list.appendChild(el);
    });
    footer.appendChild(list);
  }

  return footer;
}

/**
 * Built by `normalizeBaked`, where the three stamps are `required` by schema,
 * so "this came from bake()" is a fact about the input type rather than a
 * guess about the value.
 */
export function bakedProvenance(meta: {
  updatedAt?: string;
  sourceNote?: string;
  sourceDataAsOf: string;
  generatedAt: string;
  hyakkeiVersion: string;
}): ProvenanceItem[] {
  return orderedProvenance(meta);
}

/**
 * The explicit field list is a RUNTIME projection, not a restatement of the
 * parameter type. `BaseMeta` is additive-open, so the object arriving here can
 * carry a hand-written `sourceDataAsOf` that TypeScript never sees — passing
 * `meta` straight through the way `bakedProvenance` does would let
 * `orderedProvenance` read it and emit a `recorded` item from an authoring
 * document. Do not "simplify" this into the same shape as its sibling; the
 * asymmetry is the guarantee.
 */
export function authoringProvenance(meta: {
  updatedAt?: string;
  sourceNote?: string;
}): ProvenanceItem[] {
  return orderedProvenance({ sourceNote: meta.sourceNote, updatedAt: meta.updatedAt });
}

function orderedProvenance(values: Partial<Record<ProvenanceField, string>>): ProvenanceItem[] {
  return PROVENANCE_ORDER.flatMap(({ field, kind, label }) => {
    const value = values[field];
    return value === undefined ? [] : [{ kind, label, value }];
  });
}
