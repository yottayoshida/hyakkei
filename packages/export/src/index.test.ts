import { describe, expect, it } from "vitest";
import { EXPORT_PACKAGE_VERSION } from "./index.js";

describe("export package scaffold", () => {
  it("resolves the core package dependency across the workspace boundary", () => {
    expect(EXPORT_PACKAGE_VERSION).toBe(1);
  });
});
