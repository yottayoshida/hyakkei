// Codex Round 1 P1: `scripts/generate-ajv-validators.mjs`'s Ajv
// standalone-codegen output only worked through Vite's/Vitest's bundler-mode
// module resolution, which tolerates an extensionless specifier
// ("ajv/dist/runtime/ucs2length") — Node's own ESM resolver does not. This
// package (`@hyakkei/schema`) is `private` today with no current plain-Node
// consumer, but nothing about its `package.json` `exports` (`./dist/
// index.js`) promises otherwise, and this project has already discussed a
// future MCP server that would be exactly that kind of consumer. Spawning a
// real `node` subprocess (not Vitest's own resolver) against the real
// `dist/index.js` — same "verify empirically against the real build output,
// don't trust it by construction" principle packages/app/src/
// bundle-isolation.test.ts documents for its own dist/ read — is the only
// way to actually prove this; a Vitest-internal import proves nothing here.
//
// Requires `dist/` to already exist (root `pnpm run test` runs `pnpm run
// build` first; see that script and generate-ajv-validators.mjs's own doc
// comment for why `dist/generated/*.js` specifically needs the build step,
// not just `tsc --build`).
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

describe("@hyakkei/schema's real dist/index.js is importable by plain Node ESM", () => {
  it('`node -e "import(...)"` against dist/index.js succeeds, and the generated Ajv validators it exposes actually run correctly (not just resolve)', () => {
    // Codex Round 2 (Test Adversarial Review): a bare `typeof === "function"`
    // check proves the *import* resolved, but not that `esmifyRequires()`
    // (generate-ajv-validators.mjs) bound the right thing to the right
    // export — a mistake there could still leave `parseDashboard` callable
    // but silently broken (e.g. always-true, or throwing on the first real
    // schema check). Calling it with both a passing and a failing input
    // pins actual validator behavior, not just resolvability.
    const distIndex = join(import.meta.dirname, "..", "dist", "index.js");
    const script = `import(${JSON.stringify(distIndex)}).then((m) => {
      if (typeof m.parseDashboard !== "function" || typeof m.parseBakedDashboard !== "function") {
        throw new Error("dist/index.js loaded but is missing expected exports");
      }
      const missingVersion = m.parseDashboard({});
      if (missingVersion.ok !== false) {
        throw new Error("parseDashboard({}) should reject (missing 'version'), got: " + JSON.stringify(missingVersion));
      }
      const wrongVersion = m.parseDashboard({ version: 999 });
      if (wrongVersion.ok !== false || !wrongVersion.reason.includes("999")) {
        throw new Error("parseDashboard should reject an unsupported version by name, got: " + JSON.stringify(wrongVersion));
      }
      console.log("OK");
    });`;
    const output = execFileSync(process.execPath, ["--input-type=module", "-e", script], {
      encoding: "utf-8",
    });
    expect(output.trim()).toBe("OK");
  });
});
