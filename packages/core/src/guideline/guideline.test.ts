import { afterEach, describe, expect, it, vi } from "vitest";
import type { Row } from "../renderer/render-model.js";
import rawGuidelineRules from "./guideline-rules.json" with { type: "json" };
import { GUIDEBOOK_SOURCE } from "./guidebook-source.js";
import { evaluateGuidelines, getGuidelineRules, validateGuidelineRules } from "./rules.js";

function pieRows(n: number): Row[] {
  return Array.from({ length: n }, (_, i) => ({ category: `cat-${i}`, value: i + 1 }));
}

const FIXTURE_URL = "https://example.test/x";

/**
 * A rule valid in every field, for the negative tests to invalidate one field of.
 * That property is what makes each case fail for its own reason, and holding it
 * in one place is what keeps it true: the five call sites below used to be five
 * full literals, and making `citation.url` required (issue #123) meant editing
 * all five. The next required field would have cost the same five edits, and any
 * one of them could have been missed — leaving a case that still throws, but
 * about the wrong field.
 *
 * Concretely why every field has to be valid, not just plausible: `citation.url`
 * is validated *before* `threshold`, so the negative-threshold case throws about
 * the url instead if this fixture's url is bad.
 */
const makeRule = (overrides: Record<string, unknown> = {}) => ({
  id: "x",
  status: "doc-only",
  severity: "warning",
  message: "x",
  citation: { label: "x", url: FIXTURE_URL },
  ...overrides,
});

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
  // V-001 (issue #123): run the SHIPPED file through the fail-CLOSED
  // function. ADR-0016's "Fail-closed in CI, fail-open at runtime" section
  // states that `validateGuidelineRules` is "the function `guideline.test.ts`
  // calls directly, so a malformed `guideline-rules.json` fails the build
  // before it ships" -- but until this test existed, every direct call in this
  // file passed a hand-written fixture, and the real file only ever went
  // through `getGuidelineRules()` below. That matters in two ways: the
  // diagnostic message naming exactly what is wrong was unreachable for the
  // real file, and any malformation that *passes* validation (an empty
  // `citation.label`, before this issue tightened it) failed nothing at all.
  it("the real guideline-rules.json passes validateGuidelineRules (fail-CLOSED path)", () => {
    expect(() => validateGuidelineRules(rawGuidelineRules)).not.toThrow();
  });

  // The fail-OPEN wrapper, on the same file. `getGuidelineRules()` catches
  // everything, so `not.toThrow()` on it is structurally unfailable and is
  // deliberately not asserted here -- what this pins is that the runtime path
  // yields a non-empty rule set, i.e. the editor is not silently running with
  // the `[]` fallback.
  it("getGuidelineRules() returns a non-empty rule set for the real file (not the [] fallback)", () => {
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

  // V-018 (issue #123): the threshold lives in `threshold` and is restated in
  // Japanese prose inside `message` ("7つ以上"). Nothing linked the two, so a
  // future edit to one could silently contradict the other.
  //
  // Matched as the counter phrase 「Nつ以上」 with a non-digit (or start) before
  // the N, rather than as a bare substring: `toContain("7")` was the first
  // attempt and Codex R1 showed it is not discriminating — it passes for the
  // broken 「17つ以上」 and 「70つ以上」, and would even be satisfied by an
  // unrelated "7" elsewhere in the string, which is a live risk here because a
  // sibling rule's citation legitimately contains "p47".
  it("every rule's message restates its own threshold as the counter phrase for threshold+1", () => {
    for (const rule of validateGuidelineRules(rawGuidelineRules)) {
      if (rule.threshold === undefined) continue;
      expect(rule.message).toMatch(new RegExp(`(^|[^0-9])${rule.threshold + 1}つ以上`));
    }
  });

  // V-021: an active rule with no registered predicate must fail CI (fail-closed).
  it("throws when a status:active rule has no registered predicate", () => {
    expect(() =>
      validateGuidelineRules([makeRule({ id: "not-a-real-predicate", status: "active" })]),
    ).toThrow(/no predicate is registered/);
  });

  it("throws on a duplicate rule id", () => {
    const rule = makeRule({ id: "dup" });
    expect(() => validateGuidelineRules([rule, rule])).toThrow(/duplicate rule id/);
  });

  it("throws on an unknown status", () => {
    expect(() => validateGuidelineRules([makeRule({ status: "enabled" })])).toThrow(
      /unknown status/,
    );
  });

  // V-005 / V-006 / V-020 (issue #123). Each case asserts the specific message,
  // not just "it threw": `validateGuidelineRules` runs label before url before
  // threshold, so a case that throws for a neighbouring reason would still
  // satisfy a bare `.toThrow()` and hide which rule actually fired.
  const withCitation = (citation: unknown) => () =>
    validateGuidelineRules([makeRule({ citation })]);

  // V-005: `label` accepted "" until #123, while `message` never did. An empty
  // label renders as "出典: " and names nothing.
  it.each([
    ["an empty label", { label: "", url: FIXTURE_URL }],
    ["a whitespace-only label", { label: "   ", url: FIXTURE_URL }],
    ["a non-string label", { label: 42, url: FIXTURE_URL }],
    ["a missing citation object", undefined],
  ])("throws on %s", (_name, citation) => {
    expect(withCitation(citation)).toThrow(/"citation\.label" must be a non-empty string/);
  });

  // V-006 / V-020: `null` was the shipped state for all four rules before #123
  // (ADR-0016 RR-2). The exact-match tests further down pin today's URLs; this
  // is what stops a NEW rule from arriving with `url: null` again.
  it.each([
    ["a null url", { label: "x", url: null }],
    ["a non-string url", { label: "x", url: 42 }],
    ["an empty url", { label: "x", url: "" }],
    ["a whitespace-only url", { label: "x", url: "   " }],
    ["a bare scheme", { label: "x", url: "https://" }],
    ["an http url", { label: "x", url: "http://www.digital.go.jp/x" }],
    ["a protocol-relative url", { label: "x", url: "//www.digital.go.jp/x" }],
    ["a javascript: url", { label: "x", url: "javascript:alert(1)" }],
    ["a data: url", { label: "x", url: "data:text/html,<script>alert(1)</script>" }],
    ["a file: url", { label: "x", url: "file:///etc/passwd" }],
    ["a relative path", { label: "x", url: "/resources/dashboard-guidebook" }],
    // Rejected for carrying credentials, not for the scheme: a citation has no
    // business holding any, and the field becomes a sink the moment it is
    // rendered as a link.
    ["userinfo with a password", { label: "x", url: "https://u:p@www.digital.go.jp/x" }],
    ["userinfo without a password", { label: "x", url: "https://u@www.digital.go.jp/x" }],
    // Every case below parses fine and is rejected only because `new URL()`
    // rewrites it -- the authored string is not what it resolves to. See
    // `isCitationUrl` for which rewrites those are.
    ["a url containing a space", { label: "x", url: "https://www.digital.go.jp/a b" }],
    ["a url containing a tab", { label: "x", url: "https://www.digital.go.jp/a\tb" }],
    ["a url with surrounding whitespace", { label: "x", url: "  https://www.digital.go.jp/x  " }],
    ["an upper-case scheme", { label: "x", url: "HTTPS://www.digital.go.jp/x" }],
    ["an origin with no path", { label: "x", url: "https://www.digital.go.jp" }],
  ])("throws on %s", (_name, citation) => {
    expect(withCitation(citation)).toThrow(/"citation\.url" must be an https:\/\/ URL/);
  });

  // The page stated in the label's prose must be the page the URL's `#page=`
  // fragment targets. Two restatements of one fact, previously unlinked -- the
  // same shape as the threshold restated in `message`.
  it.each([
    [
      "a label page the url does not target",
      { label: "デジタル庁 …ガイドブック v02 p34", url: "https://www.digital.go.jp/x.pdf#page=41" },
    ],
    [
      "a label page with no fragment at all",
      { label: "デジタル庁 …ガイドブック v02 p34", url: "https://www.digital.go.jp/x.pdf" },
    ],
  ])("throws on %s", (_name, citation) => {
    expect(withCitation(citation)).toThrow(/"citation\.label" cites p34 but "citation\.url"/);
  });

  it.each([
    [
      "a label and url naming the same page",
      { label: "デジタル庁 …ガイドブック v02 p34", url: "https://www.digital.go.jp/x.pdf#page=34" },
    ],
    [
      // `truncated-axis` does exactly this: its label names p47 first (the
      // Do/Don't page the rule is named for) and p41 second (the same principle
      // in the 原則 section), while the URL targets p47.
      "a label naming a second page in prose, with the url on the first",
      {
        label: "デジタル庁 …ガイドブック v02 p47「…」（p41「…」も同旨）",
        url: "https://www.digital.go.jp/x.pdf#page=47",
      },
    ],
    [
      // Exempt by construction rather than by an id check: no page in the label,
      // so there is nothing to disagree with.
      "a label stating no page, with a non-PDF url",
      {
        label: "デジタル庁 …ガイドブック付属 Power BI テーマ JSON",
        url: "https://github.com/o/r#L29",
      },
    ],
  ])("accepts %s", (_name, citation) => {
    expect(withCitation(citation)).not.toThrow();
  });

  // Accepted, recorded so the boundary is visible rather than incidental --
  // in particular that both fragment forms the shipped citations rely on survive
  // (`#page=N` for the PDF, `#LN` for the theme JSON on GitHub).
  it.each([
    ["an https url with a page fragment", "https://www.digital.go.jp/x.pdf#page=34"],
    ["an https url with a line anchor", "https://github.com/o/r/blob/sha/f.json#L29"],
    ["an origin with a trailing slash", "https://www.digital.go.jp/"],
  ])("accepts %s", (_name, url) => {
    expect(withCitation({ label: "x", url })).not.toThrow();
  });

  it("throws on a negative/non-integer threshold", () => {
    expect(() => validateGuidelineRules([makeRule({ threshold: -1 })])).toThrow(/threshold/);
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
        default: [makeRule({ id: "not-a-real-predicate", status: "active" })],
      }));
      const fresh = await import("./rules.js");
      expect(fresh.getGuidelineRules()).toEqual([]);
    });
  });
});

