import { describe, expect, it } from "vitest";
import { SCHEMA_PACKAGE_VERSION } from "./index.js";

describe("schema package scaffold", () => {
  it("exposes a version constant", () => {
    expect(SCHEMA_PACKAGE_VERSION).toBe(1);
  });
});
