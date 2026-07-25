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

export type GuidelineCitation = { label: string; url: string | null };

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
    if (
      !citation ||
      typeof citation !== "object" ||
      typeof (citation as Record<string, unknown>).label !== "string"
    ) {
      throw new Error(`guideline-rules.json[${id}]: "citation.label" must be a string`);
    }
    const url = (citation as Record<string, unknown>).url;
    if (url !== null && typeof url !== "string") {
      throw new Error(`guideline-rules.json[${id}]: "citation.url" must be a string or null`);
    }
    if (threshold !== undefined && (!Number.isInteger(threshold) || (threshold as number) < 0)) {
      throw new Error(`guideline-rules.json[${id}]: "threshold" must be a non-negative integer`);
    }
    const rule: GuidelineRule = {
      id,
      status: status as GuidelineRuleStatus,
      severity: "warning",
      message,
      citation: { label: (citation as { label: string }).label, url: url as string | null },
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