/**
 * issue #123. Every citation in the shipped file used to name a heading that
 * does not exist in the guidebook ("円グラフの使い方", "軸の使い方", "配色の使い方",
 * "グラフの選び方" -- zero hits across all 59 pages) under a book title that is
 * also wrong (the official title is "ダッシュボードデザインの実践ガイドブック"; the file
 * dropped "の実践", while `docs/guidebook-coverage.md` used the correct one, so the
 * repo disagreed with itself). Every `url` was `null`.
 *
 * Nothing pinned any of it. Emptying all eight strings left the whole suite
 * green: the id-set, `threshold: 6` and non-empty-rule-set assertions above are
 * all blind to citation content, no golden or baked snapshot carries a citation
 * (`evaluateGuidelines`' only importer is `ChartBuilder.tsx`), and the one UI
 * assertion was `toContain("出典:")`, which "出典: " satisfies. So these are
 * exact-match pins, not shape checks -- a homograph domain or a single dropped
 * character has to fail, and only exact match does that.
 *
 * How each page number and URL was established -- and the two traps found doing
 * it -- is recorded once, in the dated attestation table in
 * `docs/guidebook-coverage.md`. This table is the pin; that table is the evidence.
 */
const GUIDEBOOK_TITLE = "ダッシュボードデザインの実践ガイドブック";

