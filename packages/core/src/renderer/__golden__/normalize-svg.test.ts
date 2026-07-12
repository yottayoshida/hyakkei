// Independent contract tests for normalizeSvg() (Codex Phase 6-B adversarial
// review, Mirror Check finding): golden-palette.test.ts/golden-samples.
// test.ts only exercise this function *indirectly*, through committed
// snapshots -- a snapshot only proves "this changed since last approved,"
// never "this normalizer's own safety properties hold." These tests use
// hand-crafted SVG strings, independent of ECharts' actual output shape, so
// they cannot be satisfied by merely encoding whatever the current
// implementation happens to produce (the exact failure mode a mirror test
// would have).
//
// The single most dangerous failure mode for a golden-test normalizer is a
// FALSE NEGATIVE: two SVGs a human would call meaningfully different
// collapsing to the same normalized string, which would silently hide a
// real regression forever. Every "must NOT normalize equal" case below
// targets that risk directly.
import { describe, expect, it } from "vitest";
import { normalizeSvg } from "./normalize-svg.js";

describe("normalizeSvg", () => {
  it("canonicalizes instance-scoped ids that differ only by ECharts' own counter", () => {
    const a = '<path class="zr0-cls-3" fill="url(#zr0-lg-0)" d="M10 20L30 40"></path>';
    const b = '<path class="zr9-cls-8" fill="url(#zr9-lg-2)" d="M10 20L30 40"></path>';
    expect(normalizeSvg(a)).toBe(normalizeSvg(b));
  });

  it("does NOT collapse a genuine geometry difference, even when ids are positionally identical", () => {
    const a = '<path class="zr0-cls-3" d="M10 20L30 40"></path>';
    const b = '<path class="zr0-cls-3" d="M10 20L35 40"></path>';
    expect(normalizeSvg(a)).not.toBe(normalizeSvg(b));
  });

  it("does NOT collapse a genuine text-label difference (the class of bug this golden layer exists to catch)", () => {
    const a = '<text transform="translate(110 228)">建築</text>';
    const b = '<text transform="translate(110 228)">農地</text>';
    expect(normalizeSvg(a)).not.toBe(normalizeSvg(b));
  });

  it("decimal rounding: values differing beyond the rounding precision converge, values differing within it do not", () => {
    // 2 decimal places (normalize-svg.ts's DECIMAL_PRECISION): 10.001 and
    // 10.004 both round to "10.00"; 10.01 and 10.02 do not.
    expect(normalizeSvg('<path d="M10.001 0"></path>')).toBe(
      normalizeSvg('<path d="M10.004 0"></path>'),
    );
    expect(normalizeSvg('<path d="M10.01 0"></path>')).not.toBe(
      normalizeSvg('<path d="M10.02 0"></path>'),
    );
  });

  it("attribute order alone does not affect equality, but an attribute VALUE difference at any position does", () => {
    const a = '<rect x="0" y="0" width="10" height="20"></rect>';
    const bReordered = '<rect height="20" width="10" y="0" x="0"></rect>';
    const cDifferentValue = '<rect x="0" y="0" width="11" height="20"></rect>';
    expect(normalizeSvg(a)).toBe(normalizeSvg(bReordered));
    expect(normalizeSvg(a)).not.toBe(normalizeSvg(cDifferentValue));
  });

  it("a 2-digit instance counter is matched in full, not truncated at the first digit (regex boundary)", () => {
    // If `\d+` in INSTANCE_SCOPED_ID were accidentally non-greedy or
    // bounded to a single digit, "zr10-cls-3" would leave a stray "0-cls-3"
    // in the output instead of canonicalizing cleanly.
    const a = '<path class="zr10-cls-3" d="M0 0"></path>';
    const b = '<path class="zr23-cls-3" d="M0 0"></path>';
    expect(normalizeSvg(a)).toBe(normalizeSvg(b));
    expect(normalizeSvg(a)).not.toContain("0-cls-3");
  });

  it("two SVGs with different semantic id roles at the same occurrence position still diverge, because the content around them differs", () => {
    // Guards the risk a first-occurrence id canonicalizer raises in the
    // abstract: it discards *which purpose* an id served (gradient vs
    // clip-path vs pattern), keeping only occurrence order. What actually
    // keeps two structurally-different renders from colliding is that a
    // gradient fill and a clip-path reference never appear in otherwise
    // byte-identical surrounding markup -- this test documents that as an
    // explicit, checked assumption rather than an implicit one.
    const gradientFill = '<rect fill="url(#zr0-lg-0)" width="10" height="10"></rect>';
    const clipPathRef = '<rect clip-path="url(#zr0-clip-0)" width="10" height="10"></rect>';
    expect(normalizeSvg(gradientFill)).not.toBe(normalizeSvg(clipPathRef));
  });

  it("distinct ids used consistently by two different SVGs of the same shape still normalize to the same canonical form (proves the target convergence, not just non-collision)", () => {
    const a =
      '<g><path class="zr0-cls-0" d="M1 1"></path><path class="zr0-cls-0" d="M2 2"></path></g>';
    const b =
      '<g><path class="zr5-cls-9" d="M1 1"></path><path class="zr5-cls-9" d="M2 2"></path></g>';
    expect(normalizeSvg(a)).toBe(normalizeSvg(b));
  });

  // /code-review (xhigh) findings: id-canonicalization ran before
  // attribute-sort, so ECharts' own documented attribute-order jitter
  // could flip which token got assigned ID0 vs ID1 -- a false positive.
  it("id canonicalization is independent of ECharts' unstable attribute insertion order (regression: ids were canonicalized before attributes were sorted)", () => {
    const a = '<rect class="zr0-cls-3" fill="url(#zr0-lg-0)" x="1" y="2"></rect>';
    const bAttrsReordered = '<rect fill="url(#zr0-lg-0)" class="zr0-cls-3" x="1" y="2"></rect>';
    expect(normalizeSvg(a)).toBe(normalizeSvg(bAttrsReordered));
  });

  it("decimal rounding and id-canonicalization never touch element text content (regression: a whole-string pass could round/rewrite a real data label)", () => {
    // A data label of "12.345" must survive as literal text, not get
    // rounded to "12.35" the way a coordinate attribute value would.
    const withDecimalLabel = '<text x="1.0001">12.345</text>';
    expect(normalizeSvg(withDecimalLabel)).toContain(">12.345<");

    // A label whose text happens to look like an instance-scoped id token
    // must survive verbatim, not get rewritten to "IDn".
    const withIdShapedLabel = '<text x="1.0001">zr9-widget</text>';
    expect(normalizeSvg(withIdShapedLabel)).toContain(">zr9-widget<");
  });

  it("decimal rounding canonicalizes negative zero (regression: -0.001 and 0.001 normalized to different strings)", () => {
    expect(normalizeSvg('<path d="M-0.001 0"></path>')).toBe(
      normalizeSvg('<path d="M0.001 0"></path>'),
    );
    expect(normalizeSvg('<path d="M-0.001 0"></path>')).not.toContain("-0.00");
  });

  it("attribute sorting is ordinal (codepoint order), not locale-sensitive (regression: localeCompare's collation can vary by runtime ICU/locale data)", () => {
    // Under some locale collations, punctuation/case can sort differently
    // than plain codepoint order; picking attribute names that only ever
    // agree under strict ordinal comparison pins the intended behavior.
    const a = '<rect Z-attr="1" a-attr="2"></rect>';
    const b = '<rect a-attr="2" Z-attr="1"></rect>';
    expect(normalizeSvg(a)).toBe(normalizeSvg(b));
    // Ordinal: uppercase 'Z' (0x5A) sorts before lowercase 'a' (0x61).
    expect(normalizeSvg(a)).toBe('<rect Z-attr="1" a-attr="2"></rect>');
  });

  it("canonicalizes instance-scoped ids inside a <style> block's CSS text, consistently with the same id's class attribute elsewhere (discovered while regenerating committed golden snapshots: this content is genuine text content, so the attribute-only pass never reached it, leaving it raw/non-deterministic)", () => {
    const a =
      '<path class="zr0-cls-3"></path><style><![CDATA[.zr0-cls-3:hover { cursor:pointer; }]]></style>';
    const b =
      '<path class="zr9-cls-1"></path><style><![CDATA[.zr9-cls-1:hover { cursor:pointer; }]]></style>';
    expect(normalizeSvg(a)).toBe(normalizeSvg(b));
    // The class attribute and its own CSS selector resolve to the SAME
    // canonical id (both are the first-and-only distinct id in the doc).
    expect(normalizeSvg(a)).toBe(
      '<path class="ID0"></path><style><![CDATA[.ID0:hover { cursor:pointer; }]]></style>',
    );
  });
});
