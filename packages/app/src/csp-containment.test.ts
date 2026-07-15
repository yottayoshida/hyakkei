// PR-A1.5 containment wiring — CI regression for the CSP artifact
// ARCHITECTURE §6/ADR-0007 previously documented as "not wired up yet" (M2).
// Two halves: (1) source-of-truth consistency (index.html/golden.html/
// serve.json all carry the exact same policy EDITOR_CSP defines), checked
// against the packages/app/ source tree directly; (2) the real build output
// (requires packages/app/dist — root `pnpm run test` runs `pnpm run build`
// first, same precondition bundle-isolation.test.ts documents) never
// contains a third-party origin a self-hosted, connect-src-'self' editor
// must not reference.
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { VENDOR_FILES } from "../scripts/duckdb-vendor-files.mjs";
import { EDITOR_CSP } from "./csp.js";

const APP_ROOT = join(import.meta.dirname, "..");
const DIST_DIR = join(APP_ROOT, "dist");

// The one control this policy exists to guarantee (ADR-0007, ARCHITECTURE
// §6): httpfs is not bundled into the DuckDB-WASM binary — it is fetched
// from this origin the first time `LOAD httpfs` runs. Keeping it out of
// connect-src forecloses the entire `SELECT ... FROM 'https://...'` attack
// class, independent of any other allowlist entry.
const HTTPFS_ORIGIN = "extensions.duckdb.org";
// The default `@duckdb/duckdb-wasm` bundle source PR-A1.5's vendor copy
// script (scripts/copy-duckdb-vendor.mjs) exists specifically to avoid:
// `duckdb.getJsDelivrBundles()` loads Worker/wasm from this CDN, which
// would both defeat same-origin self-hosting and require widening
// connect-src past 'self'.
const JSDELIVR_ORIGIN = "cdn.jsdelivr.net";

function metaCspContent(html: string): string | undefined {
  const match = html.match(/<meta\s+http-equiv="Content-Security-Policy"\s+content="([^"]+)"/);
  return match?.[1];
}

/** `"connect-src 'self'"` -> `["'self'"]`. Throws if the directive is absent — every directive this policy's own tests check for is one this policy must always declare explicitly (no silent fallback-to-default-src reliance). */
function directiveSources(csp: string, directive: string): string[] {
  const match = csp.match(new RegExp(`(?:^|;)\\s*${directive}\\s+([^;]+)`));
  if (!match) throw new Error(`EDITOR_CSP has no '${directive}' directive: ${csp}`);
  return match[1]!.trim().split(/\s+/);
}

describe("EDITOR_CSP's actual security properties (Codex Round 2 Test Adversarial Review: string-equality-to-itself tests can't catch a weakening that keeps every copy in sync)", () => {
  it("does not contain extensions.duckdb.org or cdn.jsdelivr.net", () => {
    expect(EDITOR_CSP).not.toContain(HTTPFS_ORIGIN);
    expect(EDITOR_CSP).not.toContain(JSDELIVR_ORIGIN);
  });

  // Round 1 fixed 2 concrete regressions (Worker-script CSP coverage, Node
  // ESM import extensions) with tests targeted at exactly those bugs.
  // Round 2's adversarial pass found the gap those targeted tests share:
  // `index.html`/`golden.html`/`serve.json` matching EDITOR_CSP *exactly*
  // only proves internal consistency — if EDITOR_CSP itself were loosened
  // (e.g. 'unsafe-eval' added to script-src, or a second origin added to
  // connect-src) and all 3 copies updated together, every test above would
  // still pass. These assert the actual directive VALUES, not just that
  // the 3 copies agree on whatever value csp.ts happens to hold.
  it("connect-src is exactly 'self' — no additional origin, no wildcard, no scheme-source", () => {
    expect(directiveSources(EDITOR_CSP, "connect-src")).toEqual(["'self'"]);
  });

  it("worker-src is exactly 'self'", () => {
    expect(directiveSources(EDITOR_CSP, "worker-src")).toEqual(["'self'"]);
  });

  it("script-src is exactly 'self' + 'wasm-unsafe-eval', and — the entire reason validate.ts moved off runtime ajv.compile() — never 'unsafe-eval'", () => {
    const sources = directiveSources(EDITOR_CSP, "script-src");
    expect(sources).toEqual(["'self'", "'wasm-unsafe-eval'"]);
    expect(sources).not.toContain("'unsafe-eval'");
  });

  it("default-src is 'self' (not 'none' — ARCHITECTURE §6's prior draft used 'none' with no worker-src, which the CSP fallback chain would have resolved to blocking the DuckDB Worker outright)", () => {
    expect(directiveSources(EDITOR_CSP, "default-src")).toEqual(["'self'"]);
  });
});

