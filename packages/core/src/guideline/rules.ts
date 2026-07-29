// Guideline nudge engine (issue #13, plan §pie-too-many-slices). Pure,
// framework-independent -- no React, no DOM -- mirroring
// `chart-encoding.ts`'s own `detectNumericMismatch(type, encoding, rows)`
// signature family (decomposed fields, not a whole `Chart`) so a caller
// memoizing this against React state depends on exactly the field this
// rule set actually reads, not the whole chart object -- which also
// changes on every title/options-only edit and would defeat that
// memoization entirely (the same reasoning `detectNumericMismatch`'s own
// doc comment gives).
import type { ChartVariant } from "@hyakkei/schema";
import type { Row } from "../renderer/render-model.js";
import rawGuidelineRules from "./guideline-rules.json" with { type: "json" };

export type GuidelineRuleStatus = "active" | "doc-only";

/**
 * `url` is required, not `string | null`. It was nullable until issue #123 closed
 * ADR-0016 RR-2; the type is what keeps a *newly added* rule from re-entering
 * that state, since the exact-match tests in `guideline.test.ts` only pin the
 * URLs that exist today.
 */
export type GuidelineCitation = { label: string; url: string };

export type GuidelineRule = {
  id: string;
  status: GuidelineRuleStatus;
  severity: "warning";
  message: string;
  citation: GuidelineCitation;
  threshold?: number;
};

export type GuidelineNudge = {
  ruleId: string;
  message: string;
  citation: GuidelineCitation;
};

type GuidelinePredicate = (type: ChartVariant["type"], rows: Row[], rule: GuidelineRule) => boolean;

/**
 * Closed dispatch table (security-specialist/Codex①: no JSON-encoded
 * predicate DSL, no eval/regex-from-data). Only `status:"active"` rules
 * need an entry here -- `truncated-axis`/`palette-order`/`3d-anything` are
 * `status:"doc-only"` (ADR-0016: v0.1's authorable surface has no way to
 * express a violation of any of the three) and intentionally have none.
 *
 * `pie-too-many-slices` counts `rows.length` (the number of wedges
 * `pieOption()` actually draws, `build-options.ts`), not a distinct-category
 * count -- the schema does not forbid a duplicate `category` value across
 * rows, and a duplicate-category row still draws its own wedge, which is
 * exactly the visual-clutter concern this rule exists to catch.
 */
const RULE_PREDICATES: Record<string, GuidelinePredicate> = {
  "pie-too-many-slices": (type, rows, rule) =>
    type === "pie" && rows.length > (rule.threshold ?? Number.POSITIVE_INFINITY),
};

const KNOWN_STATUSES = new Set<GuidelineRuleStatus>(["active", "doc-only"]);

/**
 * Whether a string is usable as a citation source. See the call site in
 * `validateGuidelineRules` for what this deliberately does and does not cover.
 *
 * The `https:`-only and no-credentials pair also appears in `classifyUrlTarget`
 * (`packages/core/src/datasource/egress-policy.ts`) and, as a schema pattern, on
 * `UrlSource.ref.url` (`packages/schema/src/dashboard.ts`). This is a third
 * authoring-time layer rather than a caller of either: `classifyUrlTarget`
 * additionally requires `origin === selfOrigin`, and a citation is third-party
 * *by definition* (`www.digital.go.jp`, `github.com`), so no `selfOrigin` makes
 * one pass. It also adds `href === value`, which egress must not have — that
 * layer deliberately accepts relative refs resolved against a base. Those two
 * files cross-reference each other for the same reason; if credential or scheme
 * handling changes in any of the three, check the other two.
 */
function isCitationUrl(value: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return false;
  }
  if (parsed.protocol !== "https:") return false;
  // `username`/`password` are "" when absent, so this rejects `https://u:p@host`
  // and `https://u@host` alike.
  if (parsed.username !== "" || parsed.password !== "") return false;
  // Require the authored string to survive parsing unchanged. `new URL()`
  // silently normalises whitespace -- a space becomes `%20`, tabs and newlines
  // are *deleted*, surrounding whitespace is trimmed -- so without this, the
  // string a reviewer reads in `guideline-rules.json` (and the exact-match tests
  // pin) could differ from the URL it actually resolves to. Also rejects a
  // trailing-slash-less origin being reshaped, uppercase schemes, and similar
  // near-misses: for a developer-authored constant, "write it in canonical
  // form" is cheaper than reasoning about what the parser rewrote.
  return parsed.href === value;
}

