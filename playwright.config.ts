import { defineConfig, devices } from "@playwright/test";

// e2e / query-layer tests run here because DuckDB-WASM does not run under
// jsdom (ROADMAP M0 time-permitting item: test infrastructure decision).
// Real specs land starting M1 (schema/renderer goldens) and M3 (export
// artifact checks: file:// launch, zero-network-request assertions).
export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  reporter: "list",
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
    { name: "firefox", use: { ...devices["Desktop Firefox"] } },
    { name: "webkit", use: { ...devices["Desktop Safari"] } },
  ],
});
