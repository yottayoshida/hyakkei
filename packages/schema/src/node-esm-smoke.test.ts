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

// QA found that this test's original 2 inputs (missing `version`, wrong
// `version`) both return from `validate.ts`'s own `checkVersion()` guard
// BEFORE the generated Ajv validator body ever runs (validate.ts:
// `parseDashboard`/`parseBakedDashboard` check version first) — so this
// test passed even when `esmifyRequires()`'s CJS->ESM rewrite produced a
// generated validator that threw `... is not a function` under plain Node
// (a real bug, confirmed and fixed: an earlier version used a namespace
// import whose `.default` doesn't unwrap `__esModule`-flagged CJS the way
// Node's own default-import interop does). `validDashboard` below is a
// *minimal but schema-version-correct* payload (mirrors round-trip.test.ts's
// `baseDashboard()`) specifically so it reaches the generated validator's
// actual body — `meta.title`'s `NonEmptyString` constraint is exactly what
// exercises the `ucs2length` runtime helper this bug was in.
const validDashboard = {
  version: 1,
  meta: { title: "x", locale: "ja" },
  theme: { tokens: "@digital-go-jp/design-tokens@2.0.1", palette: "guidebook-blue" },
  sources: [{ id: "s1", kind: "file", format: "xlsx", ref: { name: "a.xlsx" } }],
  queries: [{ id: "q1", source: "s1", sql: "SELECT 1" }],
  charts: [{ id: "c1", type: "bar", query: "q1", encoding: { x: "a", y: "b" }, options: {} }],
  layout: { grid: "guidebook-12col", items: [{ chart: "c1", x: 0, y: 0, w: 6, h: 4 }] },
};

describe("@hyakkei/schema's real dist/index.js is importable by plain Node ESM, and its generated validators actually run correctly under it (not just resolve)", () => {
  it('`node -e "import(...)"` against dist/index.js: a valid payload passes through the full generated validator body, and version-guard rejections still work', () => {
    const distIndex = join(import.meta.dirname, "..", "dist", "index.js");
    const script = `import(${JSON.stringify(distIndex)}).then((m) => {
      if (typeof m.parseDashboard !== "function" || typeof m.parseBakedDashboard !== "function") {
        throw new Error("dist/index.js loaded but is missing expected exports");
      }

      // Reaches the generated Ajv validator body (unlike the 2 checks
      // below, which validate.ts's own version guard short-circuits
      // before ever calling it) -- this is the actual regression check.
      const valid = m.parseDashboard(${JSON.stringify(validDashboard)});
      if (valid.ok !== true) {
        throw new Error("parseDashboard(validDashboard) should accept, got: " + JSON.stringify(valid));
      }

      // Same payload with an empty title -- NonEmptyString's minLength:1,
      // checked via the ucs2length runtime helper this bug was in --
      // exercised by the generated validator body, not the version guard.
      const emptyTitle = m.parseDashboard({ ...${JSON.stringify(validDashboard)}, meta: { title: "", locale: "ja" } });
      if (emptyTitle.ok !== false) {
        throw new Error("parseDashboard should reject an empty meta.title, got: " + JSON.stringify(emptyTitle));
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
