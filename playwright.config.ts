import { defineConfig, devices } from "@playwright/test";

// /simplify (Simplification finding): one declaration instead of 4 separate
// process.env.CI reads below -- 2 pre-existing (`!!x`, `!x`) plus 2 this PR
// adds (`x ? a : b` x2), each spelled with a different coercion idiom.
const isCI = Boolean(process.env.CI);

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
  // issue #97: `github` reporter only in CI (mirrors the forbidOnly split
  // below) so a retry-then-pass surfaces as a real `::error` annotation on
  // the PR/commit checks UI, not just a "1 flaky" line buried at the tail of
  // local terminal output -- `retries` (below) must not make a genuine
  // regression quietly disappear into green. This is configured at the top
  // level, so it covers every project without further changes.
  // Left off locally so raw reporter control-sequence-ish output doesn't
  // clutter interactive `pnpm run test:e2e` runs.
  reporter: isCI ? [["list"], ["github"]] : "list",
  // issue #64: a committed `test.only` silently shrinks CI to one test
  // across all three browsers and reports green -- fails the CI run
  // instead of letting it pass on a fraction of the suite. Not set
  // outside CI so local development can still use `.only` freely.
  forbidOnly: isCI,
  // Playwright's own default (5000ms) is a generic UI-interaction budget, not
  // tuned for this suite's DuckDB-WASM-backed flows (worker spin-up + actual
  // file parsing before a status region appears) -- these specs hit this
  // ceiling intermittently under CI resource contention. Observed twice, on
  // two different browsers: webkit first (issue #97, 3 consecutive CI runs
  // each timing out on a *different* status-visibility assertion in the same
  // file), then chromium (issue #140, 2 consecutive runs, a *different spec
  // file* each time, the same heading assertion -- and one of the two was a
  // CHANGELOG-only PR that touched no source at all, so nothing about the
  // commit could have changed the timing). The signature of environment
  // variance, not a deterministic bug in any one test. A global bump, not a
  // per-assertion override sprinkled through the affected spec, since every
  // assertion in this suite shares the same underlying WASM-init dependency.
  expect: { timeout: 10_000 },
  // issue #97, widened to every project for issue #140: one retry in CI for
  // the intermittent timeout described just above -- NOT a fix for a
  // confirmed root cause.
  //
  // This was webkit-only until 2026-08-04, because webkit was where the three
  // consecutive failures had been observed. That scoped the mitigation to the
  // browser the symptom appeared on rather than to the browsers that share the
  // cause: WASM init racing a 2-worker runner is browser-independent, and
  // chromium then hit it twice in one day with no retry budget to absorb it.
  //
  // issue #97's own "2-core runner" premise is wrong: GitHub GA'd
  // (2024-01-17) a free upgrade of public-repo `ubuntu-latest` runners to
  // 4-vCPU/16GB, and this repo is public, so the runner already has 4 cores.
  // The real mechanism is Playwright's own default `workers` ("50%" of logical
  // CPUs), which caps this repo at 2 concurrent workers regardless of the 4
  // available cores.
  //
  // Rejected alternatives: raising expect.timeout further (symptomatic, only
  // worsens detection latency); per-project `workers: 1` (only serializes that
  // project's own tests against each other -- all projects draw from one
  // shared global worker pool, so it does not stop contention with
  // concurrently-running projects); global `workers: 1` (removes contention
  // entirely but roughly doubles total E2E wall-clock time on every run); a
  // larger CI runner (this repo already gets the best free tier as a public
  // repo -- bigger runner labels require a paid Team/Enterprise plan, and it
  // would not answer why 4 cores + 2 workers still contend). A readiness gate
  // that waits once for the WASM worker before any spec runs is the only
  // option that removes the race rather than retrying through it; it stays
  // open on issue #140 as the real fix.
  //
  // A single retry absorbs one-time noise; a deterministic regression still
  // fails on both attempts and stays red.
  //
  // CI-only (Codex R1 finding on #97): matches this repo's own `forbidOnly`
  // split and Playwright's own documented CI pattern
  // (`retries: process.env.CI ? 2 : 0`) -- a local run should show a genuinely
  // flaky test as a failure, not silently retry it away, since the 2-worker CI
  // contention this absorbs does not apply to a local machine's own resource
  // profile.
  retries: isCI ? 1 : 0,
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
    reuseExistingServer: !isCI,
    timeout: 30_000,
  },
  // issue #97: capture a trace only when a test actually retries, not on
  // every pass -- keeps artifact size down while still leaving something to
  // inspect for "was that retry real environment noise or an actual bug".
  use: { baseURL: "http://localhost:4173", trace: "on-first-retry" },
  // Browser choice only -- no per-project behavioural overrides. `retries`,
  // `expect.timeout` and `trace` are all set once above so the three cannot
  // drift apart; scoping `retries` to one project is what issue #140 was about.
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
    { name: "firefox", use: { ...devices["Desktop Firefox"] } },
    { name: "webkit", use: { ...devices["Desktop Safari"] } },
  ],
});
