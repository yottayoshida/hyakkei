// Prerequisite for PR-A1.5's CSP (ARCHITECTURE §6): `ajv.compile()` at
// runtime generates the validator function's body via `new Function(...)`,
// which requires `script-src 'unsafe-eval'` — a directive this project
// deliberately does not ship (it would silence the exact eval-based-XSS
// class the DOM-sink eslint rules, PR #78/#80, exist to catch). Ajv's own
// documented answer to this is standalone code generation: compile once,
// here, at build time in plain Node (no CSP applies to build tooling), and
// write the generated validator as an ordinary ESM module with no runtime
// `Function`/`eval` call anywhere in it.
//
// Runs after `tsc --build` (package.json's `build` script), importing the
// already-compiled `dist/dashboard.js`/`dist/baked.js` — not `src/*.ts`
// directly, since a plain Node script can't import `.ts` sources under this
// project's `.js`-extension-import convention without a loader.
//
// Writes the identical generated code to TWO locations, neither committed
// to git (.gitignore: dist/ wholesale, src/generated/*.js specifically —
// only the hand-written `.d.ts` stubs in that directory are tracked):
//   - dist/generated/: what `@hyakkei/schema`'s package.json `exports`
//     actually ships (`./dist/index.js`) — real consumers (packages/core,
//     packages/app) need it here.
//   - src/generated/: Vitest transforms `src/*.test.ts` (and whatever they
//     import, e.g. validate.ts) from source directly, never from `dist/` —
//     without a real, executable file at this exact relative path,
//     `validate.ts`'s `import ... from "./generated/validate-dashboard.js"`
//     resolves to nothing at test-run time (a `.d.ts` alone isn't
//     executable). This mirrors the rest of this monorepo's existing
//     precondition: package-level tests assume a prior `pnpm run build`
//     already ran (packages/app/src/bundle-isolation.test.ts documents the
//     same assumption for its own dist/ read) — the root `pnpm run test`
//     script (`pnpm run build && pnpm -r run test`) guarantees that.
import Ajv from "ajv";
import addFormats from "ajv-formats";
import standaloneCode from "ajv/dist/standalone/index.js";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { BakedDashboard } from "../dist/baked.js";
import { Dashboard } from "../dist/dashboard.js";

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const outDirs = [join(packageRoot, "dist", "generated"), join(packageRoot, "src", "generated")];
for (const dir of outDirs) mkdirSync(dir, { recursive: true });

/**
 * `code.esm: true` makes `standaloneCode()` emit `export`/`export default`
 * for the validator itself, but it still emits CJS `require("module-spec")`
 * calls (with an arbitrary trailing property-access chain, e.g. `.default`
 * or `.fullFormats["date-time"]`) for its OWN runtime dependencies (Ajv's
 * `ucs2length` string-length helper; `ajv-formats`' function-based formats
 * — `uri`/`date-time`/`date` are not pure regexes, unlike most "fast"
 * formats). Both `ajv` and `ajv-formats` ship CJS-only (`package.json` has
 * no `"type": "module"`/`"exports"`), so this is deliberate on Ajv's part:
 * the documented expectation is a bundler's CJS interop resolves them.
 * Verified empirically (this project's first attempt shipped the raw
 * `require()` calls into a Vite/Rollup browser bundle untouched — a bare
 * `require` is not a global in a browser, so the page failed with
 * `ReferenceError: require is not defined` on load) that Vite's default
 * pipeline does NOT rewrite an arbitrary `require()` *call expression*
 * sitting inside otherwise-ESM source — only actual `import` statements go
 * through its module graph (where CJS interop unambiguously applies, the
 * same as any ordinary `import _ from "lodash"`).
 *
 * Rewrites every `require("module-spec")` call, plus the single property
 * access immediately following it (`.default` or `.someName` — a bare
 * identifier; bracket-form and multi-segment chains are left as literal
 * suffix, untouched, after that first segment), into a hoisted namespace
 * import (`import * as __cjsN from "module-spec.js"`, `.js` appended —
 * Codex Round 1 P1: Node's own ESM resolver, unlike Vite's/Vitest's more
 * lenient bundler-mode resolution, requires an explicit extension on a
 * relative/subpath specifier) plus a reference matching the original
 * access: `.someName` (a real named export) becomes `__cjsN.someName`
 * directly; `.default` becomes `__unwrapCjsDefault(__cjsN)` — see that
 * helper's own comment for why a raw `.default` isn't enough.
 *
 * **Two prior attempts at this function were each wrong in the opposite
 * direction, both confirmed empirically** (`node -e "import(...)"` against
 * the real built output vs. running the Vitest suite) rather than reasoned
 * out from documentation, because the two runtimes disagree here in a way
 * neither's own docs make obvious:
 * 1. A namespace import leaving `.default` as a literal suffix on `ns`
 *    (`ns.default`): correct under Vite's/Vitest's bundler-mode CJS
 *    interop (`ns.default` is already the unwrapped function — verified),
 *    **wrong** under plain Node (`ns.default` is the *whole*
 *    `module.exports` object for a module compiled with
 *    `Object.defineProperty(exports, "__esModule", ...); exports.default =
 *    fn` — verified with `node -e`), throwing `... is not a function`.
 *    This is exactly the gap `node-esm-smoke.test.ts` exists to catch, and
 *    (QA's finding) that test's original 2 inputs both returned early from
 *    `validate.ts`'s own version check before ever reaching the generated
 *    validator body, so it passed anyway despite the bug (now fixed
 *    alongside this function — see that test's own comment).
 * 2. A plain *default* import (`import x from "cjs-module"`) with the
 *    `.default` suffix dropped: **wrong** under plain Node for the same
 *    reason (a default import's binding is the whole `module.exports`,
 *    not an unwrapped `exports.default` — TypeScript's `esModuleInterop`
 *    helper does that unwrapping for TS-compiled *consumers*, but no such
 *    helper runs in either Node's native loader or Vite's bundler-mode
 *    interop), **and also wrong** under Vite/Vitest, which unwrap a
 *    default import to the function directly — so `x.default` there reads
 *    a non-existent property *off the already-unwrapped function*
 *    (confirmed: broke 104 of 111 schema tests when tried).
 *
 * `__unwrapCjsDefault()` (below) is the actual fix: it inspects the
 * namespace's `.default` at *runtime* and returns whichever level is
 * actually callable, so the one generated file works correctly in both
 * environments rather than needing environment-specific output. Only the
 * `"default"` access needs this — a named export (`accessed !== "default"`)
 * is bound directly and identically in both runtimes (verified: `import {
 * fullFormats as x } from "ajv-formats/dist/formats.js"` gives `x` = the
 * real object, `x.uri` a real function, in both Node and Vitest).
 *
 * Still throws if anything unhandled remains (a *dynamic* `require(
 * someVariable)`, a bracket-form first access, or no property access at
 * all after `require(...)` — none of which this project's schemas have
 * ever produced) rather than silently mis-generating an import for a shape
 * this function hasn't been taught the correct unwrapping for.
 */
