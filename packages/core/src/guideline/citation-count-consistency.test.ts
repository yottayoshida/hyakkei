/**
 * issue #123. `docs/guidebook-coverage.md` is the denominator for every
 * conformance claim hyakkei makes (ADR-0017 Decision 5), and its headline
 * counts are restated in `docs/README.md`, `docs/ROADMAP.md` and ADR-0017's
 * read-forward note. Nothing connected the copies, and the failure mode is
 * documented history, not speculation: a 6→4 change on 2026-07-27 missed two of
 * the four documents quoting it, and drafting *this* change reproduced it twice
 * more.
 *
 * So this is a mirror check, not a re-derivation: one canonical value per
 * question, and every restatement must agree with it. Deliberately NOT a parse
 * of the "The 22" table to recompute the counts — a regex over prose is
 * brittle in exactly the way that would make it worthless, since a reformatted
 * table would stop matching and a test that matches nothing passes. Which is
 * also why every entry below requires EXACTLY ONE match: zero matches is a
 * failure, not a pass.
 *
 * Prose that states a count in words rather than digits ("Two of the eight")
 * cannot be pinned this way and is left to the human adjudication pass that
 * `.claude/plans/`'s scan checklist covers. This test narrows that pass; it
 * does not replace it.
 *
 * Reading files outside the package is new here (`no-hardcoded-hex.test.ts`
 * walks `src/` only). The alternative — a root-level test project — would exist
 * solely to hold this one file, and the counts it guards are already about
 * `guideline-rules.json`, which lives in this directory.
 *
 * `CHANGELOG.md` is intentionally absent: its entries are dated records of what
 * was true at a release, so an old entry quoting an old count is correct and
 * must not be rewritten.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import rawGuidelineRules from "./guideline-rules.json" with { type: "json" };
import { validateGuidelineRules } from "./rules.js";

// src/guideline -> src -> core -> packages -> repo root
const REPO_ROOT = join(import.meta.dirname, "../../../..");
// Memoised: everything below reads the same handful of ~20 KB documents — the
// 17 mirror cases, plus `canonical()` re-reading the coverage file per rule,
// plus the two id/title tests — roughly 90 reads of 4 files unmemoised (QA
// Phase 8 recounted this; an earlier comment said 22). Kept as a Map rather
// than module-level consts so a read failure surfaces as a failing test rather
// than a collection-time crash.
const fileCache = new Map<string, string>();
const read = (rel: string): string => {
  const hit = fileCache.get(rel);
  if (hit !== undefined) return hit;
  const body = readFileSync(join(REPO_ROOT, rel), "utf8");
  fileCache.set(rel, body);
  return body;
};

const COVERAGE = "docs/guidebook-coverage.md";
const DOCS_README = "docs/README.md";
const ROADMAP = "docs/ROADMAP.md";
const ADR_0017 = "docs/adr/0017-v1-is-agent-generated-dashboards.md";

const shippedRules = () => validateGuidelineRules(rawGuidelineRules);

/** Whether a rule id appears in a numbered row of the coverage table's "The 22". */
const citedInCoverageTable = (id: string) =>
  new RegExp(`\\| \\d+ \\|[^\\n]*\`${id}\``).test(read(COVERAGE));

/**
 * The expected answer to each question, held once.
 *
 * Four of the six are hand-written copies of what `docs/guidebook-coverage.md`
 * states, and that is deliberate: they are facts about the *guidebook*, so
 * deriving them from one of the documents would make the test agree with
 * whatever those documents say, including when they are wrong together — which
 * is the one case it exists to catch.
 *
 * The other two are facts about the *code*, so they are derived from it. ADR-0017
 * says the point of this inventory is to replace "have we covered the guidebook?"
 * (unanswerable by a test) with "does the inventory match the code?" — and for
 * these two, only derivation answers that question. Hand-typing them would let a
 * fifth `status:"active"` rule ship while every count here stayed green.
 *
 * A function, not a const: the derived pair calls `validateGuidelineRules`, which
 * throws on a malformed rules file. Evaluated at module scope, that throw lands
 * during collection and vitest reports "no tests" — a result that names neither
 * the file nor the reason. Inside a test body it fails as a test, with the
 * validator's own message.
 */
const canonical = () =>
  ({
    denominator: "22",
    // Rules named by a numbered row of the coverage table. `palette-order` is
    // excluded by design (see the id-set test below), so this counts 3, not 4.
    namedRules: String(shippedRules().filter((r) => citedInCoverageTable(r.id)).length),
    runtimePredicates: String(shippedRules().filter((r) => r.status === "active").length),
    guaranteed: "9",
    schemaFieldsOwed: "4",
    knownDefects: "0",
  }) as const;

type CanonicalKey = keyof ReturnType<typeof canonical>;

type Mirror = { file: string; what: CanonicalKey; re: RegExp };

