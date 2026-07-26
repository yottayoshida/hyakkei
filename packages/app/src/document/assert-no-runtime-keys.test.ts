import { describe, expect, it } from "vitest";
import { assertNoRuntimeKeys, RuntimeKeyLeakError } from "./assert-no-runtime-keys.js";

describe("assertNoRuntimeKeys", () => {
  it("does not throw on a clean Dashboard-shaped document", () => {
    const doc = {
      version: 1,
      meta: { title: "x" },
      theme: { tokens: "@digital-go-jp/design-tokens@2.0.1", palette: "guidebook-blue" },
      sources: [{ id: "s1", kind: "file", format: "csv", ref: { name: "a.csv" } }],
      queries: [{ id: "q1", source: "s1", sql: "SELECT 1" }],
      charts: [{ id: "c1", type: "bar", encoding: { x: "a", y: "b" }, options: {} }],
      layout: { grid: "guidebook-12col", items: [] },
    };
    expect(() => assertNoRuntimeKeys(doc)).not.toThrow();
  });

  // issue #15/F7, V-005: the fail-closed gate must actually fire, not just
  // read as correct -- each key is tested individually, at the position it
  // would realistically leak from (sources[].sample, sources[].validation,
  // queries[].diagnostics, etc).
  it.each([
    ["sourceLabel"],
    ["sample"],
    ["validation"],
    ["previewRows"],
    ["previewPending"],
    ["table"],
    ["rows"],
    ["values"],
    ["castFailed"],
    ["samples"],
    ["nonNullCount"],
    ["uncastableCount"],
    ["advisory"],
    ["sourceTableId"],
    ["previewColumns"],
    ["diagnostics"],
  ])("throws RuntimeKeyLeakError when key %s is present anywhere in the tree", (key) => {
    const doc = { sources: [{ id: "s1", [key]: "leak" }] };
    expect(() => assertNoRuntimeKeys(doc)).toThrow(RuntimeKeyLeakError);
  });

  it("reports the exact path a leaked key was found at", () => {
    const doc = { sources: [{ id: "s1" }, { id: "s2", sample: "leak" }] };
    try {
      assertNoRuntimeKeys(doc);
      expect.unreachable("expected assertNoRuntimeKeys to throw");
    } catch (err) {
      expect(err).toBeInstanceOf(RuntimeKeyLeakError);
      expect((err as RuntimeKeyLeakError).path).toBe("$.sources[1]");
      expect((err as RuntimeKeyLeakError).key).toBe("sample");
    }
  });

  // shape enumeration A12: `assertNoRuntimeKeys` must match key NAMES only.
  // A column literally named "sample"/"rows"/etc. is schema-legal data
  // (`common.ts`'s free-form `NonEmptyString`), reachable as a VALUE at
  // e.g. `Chart.encoding.x` -- this must not false-positive.
  it("does not flag a deny-listed word appearing as a VALUE, only as a key", () => {
    const doc = {
      charts: [{ id: "c1", type: "pie", encoding: { category: "rows", value: "sample" } }],
    };
    expect(() => assertNoRuntimeKeys(doc)).not.toThrow();
  });

  // shape enumeration A13: Map/Set silently become `{}` under
  // JSON.stringify, invisible to both parseDashboard (additive) and a
  // canary test (no cell values survive). Only a runtime-type check catches
  // this class, independent of any key name.
  it("throws on a Map value even though it carries no deny-listed key", () => {
    const doc = { sources: [{ id: "s1", weirdField: new Map([["a", 1]]) }] };
    expect(() => assertNoRuntimeKeys(doc)).toThrow(RuntimeKeyLeakError);
  });

  it("throws on a Set value", () => {
    const doc = { sources: [{ id: "s1", weirdField: new Set([1, 2]) }] };
    expect(() => assertNoRuntimeKeys(doc)).toThrow(RuntimeKeyLeakError);
  });

  it("throws on a Date value", () => {
    const doc = { meta: { title: "x", weirdField: new Date() } };
    expect(() => assertNoRuntimeKeys(doc)).toThrow(RuntimeKeyLeakError);
  });

  // shape enumeration R6: an own-property `undefined` value (e.g.
  // Chart.encoding.size after a scatter type-switch, Chart.options.title
  // after clearing a title) is a legitimate projection artifact, not a
  // leak -- JSON.stringify drops it regardless.
  it("does not flag an own-property undefined value", () => {
    const doc = {
      charts: [{ id: "c1", type: "scatter", encoding: { x: "a", y: "b", size: undefined } }],
    };
    expect(() => assertNoRuntimeKeys(doc)).not.toThrow();
  });

  // The load-bearing end-to-end property (canary): a real cell value must
  // never survive into a document this function approves, regardless of
  // which deny-listed container it was smuggled through.
  it("canary: a real cell value reachable only via a denied key is caught before it could serialize", () => {
    const CANARY = "PII-CANARY-\u{1F600}-42";
    const doc = {
      sources: [
        {
          id: "s1",
          sample: { rows: [{ 氏名: CANARY }] },
        },
      ],
    };
    expect(() => assertNoRuntimeKeys(doc)).toThrow(RuntimeKeyLeakError);
  });

  // issue #15/F7, Codex Round 1 P1: the previous version returned early for
  // ANY non-object value before `isPlainSerializable` could ever run on
  // it, so a function/bigint/symbol/non-finite-number reached as a NESTED
  // value (not the top-level argument) was silently approved. These pin
  // that each is actually rejected now, at a realistic nested position.
  it("throws on a function value nested in the tree", () => {
    const doc = { meta: { title: "x", weirdField: () => 1 } };
    expect(() => assertNoRuntimeKeys(doc)).toThrow(RuntimeKeyLeakError);
  });

  it("throws on a bigint value nested in the tree", () => {
    const doc = { meta: { title: "x", weirdField: 1n } };
    expect(() => assertNoRuntimeKeys(doc)).toThrow(RuntimeKeyLeakError);
  });

  it("throws on a symbol value nested in the tree", () => {
    const doc = { meta: { title: "x", weirdField: Symbol("leak") } };
    expect(() => assertNoRuntimeKeys(doc)).toThrow(RuntimeKeyLeakError);
  });

  it.each([NaN, Infinity, -Infinity])(
    "throws on a non-finite number (%s) nested in the tree -- JSON.stringify would silently turn it into null",
    (n) => {
      const doc = { meta: { title: "x", weirdField: n } };
      expect(() => assertNoRuntimeKeys(doc)).toThrow(RuntimeKeyLeakError);
    },
  );

  it("does not flag an ordinary finite number", () => {
    const doc = {
      layout: { grid: "guidebook-12col", items: [{ chart: "c1", x: 0, y: 0, w: 6, h: 4 }] },
    };
    expect(() => assertNoRuntimeKeys(doc)).not.toThrow();
  });

  // Codex Round 1 P1: an `undefined` ARRAY ELEMENT is not the same as an
  // own-property `undefined` value -- `JSON.stringify` turns the former
  // into `null` (changing what the saved document says), the latter into
  // nothing (omitting the key). Only the latter is allowed (see the
  // "own-property undefined" test above).
  it("throws on an undefined array element, unlike an own-property undefined value", () => {
    const doc = { charts: [{ id: "c1" }, undefined, { id: "c2" }] };
    expect(() => assertNoRuntimeKeys(doc)).toThrow(RuntimeKeyLeakError);
  });
});
