import { SqlIdentifier } from "@hyakkei/schema";
import { describe, expect, it } from "vitest";
import { generateSourceId } from "./identifier.js";

// Derived from the REAL schema contract (packages/schema/src/common.ts),
// not a hand-copied duplicate (Phase 6-B adversarial review: a hand-rolled
// regex here would not notice if `SqlIdentifier`'s pattern/length ever
// drifted from what this function actually needs to satisfy). TypeBox's
// `Type.String({pattern, maxLength})` is a plain object exposing those
// JSON-Schema keywords directly.
const SQL_IDENTIFIER_PATTERN = new RegExp(SqlIdentifier.pattern!);
const SQL_IDENTIFIER_MAX_LENGTH = SqlIdentifier.maxLength!;

function expectValidSqlIdentifier(id: string): void {
  expect(id).toMatch(SQL_IDENTIFIER_PATTERN);
  expect(id.length).toBeLessThanOrEqual(SQL_IDENTIFIER_MAX_LENGTH);
}

describe("generateSourceId", () => {
  it("strips the extension and produces a plain SqlIdentifier for an ASCII filename", () => {
    const id = generateSourceId("sales.csv", new Set());
    expect(id).toBe("sales");
    expectValidSqlIdentifier(id);
  });

  it("an all-non-ASCII filename (no valid characters survive) falls back to a generic base", () => {
    const id = generateSourceId("売上データ.xlsx", new Set());
    expect(id).toBe("table");
    expectValidSqlIdentifier(id);
  });

  it("an empty label falls back to the same generic base", () => {
    expect(generateSourceId("", new Set())).toBe("table");
  });

  it("prefixes (not replaces) a leading digit — SqlIdentifier requires a letter/underscore start, but source identity should still survive", () => {
    const id = generateSourceId("123data.csv", new Set());
    // Exact value, not just "matches the pattern" (Phase 6-B: the original
    // assertion would have passed even if the whole name were discarded
    // and replaced by the generic fallback, silently losing source
    // identity for every digit-leading filename).
    expect(id).toBe("_123data");
    expectValidSqlIdentifier(id);
  });

  it("a reserved-SQL-word-shaped name passes through unchanged (quoting is quoteIdentifier's job, not this function's)", () => {
    expect(generateSourceId("select.csv", new Set())).toBe("select");
  });

  it("truncates to the SqlIdentifier length ceiling", () => {
    const longName = `${"a".repeat(100)}.csv`;
    const id = generateSourceId(longName, new Set());
    expect(id).toBe("a".repeat(SQL_IDENTIFIER_MAX_LENGTH));
    expectValidSqlIdentifier(id);
  });

  it("dedupes against usedIds by appending an incrementing numeric suffix, through a third collision", () => {
    const used = new Set<string>();
    const first = generateSourceId("sales.csv", used);
    used.add(first);
    const second = generateSourceId("sales.csv", used);
    expect(second).not.toBe(first);
    expect(second).toBe("sales_2");
    used.add(second);
    const third = generateSourceId("sales.csv", used);
    expect(third).toBe("sales_3");
    expect(third).not.toBe(first);
    expect(third).not.toBe(second);
  });

  it("a deduped suffix never pushes the result past the SqlIdentifier length ceiling", () => {
    const longBase = "a".repeat(70);
    const used = new Set([longBase.slice(0, SQL_IDENTIFIER_MAX_LENGTH)]);
    const id = generateSourceId(`${longBase}.csv`, used);
    expectValidSqlIdentifier(id);
    expect(used.has(id)).toBe(false);
  });
});