/**
 * Fail-closed: throws naming exactly what's wrong (CI/unit-test path only,
 * `guideline.test.ts`). `getGuidelineRules()` below is the fail-open sibling
 * the runtime UI path actually calls.
 */
export function validateGuidelineRules(raw: unknown): GuidelineRule[] {
  if (!Array.isArray(raw)) {
    throw new Error("guideline-rules.json: expected an array of rules");
  }
  const seenIds = new Set<string>();
  return raw.map((entry, index) => {
    if (!entry || typeof entry !== "object") {
      throw new Error(`guideline-rules.json[${index}]: expected an object`);
    }
    const { id, status, severity, message, citation, threshold } = entry as Record<string, unknown>;
    if (typeof id !== "string" || id.length === 0) {
      throw new Error(`guideline-rules.json[${index}]: "id" must be a non-empty string`);
    }
    if (seenIds.has(id)) {
      throw new Error(`guideline-rules.json: duplicate rule id "${id}"`);
    }
    seenIds.add(id);
    if (!KNOWN_STATUSES.has(status as GuidelineRuleStatus)) {
      throw new Error(`guideline-rules.json[${id}]: unknown status "${String(status)}"`);
    }
    // A status:"active" rule with no registered predicate would silently
    // never fire (Codex②: this must fail CI, not ship as a vacuous rule).
    if (status === "active" && !Object.hasOwn(RULE_PREDICATES, id)) {
      throw new Error(
        `guideline-rules.json[${id}]: status is "active" but no predicate is registered in RULE_PREDICATES`,
      );
    }
    if (severity !== "warning") {
      throw new Error(`guideline-rules.json[${id}]: unknown severity "${String(severity)}"`);
    }
    if (typeof message !== "string" || message.length === 0) {
      throw new Error(`guideline-rules.json[${id}]: "message" must be a non-empty string`);
    }
    // The emptiness check on `label` mirrors `message`'s above, which had it
    // from the start while `label` did not (issue #123). The asymmetry mattered:
    // `label` is the only citation field any UI renders (`ChartBuilder.tsx`
    // prints `出典: {label}` and never reads `url`), so `label: ""` passed
    // validation and shipped a nudge whose source line read "出典: " and named
    // nothing -- the same "cites something that isn't there" defect this issue
    // fixed in the data.
    // `?? {}` rather than a container-shape check first: destructuring only
    // throws for null/undefined, and every other non-object (a number, a string,
    // an array) yields `undefined` for both fields, which the two checks below
    // reject with the same messages. So this covers the container case without a
    // separate branch, and without the ordering hazard the previous form had --
    // reading `url` was only null-safe there because the label check had already
    // thrown.
    const { label, url } = (citation ?? {}) as Record<string, unknown>;
    if (typeof label !== "string" || label.trim().length === 0) {
      throw new Error(`guideline-rules.json[${id}]: "citation.label" must be a non-empty string`);
    }
    // Parsed, not pattern-matched (see `isCitationUrl`), and no longer nullable
    // (see `GuidelineCitation`).
    //
    // `https:` specifically, because a citation is already best-effort on the
    // primary deployment target, which is air-gapped (ADR-0016) -- an `http:`
    // source would be neither reachable nor trustworthy there. Credentials are
    // rejected because a citation has no business carrying any, and because the
    // field is a sink the moment anything renders it as a link (nothing does
    // today: `ChartBuilder.tsx` prints `label` only, deliberately).
    //
    // What this still does NOT do, so nobody mistakes it for more: any host
    // passes, including homographs (`digitaI.go.jp` with a capital I parses
    // fine). That is caught one layer up in `guideline.test.ts`, by an
    // exact-match pin per rule plus a host allowlist. This check is the floor
    // for a *new* rule nobody has pinned yet, not what makes today's four
    // trustworthy.
    //
    // Reachability is deliberately not checked either: that would put a network
    // call in CI, and it is carried instead by the dated attestation table in
    // `docs/guidebook-coverage.md`.
    if (typeof url !== "string" || !isCitationUrl(url)) {
      throw new Error(`guideline-rules.json[${id}]: "citation.url" must be an https:// URL`);
    }
    // The page number is stated twice per rule -- in the label's prose, so it is
    // followable from a PDF on a USB stick, and in the URL's `#page=` fragment,
    // so it is one click away online -- and nothing linked the copies. Same shape
    // as the threshold restated in `message`, which `guideline.test.ts` pins
    // across all rules; this is that invariant for the page, and it belongs in
    // the validator rather than a test because the exact-match pins only cover
    // the rules that exist today. Page numbers are the volatile part: the file at
    // the guidebook's URL has already been re-generated under an unchanged
    // version label (see the attestation table in `docs/guidebook-coverage.md`).
    //
    // First occurrence only. `truncated-axis` legitimately names a second page
    // in prose (p41, same principle stated in the 原則 section) while its URL
    // targets the Do/Don't page the rule is named for.
    //
    // Precisely: a label with no `pNN` match is exempt — which covers
    // `palette-order` (cites the Power BI theme JSON, states no page), but also
    // means a page written any other way (`p.34`, `34ページ`, full-width `ｐ３４`)
    // silently skips this check rather than failing it (QA Phase 8, m-2). The
    // exact-match pins in `guideline.test.ts` still hold the four shipped labels
    // to the canonical `pNN` form; this guard is the linkage check for labels
    // that use it, not an enforcement that they must.
    const labelPage = /\bp(\d+)/.exec(label)?.[1];
    const urlPage = /#page=(\d+)/.exec(url)?.[1];
    if (labelPage !== undefined && urlPage !== labelPage) {
      throw new Error(
        `guideline-rules.json[${id}]: "citation.label" cites p${labelPage} but "citation.url" points at ${urlPage === undefined ? "no page" : `p${urlPage}`}`,
      );
    }
    if (threshold !== undefined && (!Number.isInteger(threshold) || (threshold as number) < 0)) {
      throw new Error(`guideline-rules.json[${id}]: "threshold" must be a non-negative integer`);
    }
    const rule: GuidelineRule = {
      id,
      status: status as GuidelineRuleStatus,
      severity: "warning",
      message,
      citation: { label, url },
    };
    return threshold === undefined ? rule : { ...rule, threshold: threshold as number };
  });
}

