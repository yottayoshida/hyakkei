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

describe("EDITOR_CSP itself never allows the two origins this policy exists to keep out", () => {
  it("does not contain extensions.duckdb.org or cdn.jsdelivr.net", () => {
    expect(EDITOR_CSP).not.toContain(HTTPFS_ORIGIN);
    expect(EDITOR_CSP).not.toContain(JSDELIVR_ORIGIN);
  });
});

describe("index.html / golden.html / serve.json agree with csp.ts's EDITOR_CSP (single source of truth)", () => {
  it("index.html's CSP meta matches EDITOR_CSP and is the first meta after charset", () => {
    const html = readFileSync(join(APP_ROOT, "index.html"), "utf-8");
    const metaOrder = [...html.matchAll(/<meta\s[^>]*>/gs)];
    expect(metaOrder[0]?.[0]).toContain('charset="UTF-8"');
    expect(metaOrder[1]?.[0]).toContain("Content-Security-Policy");
    expect(metaCspContent(html)).toBe(EDITOR_CSP);
  });

  it("golden.html's CSP meta matches EDITOR_CSP and is the first meta after charset", () => {
    const html = readFileSync(join(APP_ROOT, "golden.html"), "utf-8");
    const metaOrder = [...html.matchAll(/<meta\s[^>]*>/gs)];
    expect(metaOrder[0]?.[0]).toContain('charset="UTF-8"');
    expect(metaOrder[1]?.[0]).toContain("Content-Security-Policy");
    expect(metaCspContent(html)).toBe(EDITOR_CSP);
  });

  it("public/serve.json's Content-Security-Policy header matches EDITOR_CSP, and covers every response (not just HTML)", () => {
    const serveConfig = JSON.parse(readFileSync(join(APP_ROOT, "public/serve.json"), "utf-8"));
    const rule = serveConfig.headers?.find((r: { source: string }) => r.source === "**");
    // Codex Round 1 P0: an earlier version scoped this to `**/*.html`.
    // spikes/lib/server.mjs (M0's own test server, docs/spikes/
    // m0-containment.md) sends the CSP header "on every response", not
    // just HTML — a Worker script/wasm response has no <meta> tag of its
    // own to fall back on, and there is no guarantee a same-origin Worker
    // inherits its creating document's CSP across every engine. `**`
    // matches M0's actually-tested configuration exactly.
    expect(rule?.source, "CSP header rule must cover every response, not just *.html").toBe("**");
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

describe("packages/app real build output (dist/) never references a third-party CDN/httpfs origin", () => {
  it("no .js/.mjs/.html file in dist contains extensions.duckdb.org or cdn.jsdelivr.net", () => {
    // Sentinel: if dist/ doesn't exist, every assertion below would be
    // skipped-by-absence rather than genuinely passing — fail loudly
    // instead (same principle bundle-isolation.test.ts's srcs.length check
    // uses).
    expect(existsSync(DIST_DIR), "packages/app/dist must exist — run `pnpm run build` first").toBe(
      true,
    );

    const files = walkTextFiles(DIST_DIR, [".js", ".mjs", ".html"]);
    expect(files.length).toBeGreaterThan(0);

    const offenders = files.filter((f) => {
      const text = readFileSync(f, "utf-8");
      return text.includes(HTTPFS_ORIGIN) || text.includes(JSDELIVR_ORIGIN);
    });
    expect(offenders).toEqual([]);
  });

  it("the 4 self-hosted DuckDB-WASM vendor files (Worker + wasm, MVP + EH) are present in dist/vendor", () => {
    const vendorDir = join(DIST_DIR, "vendor");
    for (const file of [
      "duckdb-mvp.wasm",
      "duckdb-eh.wasm",
      "duckdb-browser-mvp.worker.js",
      "duckdb-browser-eh.worker.js",
    ]) {
      expect(existsSync(join(vendorDir, file)), `dist/vendor/${file} missing`).toBe(true);
    }
  });
});
