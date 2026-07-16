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
  // Playwright's own default (5000ms) is a generic UI-interaction budget,
  // not tuned for this suite's DuckDB-WASM-backed flows (worker spin-up +
  // actual file parsing before a status region appears) -- intake-harness
  // specs hit this ceiling intermittently under CI resource contention
  // (webkit specifically, 3 consecutive CI runs each timing out on a
  // *different* status-visibility assertion in the same file, same
  // browser -- the signature of environment variance, not a deterministic
  // bug in any one test). A global bump, not a per-assertion override
  // sprinkled through the affected spec, since every assertion in this
  // suite shares the same underlying WASM-init dependency.
  expect: { timeout: 10_000 },
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
