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
 * Rewrites every `require("module-spec")` call — regardless of which
 * module or what property chain follows it — into a reference to one
 * hoisted `import * as` namespace binding per distinct module, appending
 * `.js` to the specifier (Codex Round 1 P1: Node's own ESM resolver,
 * unlike Vite's/Vitest's more lenient bundler-mode resolution, requires an
 * explicit extension on a relative/subpath specifier — verified
 * empirically with `node -e "import(...)"` against dist/index.js;
 * node-esm-smoke.test.ts is the regression). A namespace import (not a
 * default import) because Rollup's CJS interop exposes both a synthetic
 * `.default` AND each statically-detected named export on the same
 * namespace object, so it transparently covers `require(...).default` (
 * `ucs2length`) and `require(...).fullFormats.X` (`ajv-formats`) with one
 * mechanism, without this function needing to know which shape a given
 * module uses. `/simplify` altitude finding: an earlier version matched 2
 * hand-written literal strings instead (Ajv's exact quote style/property
 * chain for exactly these 2 known cases) — narrower than necessary (a
 * schema change needing a 3rd format would need this function extended
 * again) and coupled to formatting details of a dependency's generated
 * output rather than to its actual contract (the module specifier).
 *
 * Still throws if anything unhandled remains — now only a genuine surprise
 * (e.g. a *dynamic* `require(someVariable)`, which this project's schemas
 * have never produced), not an ordinary new format/keyword.
 */
function esmifyRequires(code) {
  const modules = new Map(); // module specifier -> hoisted namespace binding name
  let n = 0;
  const transformed = code.replace(/require\((["'])([^"']+)\1\)/g, (_match, _quote, spec) => {
    if (!modules.has(spec)) modules.set(spec, `__cjs${n++}`);
    return modules.get(spec);
  });

  const leftover = transformed.match(/\brequire\(/);
  if (leftover) {
    throw new Error(
      `generate-ajv-validators.mjs: unhandled require() in generated code (not a simple require("literal-spec") call), extend esmifyRequires() — context: ${transformed.slice(leftover.index, leftover.index + 100)}`,
    );
  }

  // Import statements must be at module top level, before any other
  // statement — hoist them right after the "use strict" prologue
  // `standaloneCode()` always emits first.
  const imports = [...modules.entries()]
    .map(([spec, name]) => `import * as ${name} from "${spec}.js";`)
    .join("");
  return transformed.replace(/^"use strict";/, `"use strict";${imports}`);
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
