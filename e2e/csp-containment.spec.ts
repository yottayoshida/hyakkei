import { expect, test } from "@playwright/test";

// PR-A1.5 containment wiring. This is the real-browser counterpart to
// packages/app/src/csp-containment.test.ts (which only checks that the
// policy's 3 static copies — index.html, golden.html, public/serve.json —
// agree with each other): that Vitest suite can't prove the served header
// actually reaches the browser or that it actually blocks anything, since
// it never spins up a server. This spec replays docs/spikes/m0-
// containment.md's own methodology (a plain fetch() from the page under
// the shipped CSP, checked via the same 3 signals: request/response
// events, console messages, and the native `securitypolicyviolation` DOM
// event) against the real `npx serve packages/app/dist` this repo's
// playwright.config.ts already runs everything else through.
test.describe("editor CSP (public/serve.json header, delivered via playwright.config.ts's webServer)", () => {
  test("golden render produces zero CSP violations (the policy does not regress legitimate rendering)", async ({
    page,
  }) => {
    const violations: string[] = [];
    page.on("console", (msg) => {
      if (/content security policy|refused to (load|connect|execute)/i.test(msg.text())) {
        violations.push(msg.text());
      }
    });
    page.on("pageerror", (err) => violations.push(String(err)));

    await page.goto("/golden.html?sample=applications&appearance=light", {
      waitUntil: "domcontentloaded",
    });
    await page.waitForSelector(".hyakkei-chart-canvas svg", { timeout: 10_000 });

    expect(violations, `CSP violations during golden render: ${violations.join("; ")}`).toEqual([]);
  });

  test("the CSP header is served on every response, not just HTML (Codex Round 1 P0: a Worker script has no <meta> tag to fall back on)", async ({
    page,
  }) => {
    // The self-hosted DuckDB Worker script (packages/app/scripts/
    // copy-duckdb-vendor.mjs) — a stable, predictable path, unlike
    // content-hashed JS chunks, and the exact resource this check matters
    // most for: it's what the (not-yet-wired) DuckDB factory will load via
    // `new Worker(...)`, and per spikes/lib/server.mjs's own comment, M0's
    // tested configuration sent the CSP header "on every response", not
    // only HTML — a Worker script's own network attempts are its own
    // response's concern, not necessarily inherited from the document that
    // created it.
    const response = await page.goto("/vendor/duckdb-browser-eh.worker.js");
    const cspHeader = response?.headers()["content-security-policy"];
    expect(
      cspHeader,
      "public/serve.json's CSP header did not reach a non-HTML (Worker script) response",
    ).toBeTruthy();
    expect(cspHeader).toContain("connect-src 'self'");
  });

  test("CSP header + meta agree on connect-src/worker-src 'self', and a same-page fetch() to a non-self https origin is blocked (M0 control-test replay: zero successful non-self responses)", async ({
    page,
    baseURL,
  }) => {
    // `/simplify` reuse finding: read from playwright.config.ts's single
    // `use.baseURL` fixture rather than a second, unlinked copy of the
    // literal — a config port change would otherwise go stale here
    // silently (start flagging legitimate same-origin responses instead of
    // failing loudly).
    const selfOrigin = new URL(baseURL!).origin;
    const nonSelfResponses: string[] = [];
    page.on("response", (response) => {
      const url = new URL(response.url());
      if (url.origin !== selfOrigin && response.ok()) {
        nonSelfResponses.push(`${response.status()} ${response.url()}`);
      }
    });

    const response = await page.goto("/golden.html?sample=applications&appearance=light", {
      waitUntil: "domcontentloaded",
    });

    const cspHeader = response?.headers()["content-security-policy"];
    expect(
      cspHeader,
      "public/serve.json's Content-Security-Policy header did not reach the browser",
    ).toBeTruthy();
    expect(cspHeader).toContain("connect-src 'self'");
    expect(cspHeader).toContain("worker-src 'self'");

    const metaCsp = await page
      .locator('meta[http-equiv="Content-Security-Policy"]')
      .getAttribute("content");
    expect(metaCsp).toContain("connect-src 'self'");
    expect(metaCsp).toContain("worker-src 'self'");

    // The control test itself (docs/spikes/m0-containment.md's "runControlTest"):
    // a plain same-document fetch() to a non-self https origin must be
    // refused by the browser's own CSP enforcement, not by application code.
    // Listener registration and the fetch that must trigger it run inside
    // the SAME `page.evaluate()` call, both on the already-navigated
    // golden.html document — registering the listener in an earlier,
    // separate `page.evaluate()` before `page.goto()` destroys that
    // execution context on navigation and loses the listener entirely
    // (`page.evaluate: Execution context was destroyed`, caught empirically
    // running this spec against the real server).
    const { fetchOutcome, violation } = await page.evaluate(async () => {
      const violationSeen = new Promise<{ violatedDirective: string; disposition: string }>(
        (resolve) => {
          document.addEventListener(
            "securitypolicyviolation",
            (e) => resolve({ violatedDirective: e.violatedDirective, disposition: e.disposition }),
            { once: true },
          );
        },
      );
      let fetchOutcome: string;
      try {
        await fetch("https://attacker.example/x.csv");
        fetchOutcome = "resolved";
      } catch (err) {
        fetchOutcome = `rejected: ${String(err)}`;
      }
      return { fetchOutcome, violation: await violationSeen };
    });
    expect(fetchOutcome).not.toBe("resolved");
    expect(violation.violatedDirective).toBe("connect-src");
    expect(violation.disposition).toBe("enforce");

    // The actual invariant (M0 recommendation #4's exact wording): not
    // "zero requests were attempted" (Chromium's documented behavior is to
    // attempt, then block at send time — a stricter "zero attempts"
    // assertion would fail Chromium's own correct, safe behavior) but zero
    // *successful* responses ever arrived from a non-self origin.
    expect(nonSelfResponses).toEqual([]);
  });
});
