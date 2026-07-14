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
 * for the validator itself, but it still emits CJS `require(...)` calls for
 * its OWN runtime dependencies (Ajv's `ucs2length` string-length helper,
 * needed for correct `minLength`/`maxLength` counting across UTF-16
 * surrogate pairs; `ajv-formats`' function-based formats — `uri`/
 * `date-time`/`date` are not pure regexes, unlike most "fast" formats).
 * Both `ajv` and `ajv-formats` ship CJS-only (`package.json` has no
 * `"type": "module"`/`"exports"`), so this is deliberate on Ajv's part: the
 * documented expectation is a bundler's CJS interop resolves them. Verified
 * empirically (this project's first attempt shipped the raw `require()`
 * calls into a Vite/Rollup browser bundle untouched — a bare `require` is
 * not a global in a browser, so the page failed with `ReferenceError:
 * require is not defined` on load) that Vite's default pipeline does NOT
 * rewrite an arbitrary `require()` *call expression* sitting inside
 * otherwise-ESM source — only actual `import` statements go through its
 * module graph (where CJS interop unambiguously applies, the same as any
 * ordinary `import _ from "lodash"`). So: rewrite each `require(...)` this
 * project's schemas are known to produce into a hoisted `import`, keeping
 * every one of Ajv's own generated local variable names untouched (only
 * *how* they get assigned changes) so nothing else in the generated body
 * needs to change.
 *
 * Throws on any `require(` this function doesn't recognize, rather than
 * silently shipping it through — a schema change that starts using a new
 * format/keyword needing a different Ajv runtime helper must extend this
 * function, not surface as a silent `ReferenceError` in the browser again.
 */
function esmifyRequires(code) {
  let transformed = code;
  const imports = [];

  // `.js` extensions are load-bearing, not cosmetic (Codex Round 1 P1):
  // Node's own ESM resolver — unlike Vite's/Vitest's more lenient
  // bundler-mode resolution, which is all this project's build/test
  // pipeline exercises — requires an explicit extension on a relative or
  // subpath specifier. Verified empirically: `node -e "import('./dist/
  // index.js')"` against an earlier, extensionless version of this output
  // failed with `Cannot find module '.../ajv/dist/runtime/ucs2length'
  // ... Did you mean to import "ajv/dist/runtime/ucs2length.js"?` — exactly
  // the failure a future plain-Node consumer of this package (a CLI, an
  // MCP server — this project has discussed exactly that) would hit.
  // schema-package-node-esm.test.ts is the regression for this.
  const ucs2lengthCall = 'require("ajv/dist/runtime/ucs2length").default';
  if (transformed.includes(ucs2lengthCall)) {
    imports.push('import __ucs2length_default from "ajv/dist/runtime/ucs2length.js";');
    transformed = transformed.replaceAll(ucs2lengthCall, "__ucs2length_default");
  }

  // Left un-replaced past `.fullFormats`: the trailing property access
  // (`.uri`, `.date`, or bracket form `["date-time"]`) — untouched either
  // way, so this one hoisted import covers every format this project's
  // schemas ever request from `ajv-formats`.
  const formatsPrefix = 'require("ajv-formats/dist/formats").fullFormats';
  if (transformed.includes(formatsPrefix)) {
    imports.push(
      'import { fullFormats as __ajv_formats_fullFormats } from "ajv-formats/dist/formats.js";',
    );
    transformed = transformed.replaceAll(formatsPrefix, "__ajv_formats_fullFormats");
  }

  const leftover = transformed.match(/\brequire\(/);
  if (leftover) {
    throw new Error(
      `generate-ajv-validators.mjs: unhandled require() in generated code, extend esmifyRequires() — context: ${transformed.slice(leftover.index, leftover.index + 100)}`,
    );
  }

  // Import statements must be at module top level, before any other
  // statement — hoist them right after the "use strict" prologue
  // `standaloneCode()` always emits first.
  return transformed.replace(/^"use strict";/, `"use strict";${imports.join("")}`);
}

function generate(schema, fileName) {
  // Same options `validate.ts` used to pass to the runtime `ajv.compile()`
  // call this replaces (`allErrors`, `removeAdditional` left at its default
  // `false` for additive-only forward-compat) — `code.source`/`code.esm`
  // are new, and exist only to make `standaloneCode()` below possible.
  const ajv = new Ajv({ allErrors: true, code: { source: true, esm: true } });
  addFormats(ajv); // "uri" (dashboard.ts) / "date-time" + "date" (baked.ts)
  const validate = ajv.compile(schema);
  const code = esmifyRequires(standaloneCode(ajv, validate));
  for (const dir of outDirs) writeFileSync(join(dir, fileName), code);
}

generate(Dashboard, "validate-dashboard.js");
generate(BakedDashboard, "validate-baked-dashboard.js");