let cachedRules: GuidelineRule[] | null = null;

/**
 * Catches and falls back to `[]` (fail-open, Codex② Major finding): a
 * malformed `guideline-rules.json` must not crash the editor -- this is the
 * only function the runtime UI path (`evaluateGuidelines`) calls.
 */
export function getGuidelineRules(): GuidelineRule[] {
  if (cachedRules) return cachedRules;
  try {
    cachedRules = validateGuidelineRules(rawGuidelineRules);
  } catch {
    cachedRules = [];
  }
  return cachedRules;
}

/**
 * `(type, rows) -> nudges`, mirroring `detectNumericMismatch`'s own shape.
 *
 * Bracket access on `RULE_PREDICATES` without a `hasOwn` guard (/simplify
 * Simplification finding): every rule reaching this loop with
 * `status:"active"` already passed through `validateGuidelineRules`'s own
 * `hasOwn` check (above) -- which throws for an unregistered id, and
 * `getGuidelineRules` catches that throw and returns `[]` before this loop
 * ever runs -- so `rule.id` is guaranteed to be a real key here. A hostile
 * `"__proto__"` id specifically can't reach this point either: `hasOwn`
 * (not a truthy check) is what `validateGuidelineRules` uses, and
 * `RULE_PREDICATES` has no own `"__proto__"` key, so such a rule would
 * already have failed validation upstream.
 */
export function evaluateGuidelines(type: ChartVariant["type"], rows: Row[]): GuidelineNudge[] {
  const nudges: GuidelineNudge[] = [];
  for (const rule of getGuidelineRules()) {
    if (rule.status !== "active") continue;
    if (RULE_PREDICATES[rule.id]?.(type, rows, rule)) {
      nudges.push({ ruleId: rule.id, message: rule.message, citation: rule.citation });
    }
  }
  return nudges;
}