const GUIDEBOOK_PDF = GUIDEBOOK_SOURCE.pdfUrl;

// The `dataColors` array the `palette-order` rule actually rests on, pinned to
// a commit rather than a branch: this is the rule with no guidebook text behind
// it at all, so its citation must point at the artifact, not at the guidebook.
const POWERBI_THEME_DATACOLORS =
  "https://github.com/digital-go-jp/policy-dashboard-assets/blob/" +
  "a520c070a2c1fb57fdccf8e89e44182110b11a4b/powerbi-templates/powerbi-theme-json/" +
  "CustomThemeBlueDefault_2026.json#L29";

const EXPECTED_CITATIONS: Record<string, { label: string; url: string }> = {
  "pie-too-many-slices": {
    label:
      `デジタル庁 ${GUIDEBOOK_TITLE} v02 p34（4.2 グラフの種類と選び方）。` +
      "7分類以上という閾値は hyakkei の判断で、ガイドブックは分類数の上限を定めていません",
    url: `${GUIDEBOOK_PDF}#page=34`,
  },
  "truncated-axis": {
    label:
      `デジタル庁 ${GUIDEBOOK_TITLE} v02 p47「グラフの原点は原則として0にする」` +
      "（p41「表現を歪曲しない」も同旨）",
    url: `${GUIDEBOOK_PDF}#page=47`,
  },
  "palette-order": {
    label:
      `デジタル庁 ${GUIDEBOOK_TITLE}付属 Power BI テーマ JSON の dataColors 順（濃→淡）。` +
      "ガイドブック本文にランプ順序の規定はありません",
    url: POWERBI_THEME_DATACOLORS,
  },
  "3d-anything": {
    label:
      `デジタル庁 ${GUIDEBOOK_TITLE} v02 p44「不要な装飾やリッチな表現は使わない」` +
      "（同項はドロップシャドウも対象で、このルールは3Dのみを見ています）",
    url: `${GUIDEBOOK_PDF}#page=44`,
  },
};

