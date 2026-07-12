import { defineConfig, devices } from "@playwright/test";

// e2e / query-layer tests run here because DuckDB-WASM does not run under
// jsdom (ROADMAP M0 time-permitting item: test infrastructure decision).
// Real specs land starting M1 (schema/renderer goldens) and M3 (export
// artifact checks: file:// launch, zero-network-request assertions).
export default defineConfig({
  testDir: "./e2e",
  // PR-C pixel golden (e2e/pixel-golden/) has its own config
  // (e2e/pixel-golden.config.ts): it needs a fixed OS/font environment
  // (Docker, mcr.microsoft.com/playwright image) for `toHaveScreenshot()`
  // determinism, which none of this config's 3 host-browser projects
  // provide -- running it here too would compare against a
  // platform-suffixed baseline (e.g. `-darwin.png`) that was never
  // generated on this OS and always fail/regenerate.
  testIgnore: "**/pixel-golden/**",
  fullyParallel: true,
  reporter: "list",
  // `packages/app/dist` (a prior `pnpm run build`, already a CI step
  // ordered before "E2E tests") served statically -- same pure-JS `serve`
  // choice as e2e/pixel-golden.config.ts, for the same reason (`vite
  // preview` pulls in rollup's platform-specific native binary). `serve`
  // is a pinned root devDependency (package.json), not an ad hoc `npx
  // --yes` fetch -- Codex R1 flagged the fetch form as an unpinned,
  // network-dependent step that contradicted this PR's own "pass
  // deterministically in CI" thesis.
  webServer: {
    command: "npx serve packages/app/dist -l 4173",
    url: "http://localhost:4173",
    reuseExistingServer: !process.env.CI,
    timeout: 30_000,
  },
  use: { baseURL: "http://localhost:4173" },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
    { name: "firefox", use: { ...devices["Desktop Firefox"] } },
    { name: "webkit", use: { ...devices["Desktop Safari"] } },
  ],
});
