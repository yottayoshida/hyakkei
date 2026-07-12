// /code-review (xhigh): formatParseFailure() had exactly one caller
// (packages/core/src/golden-fixtures/sample-dashboards.ts's goldenSample())
// and zero direct tests -- its actual formatting logic only ran because all
// 3 golden fixtures happened to stay schema-valid. These tests exercise it
// directly, independent of any fixture's validity.
import { describe, expect, it } from "vitest";
import { formatParseFailure, parseDashboard } from "./validate.js";

describe("formatParseFailure", () => {
  it("appends Ajv's errorsText detail when the failure has schema errors", () => {
    const result = parseDashboard({ version: 1 }); // missing every other required field
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    const message = formatParseFailure(result);
    expect(message).toContain(result.reason);
    expect(message).toMatch(/\(.*must have required property.*\)/);
  });

  it("falls back to the bare reason when there is no errors array (version rejection)", () => {
    const result = parseDashboard({ version: 2 }); // checkVersion rejects before Ajv ever runs
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.errors).toBeUndefined();
    expect(formatParseFailure(result)).toBe(result.reason);
  });

  it("falls back to the bare reason when errors is an empty array", () => {
    // Defensive case: `errors?.length` (not just `errors`) gates the detail
    // append, so an empty (as opposed to absent) array must not produce a
    // dangling " ()" suffix.
    expect(formatParseFailure({ ok: false, reason: "custom failure", errors: [] })).toBe(
      "custom failure",
    );
  });
});
