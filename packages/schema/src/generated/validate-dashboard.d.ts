// Hand-written type stub — the actual implementation is generated at build
// time by ../../scripts/generate-ajv-validators.mjs into this same
// directory (validate-dashboard.js, gitignored — every `pnpm run build`
// regenerates it from the current `Dashboard` schema) and into
// dist/generated/ (what package consumers actually import). This stub
// exists purely so `tsc --build` can type-check validate.ts's import of it
// WITHOUT running the codegen script first — the codegen script itself
// needs `tsc --build`'s own output (`dist/dashboard.js`) as its input, so
// something has to break that ordering cycle, and a stub `.d.ts` (the same
// mechanism `@types/*` packages use for JS-only libraries) is it.
//
// The exported function's actual runtime shape is Ajv standalone codegen's
// documented guarantee: calling convention and the post-call `.errors`
// property are drop-in compatible with `ajv.compile()`'s returned
// `ValidateFunction` — this type must keep matching that guarantee, not
// the generated file's real source (there is nothing to keep it in sync
// against locally; `packages/schema/src/validate.test.ts` and the rest of
// the package's 100+ schema tests are what actually exercise the generated
// file and would fail if the two drifted).
import type { ValidateFunction } from "ajv";
import type { Dashboard as DashboardT } from "../dashboard.js";

declare const validate: ValidateFunction<DashboardT>;
export default validate;
