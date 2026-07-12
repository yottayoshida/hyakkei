// Golden-test support only (not part of `@hyakkei/core`'s public surface --
// nothing under `__golden__/` is re-exported from `./index.ts` or
// `../index.ts`, so `bundle-isolation.test.ts`'s viewer-reachable graph
// never sees it). ECharts' own SSR/DOM SVG renderer is instance-scoped and
// non-deterministic across separate `echarts.init()` calls in the same
// process: two SSR renders of the byte-identical `EChartsOption` produce
// different `id`/`class` tokens (e.g. `zr0-cls-0` vs `zr1-cls-5` --
// confirmed empirically before writing this) AND a different attribute
// insertion order within a tag. A snapshot pinned against raw output would
// fail on every unrelated test-file reordering or attribute-order jitter,
// not just real regressions.
//
// /code-review (xhigh) found the first version of this file normalized ids
// BEFORE sorting attributes, so the very attribute-order jitter above could
// flip which token was "first" and get assigned canonical `ID0` -- two
// renders of identical content could then normalize to DIFFERENT strings
// (a false positive). It also applied decimal-rounding and id-replacement
// as whole-string passes with no attribute/text-content boundary, so a
// rendered `<text>` data label containing digits or an id-shaped substring
// could be silently rounded/rewritten -- masking a real content regression
// (a false negative, the single most dangerous failure mode for this
// layer). This version fixes both classes of bug structurally:
//
// Pass 1 (sortAttributesByName): reorders each tag's attributes by NAME
// only, never inspecting a value -- safe to run first, and it makes
// "first occurrence" in Pass 2 depend on name order, not ECharts' own
// jittery attribute insertion order.
//
// Pass 2: a single left-to-right scan of the name-sorted document, with one
// `seenIds` map shared across the whole document (so occurrence order is
// real document order), that normalizes two DIFFERENT scopes differently:
// attribute values get BOTH id-canonicalization AND decimal-rounding
// (normalizeAttributeValues); `<style>` block CSS text gets id-
// canonicalization ONLY, no decimal-rounding (normalizeStyleBlock -- see
// its own doc comment for why). ECharts embeds `:hover` selectors
// referencing the same ids there, e.g. `.zr0-cls-3:hover {...}` --
// discovered when committed snapshots didn't regenerate identically until
// this branch was added. Everything else -- element text content like a
// `<text>` data label -- is never touched by either pass.
const INSTANCE_SCOPED_ID = /\bzr\d+-[A-Za-z0-9_-]+\b/g;

const DECIMAL_NUMBER = /-?\d+\.\d+/g;
const DECIMAL_PRECISION = 2;
const NEGATIVE_ZERO = `-${(0).toFixed(DECIMAL_PRECISION)}`;

/** Matches a single opening tag's contents; SVG attribute values never
 * contain `<` or `>`, so a non-greedy scan between them is safe here (this
 * is not a general XML parser). */
const OPENING_TAG = /<([a-zA-Z][\w:-]*)((?:\s+[\w:-]+="[^"]*")*)(\s*\/?)>/g;
const ATTR = /\s+([\w:-]+)="([^"]*)"/g;

/**
 * Alternates between a `<style>...</style>` block (captures 1-2) and a
 * plain opening tag (captures 3-5), so Pass 2 can walk the whole document
 * in true left-to-right order with one shared `seenIds` map -- splitting
 * this into two separate `.replace()` calls (all style blocks, then all
 * tags) would canonicalize by "style blocks first" order instead of the
 * document's own true occurrence order whenever the two are interleaved.
 */
