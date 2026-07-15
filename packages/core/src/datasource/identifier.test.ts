import { describe, expect, it } from "vitest";
import { quoteIdentifier, quoteStringLiteral } from "./identifier.js";

describe("quoteIdentifier", () => {
  it("wraps a plain identifier in double quotes", () => {
    expect(quoteIdentifier("apps")).toBe('"apps"');
  });

  it("doubles an embedded double-quote (SI-A3/SI-A4: SQL reserved words become safe unquoted-keyword text once quoted)", () => {
    expect(quoteIdentifier("select")).toBe('"select"');
    expect(quoteIdentifier('a"b')).toBe('"a""b"');
  });

  it("preserves Japanese/whitespace/special-char column names verbatim inside the quotes (CS-9/V-082: these are data, not SqlIdentifier-restricted)", () => {
    expect(quoteIdentifier("申請 件数")).toBe('"申請 件数"');
    expect(quoteIdentifier("__proto__")).toBe('"__proto__"');
  });
});

describe("quoteStringLiteral", () => {
  it("wraps a plain value in single quotes", () => {
    expect(quoteStringLiteral("__hyakkei_buf_0.csv")).toBe("'__hyakkei_buf_0.csv'");
  });

  it("doubles an embedded single-quote (defense-in-depth for the internally-generated virtual file name path)", () => {
    expect(quoteStringLiteral("a'b")).toBe("'a''b'");
  });
});
