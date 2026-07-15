import { describe, expect, it } from "vitest";
import { assertByteCeiling, DEFAULT_MAX_BYTES } from "./byte-gate.js";
import { DataSourceError } from "./types.js";

describe("assertByteCeiling", () => {
  it("accepts content at or under the ceiling", () => {
    expect(() => assertByteCeiling(new Uint8Array(10), 10)).not.toThrow();
  });

  it("V-089/ADV-4: rejects content over the ceiling as too-large", () => {
    try {
      assertByteCeiling(new Uint8Array(11), 10);
      throw new Error("expected throw");
    } catch (e) {
      expect(e).toBeInstanceOf(DataSourceError);
      expect((e as DataSourceError).kind).toBe("too-large");
    }
  });

  it("defaults to the 256 MiB ceiling shared with EgressPolicy's DEFAULT_MAX_BYTES", () => {
    expect(DEFAULT_MAX_BYTES).toBe(256 * 1024 * 1024);
    expect(() => assertByteCeiling(new Uint8Array(DEFAULT_MAX_BYTES))).not.toThrow();
  });
});