const STYLE_BLOCK_OR_OPENING_TAG =
  /<style([^>]*)>([\s\S]*?)<\/style>|<([a-zA-Z][\w:-]*)((?:\s+[\w:-]+="[^"]*")*)(\s*\/?)>/g;

/** `toFixed` preserves the sign of a value that rounds to zero (`-0.001`
 * -> `"-0.00"`), which would make two renders whose true values straddle
 * zero by float noise (e.g. -0.001 vs 0.001) normalize to different
 * strings -- exactly the flake class this rounding step exists to remove. */
function roundDecimal(raw: string): string {
  const rounded = Number.parseFloat(raw).toFixed(DECIMAL_PRECISION);
  return rounded === NEGATIVE_ZERO ? rounded.slice(1) : rounded;
}

function canonicalizeIdToken(token: string, seenIds: Map<string, string>): string {
  const existing = seenIds.get(token);
  if (existing) return existing;
  const canonical = `ID${seenIds.size}`;
  seenIds.set(token, canonical);
  return canonical;
}

/** Pure structural reorder by attribute NAME -- never inspects or rewrites
 * a VALUE, so this is safe to run before any id/decimal normalization
 * (whose "first occurrence" and rounding logic must see a name-order-
 * stable string, not ECharts' own jittery insertion order). */
function sortAttributesByName(name: string, attrs: string, selfClose: string): string {
  const pairs = [...attrs.matchAll(ATTR)].map((m) => [m[1]!, m[2]!] as const);
  pairs.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  const sorted = pairs.map(([k, v]) => ` ${k}="${v}"`).join("");
  return `<${name}${sorted}${selfClose}>`;
}

/**
 * Canonicalizes instance-scoped ids by first-occurrence order rather than
 * stripping them: two SVGs with a genuinely different number of distinct
 * ids (e.g. one gained an extra gradient def) still diverge after this,
 * while two SVGs differing only in which arbitrary counter value ECharts
 * assigned collapse to the same normalized text.
 */
function normalizeAttributeValues(
  name: string,
  attrs: string,
  selfClose: string,
  seenIds: Map<string, string>,
): string {
  const pairs = [...attrs.matchAll(ATTR)].map((m) => [m[1]!, m[2]!] as const);
  const normalized = pairs.map(([key, value]) => {
    const idsCanonicalized = value.replace(INSTANCE_SCOPED_ID, (token) =>
      canonicalizeIdToken(token, seenIds),
    );
    const decimalsRounded = idsCanonicalized.replace(DECIMAL_NUMBER, roundDecimal);
    return ` ${key}="${decimalsRounded}"`;
  });
  return `<${name}${normalized.join("")}${selfClose}>`;
}

/**
 * `animation: false` (build-options.ts, always set on the real render
 * path) means no `@keyframes`/decimal-bearing animation CSS reaches a
 * `<style>` block here -- only `:hover` selector text referencing
 * instance-scoped class ids -- so only id-canonicalization runs here, not
 * decimal-rounding (there is no legitimate decimal content in this branch
 * to round, and not rounding avoids silently absorbing content this
 * normalizer was never designed to reason about if that assumption ever
 * changes -- a future ECharts version adding real decimal content here
 * would surface as a visible, investigable snapshot diff instead of being
 * silently masked).
 */
function normalizeStyleBlock(
  styleAttrs: string,
  styleContent: string,
  seenIds: Map<string, string>,
): string {
  const idsCanonicalized = styleContent.replace(INSTANCE_SCOPED_ID, (token) =>
    canonicalizeIdToken(token, seenIds),
  );
  return `<style${styleAttrs}>${idsCanonicalized}</style>`;
}

export function normalizeSvg(svg: string): string {
  const attributesSorted = svg.replace(OPENING_TAG, (_tag, name, attrs, selfClose) =>
    sortAttributesByName(name, attrs, selfClose),
  );

  const seenIds = new Map<string, string>();
  return attributesSorted.replace(
    STYLE_BLOCK_OR_OPENING_TAG,
    (_match, styleAttrs, styleContent, tagName, tagAttrs, selfClose) =>
      styleContent !== undefined
        ? normalizeStyleBlock(styleAttrs, styleContent, seenIds)
        : normalizeAttributeValues(tagName, tagAttrs, selfClose, seenIds),
  );
}