describe("index.html / golden.html / serve.json agree with csp.ts's EDITOR_CSP (single source of truth)", () => {
  it.each(["index.html", "golden.html", "register-harness.html"])(
    "%s's CSP meta matches EDITOR_CSP and is the first meta after charset",
    (htmlFile) => {
      const html = readFileSync(join(APP_ROOT, htmlFile), "utf-8");
      const metaOrder = [...html.matchAll(/<meta\s[^>]*>/gs)];
      expect(metaOrder[0]?.[0]).toContain('charset="UTF-8"');
      expect(metaOrder[1]?.[0]).toContain("Content-Security-Policy");
      expect(metaCspContent(html)).toBe(EDITOR_CSP);
    },
  );

  it("public/serve.json's Content-Security-Policy header matches EDITOR_CSP, and its rule covers every FILE response (not just HTML)", () => {
    const serveConfig = JSON.parse(readFileSync(join(APP_ROOT, "public/serve.json"), "utf-8"));
    const rule = serveConfig.headers?.find((r: { source: string }) => r.source === "**");
    // Codex Round 1 P0: an earlier version scoped this to `**/*.html`.
    // spikes/lib/server.mjs (M0's own test server, docs/spikes/
    // m0-containment.md) sends the CSP header "on every response", not
    // just HTML — a Worker script/wasm response's own header is what
    // governs a network-loaded Worker's CSP (ARCHITECTURE §6's amended
    // text: a Worker does not inherit its document's <meta> CSP), so it
    // has no <meta> tag to fall back on. `**` matches M0's actually-tested
    // configuration exactly. QA note: this glob covers every FILE `serve`
    // serves, but not its synthesized directory-listing response for a
    // bare `/` or `/vendor/` (that response carries no CSP, header or
    // meta, in this configuration or the pre-PR-A1.5 one) — not a
    // regression this PR introduces, and out of scope for it (no app code
    // is reachable from a directory listing), but worth being precise
    // about rather than "every response" without qualification.
    expect(rule?.source, "CSP header rule must cover every file response, not just *.html").toBe(
      "**",
    );
    const cspHeader = rule?.headers?.find(
      (h: { key: string }) => h.key === "Content-Security-Policy",
    );
    expect(cspHeader?.value).toBe(EDITOR_CSP);
  });
});

function walkTextFiles(dir: string, exts: string[]): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      out.push(...walkTextFiles(full, exts));
    } else if (exts.some((ext) => entry.endsWith(ext))) {
      out.push(full);
    }
  }
  return out;
}

// Every text-ish extension `vite build`/the public/ copy step could
// plausibly produce (Codex Round 2: the original list — .js/.mjs/.html —
// would silently skip a leaked origin sitting in a .json/.css/.map/.svg
// asset instead of catching it).
const TEXT_ASSET_EXTS = [".js", ".mjs", ".html", ".json", ".css", ".map", ".svg", ".txt"];

describe("packages/app real build output (dist/) never references a third-party CDN/httpfs origin", () => {
  it("no text asset in dist contains extensions.duckdb.org or cdn.jsdelivr.net", () => {
    // Sentinel: if dist/ doesn't exist, every assertion below would be
    // skipped-by-absence rather than genuinely passing — fail loudly
    // instead (same principle bundle-isolation.test.ts's srcs.length check
    // uses).
    expect(existsSync(DIST_DIR), "packages/app/dist must exist — run `pnpm run build` first").toBe(
      true,
    );

    const files = walkTextFiles(DIST_DIR, TEXT_ASSET_EXTS);
    expect(files.length).toBeGreaterThan(0);

    const offenders = files.filter((f) => {
      const text = readFileSync(f, "utf-8");
      return text.includes(HTTPFS_ORIGIN) || text.includes(JSDELIVR_ORIGIN);
    });
    expect(offenders).toEqual([]);
  });

  it("the 4 self-hosted DuckDB-WASM vendor files (Worker + wasm, MVP + EH) are present in dist/vendor", () => {
    const vendorDir = join(DIST_DIR, "vendor");
    for (const file of VENDOR_FILES) {
      expect(existsSync(join(vendorDir, file)), `dist/vendor/${file} missing`).toBe(true);
    }
  });
});