const MIRRORS: Mirror[] = [
  // Coverage headline -- the source the others copy from.
  {
    file: COVERAGE,
    what: "denominator",
    re: /\*\*Machine-checkable principles found\*\*: \*\*(\d+)\*\*/,
  },
  { file: COVERAGE, what: "namedRules", re: /\*\*Addressed by a named rule\*\*: \*\*(\d+)\*\*/ },
  {
    file: COVERAGE,
    what: "runtimePredicates",
    re: /\*\*Addressed by a named rule\*\*: \*\*\d+\*\* — of which \*\*(\d+)\*\* has a runtime predicate/,
  },
  {
    file: COVERAGE,
    what: "guaranteed",
    re: /\*\*Guaranteed in practice\*\* \(rule-enforced \*or\* impossible to violate\): \*\*(\d+)\*\*/,
  },
  {
    file: COVERAGE,
    what: "schemaFieldsOwed",
    re: /\*\*Needs a new schema field before it can be satisfied at all\*\*: \*\*(\d+)\*\*/,
  },
  {
    file: COVERAGE,
    what: "knownDefects",
    re: /\*\*Known defects\*\* \(implemented, and wrong\): \*\*(\d+)\*\*/,
  },

  // "Which number to quote" -- the same figures again, one section down.
  {
    file: COVERAGE,
    what: "guaranteed",
    re: /\| \*\*active \+ by construction\*\*[^|]*\| \*\*(\d+)\*\* \|/,
  },

  // The honest short form, which is the sentence people lift verbatim.
  {
    file: COVERAGE,
    what: "denominator",
    re: /\*\*The honest short form: (\d+) principles identified/,
  },
  {
    file: COVERAGE,
    what: "guaranteed",
    re: /\*\*The honest short form: \d+ principles identified, (\d+) guaranteed/,
  },
  {
    file: COVERAGE,
    what: "knownDefects",
    re: /\*\*The honest short form:[^*]*?, (\d+) known defects\.\*\*/,
  },

  // Downstream restatements.
  { file: DOCS_README, what: "guaranteed", re: /\*\*(\d+)\*\* guaranteed in practice/ },
  { file: DOCS_README, what: "knownDefects", re: /\*\*(\d+)\*\* known defects/ },
  { file: ROADMAP, what: "denominator", re: /\*\*(\d+) machine-checkable principles\*\*/ },
  // ROADMAP used to state this one in words ("Nine are guaranteed"), which no
  // digit-based pattern can see -- the same blind spot that let a
  // "Two of the eight" survive one file over. Rewritten to digits so it can be
  // pinned, since it is a count this PR changed.
  { file: ROADMAP, what: "guaranteed", re: /\*\*(\d+)\*\* are guaranteed in practice/ },
  {
    file: ROADMAP,
    what: "guaranteed",
    re: /this outcome sits somewhere in 1–(\d+) of 22/,
  },
  // Anchored on "the current figures are", not on the `N guaranteed and M known
  // defects` shape: this note deliberately records the count's history (7/3 →
  // 8/2 → 9/0) in the same sentence, so the looser pattern matches three times
  // and cannot tell the live figure from the superseded ones. Requiring exactly
  // one match caught that on the first run.
  { file: ADR_0017, what: "guaranteed", re: /the current figures are \*\*(\d+) guaranteed\*\*/ },
  {
    file: ADR_0017,
    what: "knownDefects",
    re: /the current figures are \*\*\d+ guaranteed\*\* and \*\*(\d+) known defects\*\*/,
  },
];

describe("conformance counts stay consistent across the documents that quote them", () => {
  it.each(MIRRORS)(
    "$file states the $what count as the canonical value ($re)",
    ({ file, what, re }) => {
      // `g` is applied here rather than written into each table row so the rows
      // stay readable as plain patterns. Exactly one match is *checked*, not
      // assumed: a second, stale copy of the same sentence would otherwise pass.
      const all = [...read(file).matchAll(new RegExp(re.source, "g"))];
      expect(all.length, `expected exactly one match for ${re} in ${file}`).toBe(1);
      expect(all[0]?.[1]).toBe(canonical()[what]);
    },
  );
});

describe("guideline-rules.json and the coverage inventory agree on which rules exist", () => {
  /**
   * V-014. The two id sets are NOT equal and must not be asserted equal --
   * `docs/guidebook-coverage.md` says so explicitly in "One rule in
   * guideline-rules.json is not in this table": `palette-order` has no
   * guidebook text behind it, so it is deliberately outside the 22. Asserting
   * set equality would fail on a difference that is by design.
   */
  it("every rule except palette-order is cited by the coverage table, and palette-order is not", () => {
    for (const { id } of shippedRules()) {
      expect(citedInCoverageTable(id), `${id}: numbered row in the coverage table`).toBe(
        id !== "palette-order",
      );
    }
  });

  // The book's own name was wrong in guideline-rules.json while
  // docs/guidebook-coverage.md had it right -- the repo disagreed with itself
  // about what it was citing. `guideline.test.ts` pins the JSON side; this pins
  // that no document reintroduces the truncated form.
  //
  // Every markdown file under docs/ (recursively), not the four mirror files
  // (QA Phase 8, m-3): reusing the mirror list here made three of its four
  // entries vacuous -- they never contained the title in any form -- while the
  // ADR that DOES name the book several times (0016) sat outside the scan.
  // The universe for a "nobody says it wrong" check is "everywhere it could be
  // said", which is not the same set as "where the counts are quoted".
  it("no document under docs/ uses the truncated book title", () => {
    const mdFiles: string[] = [];
    const walk = (rel: string) => {
      for (const entry of readdirSync(join(REPO_ROOT, rel), { withFileTypes: true })) {
        const childRel = `${rel}/${entry.name}`;
        if (entry.isDirectory()) walk(childRel);
        else if (entry.name.endsWith(".md")) mdFiles.push(childRel);
      }
    };
    walk("docs");
    // Guard the walk itself: an empty result would make the loop below pass
    // vacuously -- the same no-match-must-fail rule the mirrors follow.
    expect(mdFiles.length).toBeGreaterThan(10);
    for (const file of mdFiles) {
      // The truncated form cannot substring-match the official title -- the
      // official one has 「の実践」 in the middle -- so a plain match suffices.
      expect(read(file), file).not.toMatch(/ダッシュボードデザインガイドブック/);
    }
  });
});
