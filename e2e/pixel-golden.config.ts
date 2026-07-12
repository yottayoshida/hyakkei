import { join } from "node:path";
import { defineConfig, devices } from "@playwright/test";

const APP_DIST = join(import.meta.dirname, "..", "packages", "app", "dist");

// PR-C, plan §技術選定 golden layer ③ ("Docker Playwright pixel, 代表2キー色
// × 2 appearance に限定"): `toHaveScreenshot()` is only meaningful pixel-
// for-pixel across a FIXED font/DPR/renderer environment (plan's risk
// table: "pixel全組合せ golden... フォント/DPR flaky で維持不能" is exactly
// why this layer stays deliberately narrow, unlike layers ①②). Run via
// `pnpm run test:e2e:pixel-golden` inside
// `mcr.microsoft.com/playwright:v1.61.1-noble` (README/CI) -- never on the
// host, whose OS-suffixed baseline (`-darwin.png`) this repo never commits.
//
// `packages/app/dist` (a prior `pnpm run build`) is served statically
// in-container by a pure-JS server (`serve`, no native deps) rather than
// `vite preview`: `vite`/`rollup`'s native optional dependency is
// platform-specific, and this container's linux/arm64 (or amd64) cannot
// load a host-built (darwin) `node_modules`'s native binary when the repo
// is bind-mounted in (confirmed empirically during PR-C's Phase 3 PoC).
// `serve` itself is a pure-JS pinned root devDependency (package.json), so
// the bind-mounted host `node_modules` resolves it with no container-side
// install/network fetch (Codex R1: an `npx --yes` fetch here would have
// been unpinned and non-deterministic, contradicting this layer's whole
// reason to exist).
export default defineConfig({
  testDir: "./pixel-golden",
  snapshotPathTemplate: "{testDir}/__screenshots__/{arg}{ext}",
  fullyParallel: false,
  reporter: "list",
  webServer: {
    command: `npx serve ${APP_DIST} -l 4173`,
    url: "http://localhost:4173",
    reuseExistingServer: false,
    timeout: 30_000,
  },
  use: { baseURL: "http://localhost:4173" },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
