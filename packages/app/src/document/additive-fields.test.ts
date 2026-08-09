import { describe, expect, it } from "vitest";
import { assertSerializableAdditiveFields } from "./additive-fields.js";

describe("assertSerializableAdditiveFields", () => {
  it("rejects sparse arrays instead of silently serializing holes as null", () => {
    const sparse = [] as unknown[];
    sparse.length = 1;
    expect(() => assertSerializableAdditiveFields(sparse)).toThrow(/sparse array hole/);
  });

  it("rejects symbol keys that JSON.stringify would omit", () => {
    const value = { stable: true } as Record<string | symbol, unknown>;
    value[Symbol("future")] = "not representable";
    expect(() => assertSerializableAdditiveFields(value)).toThrow(/symbol keys/);
  });

  it("rejects cycles with a typed error instead of overflowing the stack", () => {
    const value: Record<string, unknown> = {};
    value.self = value;
    expect(() => assertSerializableAdditiveFields(value)).toThrow(/contains a cycle/);
  });
});
