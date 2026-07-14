/**
 * The editor's Content-Security-Policy — the primary containment mechanism
 * for `UrlSource`'s network egress and (once PR-A2 wires up real
 * DuckDB-WASM) for `httpfs`/extension loading (ARCHITECTURE §6, ADR-0007).
 *
 * This exact directive string is what `docs/spikes/m0-containment.md`
 * tested and verified (zero successful non-self-origin requests, all 3
 * engines, both with and without DuckDB's own defense-in-depth flags) --
 * except for the addition of `object-src 'none'` below, which M0 did not
 * test but which cannot regress anything M0 verified (it only restricts
 * `<object>`/`<embed>` plugin content, a surface this app never uses).
 *
 * `worker-src 'self'` is required, not optional: without it, `worker-src`
 * falls back to `script-src` (per the CSP fallback chain
 * `worker-src -> child-src -> script-src -> default-src`), which is `'self'
 * 'wasm-unsafe-eval'` here and would still work -- but ARCHITECTURE §6's
 * previously-documented target CSP used `default-src 'none'` and omitted
 * `worker-src` entirely, which (had it ever shipped as written) would have
 * fallen through past `script-src` to `default-src 'none'` and blocked the
 * DuckDB Worker outright. `default-src 'self'` (matching what M0 actually
 * tested) plus an explicit `worker-src 'self'` avoids relying on fallback
 * behavior at all.
 *
 * Single source of truth: `csp-containment.test.ts` asserts `index.html`,
 * `golden.html`, and `public/serve.json`'s `headers` entry all carry this
 * exact string, so the three copies (HTML can't `import` a TS constant)
 * can't silently drift from each other or from this file.
 */
export const EDITOR_CSP =
  "default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; connect-src 'self'; worker-src 'self'; object-src 'none'";
