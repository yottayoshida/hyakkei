import { describe, expect, it, vi } from "vitest";
import { classifyQueryError } from "./query-error.js";

describe("classifyQueryError", () => {
  it("prefers the data-layer classifier for an out-of-memory failure", () => {
    const classifyRegisterFailure = vi.fn(() => "oom");

    expect(classifyQueryError(new Error("opaque wasm failure"), classifyRegisterFailure)).toBe(
      "oom",
    );
    expect(classifyRegisterFailure).toHaveBeenCalledOnce();
  });

  it("falls back to the stable DuckDB OOM prefix when the classifier is unavailable", () => {
    expect(classifyQueryError(new Error("Out of Memory Error: could not allocate block"))).toBe(
      "oom",
    );
  });

  it("normalizes all other failures without exposing their message", () => {
    expect(classifyQueryError(new Error("Binder Error: secret table name"))).toBe("query");
    expect(classifyQueryError("a string thrown by a dependency")).toBe("query");
  });
});
