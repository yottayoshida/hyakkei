import { parseDashboard } from "@hyakkei/schema";
import { describe, expect, it, vi } from "vitest";
import { createEgressPolicy } from "./egress-policy.js";

/**
 * Pins the intentional divergence documented in common.ts/dashboard.ts/
 * ADR-0007 §"UrlSource": the authoring schema requires a lowercase
 * `^https://` prefix (bounce a malformed `HTTPS://` back to the author),
 * while `EgressPolicy` — the network chokepoint, which must not trust that
 * the schema already ran — independently re-derives safety from a parsed
 * `URL` and is more lenient about scheme casing. Without this test, a future
 * "fix" that synchronizes the two regexes in either direction would pass
 * every other test in both packages while silently reverting a documented
 * security-layering decision (/simplify altitude pass, PR-A1).
 */
describe("schema vs. EgressPolicy: intentional HTTPS:// scheme-case divergence", () => {
  const mixedCaseUrl = "HTTPS://gov.example.jp/x.csv";

  it("the authoring schema rejects a mixed-case scheme", () => {
    const doc = {
      version: 1,
      meta: { title: "t" },
      theme: { tokens: "@digital-go-jp/design-tokens@2.0.0", palette: "guidebook-blue" },
      sources: [{ id: "s", kind: "url", format: "csv", ref: { url: mixedCaseUrl } }],
      queries: [],
      charts: [],
      layout: { grid: "guidebook-12col", items: [] },
    };
    expect(parseDashboard(doc).ok).toBe(false);
  });

  it("EgressPolicy accepts the same mixed-case scheme once same-origin (re-derives safety, doesn't trust the schema already ran)", async () => {
    const selfOrigin = "https://gov.example.jp";
    const fetchSpy = vi.fn(
      async () =>
        ({
          ok: true,
          status: 200,
          statusText: "OK",
          arrayBuffer: async () => new TextEncoder().encode("a,b\n1,2\n").buffer,
        }) as unknown as Response,
    );
    const policy = createEgressPolicy({ selfOrigin, fetch: fetchSpy as unknown as typeof fetch });
    await expect(policy.fetchBytes(mixedCaseUrl)).resolves.toBeInstanceOf(Uint8Array);
  });
});