function esmifyRequires(code) {
  const modules = new Map(); // "spec" -> { name, importStmt } (one namespace import per module, however many access points it has)
  let n = 0;
  let usesDefaultHelper = false;
  const transformed = code.replace(
    /require\((["'])([^"']+)\1\)\.([A-Za-z_$][A-Za-z0-9_$]*)/g,
    (_match, _quote, spec, accessed) => {
      let entry = modules.get(spec);
      if (!entry) {
        const name = `__cjs${n++}`;
        entry = { name, importStmt: `import * as ${name} from "${spec}.js";` };
        modules.set(spec, entry);
      }
      if (accessed === "default") {
        usesDefaultHelper = true;
        return `__unwrapCjsDefault(${entry.name})`;
      }
      return `${entry.name}.${accessed}`;
    },
  );

  const leftover = transformed.match(/\brequire\(/);
  if (leftover) {
    throw new Error(
      `generate-ajv-validators.mjs: unhandled require() in generated code (expected require("literal-spec").identifierAccess), extend esmifyRequires() — context: ${transformed.slice(leftover.index, leftover.index + 100)}`,
    );
  }

  const imports = [...modules.values()].map((e) => e.importStmt).join("");
  // See this function's own doc comment for why both branches exist: Vite's/
  // Vitest's bundler-mode CJS interop already unwraps a namespace import's
  // `.default` to the real value (function typeof, no further `.default` to
  // read); plain Node's native interop leaves it as the whole
  // `module.exports` (object typeof, the real value one `.default` deeper).
  const helper = usesDefaultHelper
    ? `function __unwrapCjsDefault(ns){const d=ns.default;return typeof d==="object"&&d!==null&&typeof d.default==="function"?d.default:d;}`
    : "";
  // Import statements (and the helper, which references nothing before
  // it's called) must be at module top level, before any other statement
  // — hoist them right after the "use strict" prologue `standaloneCode()`
  // always emits first.
  return transformed.replace(/^"use strict";/, `"use strict";${imports}${helper}`);
}

// Shared across both generate() calls below (`/simplify` efficiency
// finding: this is build-time-only, so the previous per-schema instance
// cost nothing real, but one instance compiling both schemas is the more
// idiomatic Ajv usage `ajv.compile()`/`standaloneCode()` are designed for).
const ajv = new Ajv({ allErrors: true, code: { source: true, esm: true } });
addFormats(ajv); // "uri" (dashboard.ts) / "date-time" + "date" (baked.ts)

function generate(schema, fileName) {
  const validate = ajv.compile(schema);
  const code = esmifyRequires(standaloneCode(ajv, validate));
  for (const dir of outDirs) writeFileSync(join(dir, fileName), code);
}

generate(Dashboard, "validate-dashboard.js");
generate(BakedDashboard, "validate-baked-dashboard.js");
