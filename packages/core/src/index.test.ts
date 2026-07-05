import { describe, expect, it } from "vitest";
import { CORE_PACKAGE_VERSION } from "./index.js";

describe("core package scaffold", () => {
  it("resolves the schema package dependency across the workspace boundary", () => {
    expect(CORE_PACKAGE_VERSION).toBe(1);
  });
});