describe("guideline-rules.json citations (issue #123)", () => {
  const rules = () => validateGuidelineRules(rawGuidelineRules);

  // V-002 + V-003. One comparison of the whole `citation` object, not one per
  // field: both sides are exactly `{label, url}`, so this also fails if a field
  // is *added* to a citation without anyone updating the expected table.
  //
  // There is deliberately no separate "no url is null or blank" test. It would
  // read as an independent guard on the state ADR-0016 RR-2 left behind, but
  // `validateGuidelineRules` now rejects that input, so `rules()` throws before
  // any such assertion runs — it could only ever fail with the validator's own
  // message. The rejection is pinned directly, on hand-written input, in the
  // `it.each` tables above; that is where it can actually fail.
  it("every rule's citation matches its expected label and url exactly", () => {
    expect(Object.fromEntries(rules().map((r) => [r.id, r.citation]))).toEqual(EXPECTED_CITATIONS);
  });

  // V-004: the repo disagreed with itself about the book's name. This is the
  // half a test can hold; `citation-count-consistency.test.ts` holds the other
  // half (that no *other* file still uses the truncated title).
  //
  // Applies to all four with no exception: `palette-order` sources the Power BI
  // theme JSON rather than the guidebook text, but its label still names the
  // guidebook the theme ships with, so it clears the same bar. An earlier
  // version of this test special-cased it to a weaker check, which held one rule
  // to a lower standard for no reason.
  it("every citation names the guidebook by its official title", () => {
    for (const rule of rules()) {
      expect(rule.citation.label).toContain(`デジタル庁 ${GUIDEBOOK_TITLE}`);
    }
  });

  // The host allowlist, which `isCitationUrl` deliberately does not enforce (it
  // constrains the scheme and rejects credentials; any host parses). This is the
  // check that would catch a homograph domain slipped into `EXPECTED_CITATIONS`.
  // The scheme is not re-asserted here — the validator already rejects anything
  // else, so `rules()` would throw first.
  //
  // Reachability is NOT asserted: a network call would make CI flaky and
  // contradicts the browser-complete design, so it is carried by the dated
  // attestation table in `docs/guidebook-coverage.md` instead -- the same
  // division `palette.ts`'s `GUIDEBOOK_ROLE_SOURCE` already uses.
  it("every url is on a vetted host", () => {
    for (const rule of rules()) {
      expect(["www.digital.go.jp", "github.com"]).toContain(new URL(rule.citation.url).hostname);
    }
  });

  // The disclosure that the pie threshold is hyakkei's own has to reach the one
  // string the UI renders (`ChartBuilder.tsx` prints `citation.label` and
  // nothing else). `ChartBuilder.test.tsx` asserts it actually appears on
  // screen; this pins that the data carries it at all.
  it("the pie rule's citation discloses that the threshold is hyakkei's, not the guidebook's", () => {
    const pie = rules().find((r) => r.id === "pie-too-many-slices");
    expect(pie?.citation.label).toContain("hyakkei の判断");
    expect(pie?.citation.label).toContain("ガイドブックは分類数の上限を定めていません");
  });
});
