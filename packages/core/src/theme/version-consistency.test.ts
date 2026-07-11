import designTokensPackage from "@digital-go-jp/design-tokens/package.json" with { type: "json" };
import { parseDashboard } from "@hyakkei/schema";
import { describe, expect, it } from "vitest";

/**
 * CI assert (plan §PR-A step 3): "installed version ∈ schema enum". Without
 * this, `packages/core` can silently drift onto a newer
 * `@digital-go-jp/design-tokens` (e.g. a routine `pnpm update`) while
 * `TokenPackage`'s allowlist (packages/schema/src/common.ts) still only
 * accepts the old pinned literal -- every dashboard.json authored against
 * the new install would then fail schema validation with no signal at the
 * dependency-bump commit itself, only much later when someone tries to
 * author a file. Uses `parseDashboard` (the same entry point real callers
 * use) rather than a direct TypeBox/Ajv check, so this test fails the same
 * way an actual author's file would.
 */
describe("design-tokens version <-> schema TokenPackage enum consistency", () => {
  it("the installed @digital-go-jp/design-tokens version is accepted by the schema", () => {
    const installedRef = `@digital-go-jp/design-tokens@${designTokensPackage.version}`;
    const doc = {
      version: 1,
      meta: { title: "t" },
      theme: { tokens: installedRef, palette: "guidebook-blue" },
      sources: [],
      queries: [],
      charts: [],
      layout: { grid: "guidebook-12col", items: [] },
    };

    const result = parseDashboard(doc);
    expect(
      result.ok,
      `schema rejects installed version '${installedRef}' -- TokenPackage (common.ts) is out of sync with packages/core's installed design-tokens version. Update the TokenPackage literal to match.`,
    ).toBe(true);
  });
});
