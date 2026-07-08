import { describe, expect, it, vi } from "vitest";
import { createEgressPolicy } from "./egress-policy.js";
import { DataSourceError } from "./types.js";

// Shape IDs (EG-*) reference
// .claude/plans/2026-07-08-hyakkei-issue7-datasource-pr-A1-shapes.md §2b.

function fakeResponse(
  init: { ok?: boolean; status?: number; statusText?: string; body?: string } = {},
): Response {
  const { ok = true, status = 200, statusText = "OK", body = "a,b\n1,2\n" } = init;
  return {
    ok,
    status,
    statusText,
    arrayBuffer: async () => new TextEncoder().encode(body).buffer,
  } as Response;
}

describe("createEgressPolicy — EG-A11 headline invariant: deny-all rejects with zero network calls", () => {
  it("rejects a well-formed https URL when no selfOrigin is configured", async () => {
    const fetchSpy = vi.fn();
    const policy = createEgressPolicy({ fetch: fetchSpy as unknown as typeof fetch });
    await expect(policy.fetchBytes("https://gov.example.jp/x.csv")).rejects.toThrow(
      DataSourceError,
    );
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("rejects a relative URL when there is no selfOrigin to resolve it against", async () => {
    const fetchSpy = vi.fn();
    const policy = createEgressPolicy({ fetch: fetchSpy as unknown as typeof fetch });
    await expect(policy.fetchBytes("/data/x.csv")).rejects.toThrow(DataSourceError);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe("createEgressPolicy — same-origin shapes are fetched", () => {
  const selfOrigin = "https://gov.example.jp";

  it.each([
    ["EG-1 same-origin absolute", "https://gov.example.jp/data/x.csv"],
    ["EG-2 same-origin with path/query/fragment", "https://gov.example.jp/a/b.csv?v=2#frag"],
    ["EG-3 explicit default port normalizes to no port", "https://gov.example.jp:443/x"],
    ["EG-B1 mixed-case scheme (parse, not startsWith)", "HTTPS://gov.example.jp/x"],
    ["EG-B4 relative path resolved against selfOrigin", "/data/x.csv"],
    // EG-A9: `new URL()` strips CR/LF entirely during parsing rather than
    // throwing (verified empirically — contrast with an earlier draft's
    // "throws" assumption) — no raw control byte ever reaches the fetch
    // primitive, so a same-origin URL with embedded CRLF is simply a
    // same-origin URL and is correctly fetched, not a request-splitting
    // vector.
    [
      "EG-A9 CRLF is stripped by URL parsing, not smuggled",
      "https://gov.example.jp/x\r\nEvil: header",
    ],
  ])("%s", async (_label, url) => {
    const fetchSpy = vi.fn(async () => fakeResponse());
    const policy = createEgressPolicy({ selfOrigin, fetch: fetchSpy as unknown as typeof fetch });
    const bytes = await policy.fetchBytes(url);
    expect(bytes).toBeInstanceOf(Uint8Array);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it("EG-A9: the CRLF bytes never reach the fetch primitive's URL", async () => {
    let requestedUrl: string | URL | undefined;
    const fetchSpy = vi.fn(async (url: string | URL) => {
      requestedUrl = url;
      return fakeResponse();
    });
    const policy = createEgressPolicy({ selfOrigin, fetch: fetchSpy as unknown as typeof fetch });
    await policy.fetchBytes("https://gov.example.jp/x\r\nEvil: header");
    expect(String(requestedUrl)).not.toMatch(/\r|\n/);
  });
});

describe("createEgressPolicy — rejected before any fetch call (network 0)", () => {
  const selfOrigin = "https://gov.example.jp";

  it.each([
    ["EG-B2 different port is a different origin", "https://gov.example.jp:8443/x"],
    ["EG-B3 protocol-relative resolves to a different origin", "//evil.com/x.csv"],
    ["EG-B5 trailing-dot host is a distinct origin string", "https://gov.example.jp./x"],
    ["EG-A1 javascript: scheme", "javascript:fetch('//evil')"],
    ["EG-A2 data: scheme", "data:text/csv,1,2,3"],
    ["EG-A3 file: scheme (chokepoint re-checks, doesn't trust schema)", "file:///etc/passwd"],
    // Shape doc EG-A4 groups several non-https schemes under one ID
    // ("blob: / ftp: / ws: / chrome-extension: ... enumerate a few to prove
    // allow-list, not deny-list") — labeled 4a/4b here so each test row
    // stays uniquely named (/simplify simplification pass).
    ["EG-A4a blob: scheme", "blob:https://gov.example.jp/uuid"],
    ["EG-A4b ftp: scheme", "ftp://gov.example.jp/x"],
    // Rejected by the credentials guard (parsed.username is non-empty),
    // before origin comparison ever runs — NOT a demonstration of ".origin
    // vs startsWith" (an earlier draft's comment claimed that; /simplify's
    // altitude pass caught the mismatch between what this shape is labeled
    // and what code path it actually exercises). The plain
    // subdomain-suffix-confusion case below is the one that actually
    // reaches, and is rejected by, the origin comparison alone.
    [
      "EG-A5 userinfo host-spoof (rejected by the credentials guard)",
      "https://gov.example.jp@evil.com/x",
    ],
    ["EG-A6 double-@ (also rejected by the credentials guard)", "https://a@b@evil.com/"],
    ["EG-A6 credentials on an otherwise-allowed origin", "https://u:p@gov.example.jp/"],
    ["EG-A7 IPv6 literal, not self", "https://[::1]/x"],
    ["EG-A8 homograph origin, not self", "https://аpple.jp/x"],
    // Test-adversarial-review additions (Phase 6-B): none of these defeat the
    // parse-then-compare design — each resolves to an origin that simply
    // isn't `selfOrigin`, verified against Node's real `URL` parser before
    // writing the assertion. Pinned as regressions, not because a gap was
    // found.
    ["backslash authority is parsed as a different host", "https:\\\\evil.com\\\\x"],
    // Resolved against `selfOrigin` as a base (this policy's actual call
    // path — `parseAgainst` always passes `selfOrigin` as base when one is
    // configured), `\\evil.com\\x` parses successfully to `evil.com`, not a
    // throw (verified: without a base it throws, but that isn't the path
    // this policy takes when `selfOrigin` is set — test-adversarial-review
    // Round 2 caught the label/comment describing the no-base behavior
    // instead of the actual one under test).
    [
      "backslash-only resolves against selfOrigin, still lands on a different host",
      "\\\\evil.com\\\\x",
    ],
    [
      "percent-encoded slash before userinfo is still userinfo, host is evil.com",
      "https://gov.example.jp%2f@evil.com/x",
    ],
    [
      "percent-encoded dot creates a literal subdomain-suffix host",
      "https://gov.example.jp%2eevil.com/x",
    ],
    ["plain subdomain-suffix confusion is a distinct host", "https://gov.example.jp.evil.com/x"],
  ])("%s", async (_label, url) => {
    const fetchSpy = vi.fn();
    const policy = createEgressPolicy({ selfOrigin, fetch: fetchSpy as unknown as typeof fetch });
    await expect(policy.fetchBytes(url)).rejects.toThrow(DataSourceError);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe("createEgressPolicy — network outcome mapping", () => {
  const selfOrigin = "https://gov.example.jp";

  it("maps a 404 response to the 'network-notfound' error kind", async () => {
    const fetchSpy = vi.fn(async () =>
      fakeResponse({ ok: false, status: 404, statusText: "Not Found" }),
    );
    const policy = createEgressPolicy({ selfOrigin, fetch: fetchSpy as unknown as typeof fetch });
    await expect(policy.fetchBytes("https://gov.example.jp/x.csv")).rejects.toMatchObject({
      kind: "network-notfound",
    });
  });

  it("maps a non-404 error response to the 'network-blocked' error kind", async () => {
    const fetchSpy = vi.fn(async () =>
      fakeResponse({ ok: false, status: 500, statusText: "Server Error" }),
    );
    const policy = createEgressPolicy({ selfOrigin, fetch: fetchSpy as unknown as typeof fetch });
    await expect(policy.fetchBytes("https://gov.example.jp/x.csv")).rejects.toMatchObject({
      kind: "network-blocked",
    });
  });

  it("maps a fetch() throw (e.g. a real CORS block) to 'network-blocked'", async () => {
    const fetchSpy = vi.fn(async () => {
      throw new TypeError("Failed to fetch");
    });
    const policy = createEgressPolicy({ selfOrigin, fetch: fetchSpy as unknown as typeof fetch });
    await expect(policy.fetchBytes("https://gov.example.jp/x.csv")).rejects.toMatchObject({
      kind: "network-blocked",
    });
  });

  // Security Review (Phase 8): the same-origin check only inspects the
  // *initial* URL — without `redirect: "error"`, a same-origin URL that
  // itself 3xx-redirects to a third-party origin would still reach it.
  it("requests redirect:'error' so a same-origin URL can't redirect off-origin", async () => {
    const fetchSpy = vi.fn(async () => fakeResponse());
    const policy = createEgressPolicy({ selfOrigin, fetch: fetchSpy as unknown as typeof fetch });
    await policy.fetchBytes("https://gov.example.jp/x.csv");
    expect(fetchSpy).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ redirect: "error" }),
    );
  });

  it("maps the TypeError fetch() throws on an encountered redirect to 'network-blocked'", async () => {
    const fetchSpy = vi.fn(async (_url: string | URL, init?: RequestInit) => {
      if (init?.redirect !== "error")
        throw new Error("test misconfigured: expected redirect:'error'");
      throw new TypeError("Failed to fetch"); // real fetch() behavior for redirect: "error" on a 3xx
    });
    const policy = createEgressPolicy({ selfOrigin, fetch: fetchSpy as unknown as typeof fetch });
    await expect(policy.fetchBytes("https://gov.example.jp/x.csv")).rejects.toMatchObject({
      kind: "network-blocked",
    });
  });

  it("maps a hung request past timeoutMs to the 'aborted' error kind", async () => {
    const fetchSpy = vi.fn(
      (_url: string | URL, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () =>
            reject(new DOMException("aborted", "AbortError")),
          );
        }),
    );
    const policy = createEgressPolicy({
      selfOrigin,
      fetch: fetchSpy as unknown as typeof fetch,
      timeoutMs: 5,
    });
    await expect(policy.fetchBytes("https://gov.example.jp/x.csv")).rejects.toMatchObject({
      kind: "aborted",
    });
  });

  // Codex Round 1 P1: the timeout previously stopped covering the request
  // right after `fetchImpl()` resolved, before the body was actually read —
  // a stall or failure during `response.arrayBuffer()` (headers received,
  // body never arrives / errors) was neither timed out nor wrapped.
  it("maps a hang during body read (after headers resolve) to 'aborted' via the same timeout", async () => {
    const fetchSpy = vi.fn(async (_url: string | URL, init?: RequestInit) => {
      return {
        ok: true,
        status: 200,
        statusText: "OK",
        arrayBuffer: () =>
          new Promise<ArrayBuffer>((_resolve, reject) => {
            init?.signal?.addEventListener("abort", () =>
              reject(new DOMException("aborted", "AbortError")),
            );
          }),
      } as unknown as Response;
    });
    const policy = createEgressPolicy({
      selfOrigin,
      fetch: fetchSpy as unknown as typeof fetch,
      timeoutMs: 5,
    });
    await expect(policy.fetchBytes("https://gov.example.jp/x.csv")).rejects.toMatchObject({
      kind: "aborted",
    });
  });

  it("wraps a raw arrayBuffer() failure as 'network-blocked' rather than leaking an untyped error", async () => {
    const fetchSpy = vi.fn(
      async () =>
        ({
          ok: true,
          status: 200,
          statusText: "OK",
          arrayBuffer: async () => {
            throw new Error("stream reset");
          },
        }) as unknown as Response,
    );
    const policy = createEgressPolicy({ selfOrigin, fetch: fetchSpy as unknown as typeof fetch });
    const result = policy.fetchBytes("https://gov.example.jp/x.csv");
    await expect(result).rejects.toBeInstanceOf(DataSourceError);
    await expect(result).rejects.toMatchObject({ kind: "network-blocked" });
  });

  // /code-review (Phase 9): an editor served over plain http can never pass
  // the origin check for any UrlSource, because the schema forces every
  // authored url to https:// — the mismatch is a v0.1 constraint (see
  // ADR-0007), not a bug, but the error must name the actual cause instead
  // of reading like a generic allowlist miss.
  it("names the http/https scheme mismatch when the editor itself isn't served over https", async () => {
    const fetchSpy = vi.fn();
    const policy = createEgressPolicy({
      selfOrigin: "http://gov.example.jp",
      fetch: fetchSpy as unknown as typeof fetch,
    });
    const result = policy.fetchBytes("https://gov.example.jp/x.csv");
    await expect(result).rejects.toMatchObject({ kind: "network-blocked" });
    await expect(result).rejects.toThrow(/not served over https/);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
