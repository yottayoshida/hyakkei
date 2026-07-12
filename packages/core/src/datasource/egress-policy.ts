import { DataSourceError, type EgressPolicy } from "./types.js";

export interface EgressPolicyOptions {
  /**
   * The page's own origin (e.g. `window.location.origin` in the real
   * editor), injected so this stays pure and browser-free for tests.
   * Omitted (or empty) means deny-all: every URL is rejected before any
   * network primitive runs (shape enumeration EG-A11, this PR's headline
   * invariant). v0.1 has no other allowlist entry — `UrlSource` fetches only
   * same-origin data; a third-party origin is out of scope for v0.1 (plan
   * §D3) and routed to the editor's download-then-drop escape hatch instead.
   */
  selfOrigin?: string;
  /** Injected for pure tests (assert call-count, simulate failure/hang) and to avoid a hard runtime dependency on the global. Defaults to the global `fetch`. */
  fetch?: typeof fetch;
  /** Aborts a hung request. Default 30s — generous for a same-origin CSV/Parquet fetch, short enough that a stalled connection surfaces as a catchable error rather than a silently-spinning UI (plan's OOM/hang-catchability requirement). */
  timeoutMs?: number;
  /**
   * Response-size ceiling in bytes. Default 256 MiB — over twice the 100 MB
   * CSV envelope M0 measured as practical, so it never blocks a legitimate
   * load; its job is turning "multi-GB same-origin file" into a catchable
   * `DataSourceError('too-large')` instead of an unbounded `arrayBuffer()`
   * allocation that kills the tab before any error UI (#44) can run
   * (issue #67).
   */
  maxBytes?: number;
}

const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_MAX_BYTES = 256 * 1024 * 1024;

/**
 * Resolves `url` against `base` (when given) and re-validates the *result's*
 * origin — never the input string. Resolving against a base is what makes a
 * same-site relative reference (`/data/x.csv`) work; re-checking the
 * resolved origin (not just trusting a relative URL "must" be same-origin)
 * is what stops a protocol-relative payload (`//evil.com/x.csv`) from
 * inheriting the base's scheme and silently becoming a same-scheme,
 * different-origin request (verified empirically: resolving `//evil.com/x`
 * against `https://self` yields `origin=https://evil.com`, shape
 * enumeration EG-B3/EG-B4 — the fix is not skipping resolution, it's never
 * skipping the post-resolve check).
 *
 * Relative-URL support (the `base` argument) has no producer yet: the only
 * schema-validated source of a URL today, `UrlSource.ref.url`
 * (packages/schema/src/dashboard.ts), requires an absolute `^https://`
 * value, so `register()` never actually hands `fetchBytes()` a relative
 * string in this PR. It's kept anyway because `EgressPolicy` is the
 * chokepoint, not a schema-specific helper — a future producer of a
 * same-site relative reference (a snapshot-form `ProxySource`, ADR-0007, or
 * a schema change loosening `UrlSource.ref.url`) should not need this
 * function's safety property re-derived; "resolve, then re-check the
 * resolved origin" holds regardless of which schema shape fed it in.
 */
function parseAgainst(url: string, base: string | undefined): URL {
  return base ? new URL(url, base) : new URL(url);
}

/**
 * Reads a response body under a byte ceiling. A `content-length` header
 * (when the server sends one) fails fast before any allocation, but the
 * streaming count is the enforcement that actually holds — the header is
 * optional and unauthenticated (chunked encoding, or a lying server, simply
 * omits or fakes it). Without this cap the `'too-large'`
 * `DataSourceErrorKind` was unreachable from the egress layer:
 * `arrayBuffer()` buffers unboundedly, so a multi-GB same-origin file killed
 * the tab with a browser OOM before any typed error the editor's error UI
 * (#44) could catch (issue #67).
 */
async function readBodyCapped(response: Response, maxBytes: number): Promise<Uint8Array> {
  const tooLarge = () =>
    new DataSourceError("too-large", `response body exceeds the ${maxBytes}-byte limit`);

  const declared = Number(response.headers?.get("content-length") ?? Number.NaN);
  if (Number.isFinite(declared) && declared > maxBytes) throw tooLarge();

  // A `Response` with no body stream (some fetch test doubles, or a bodyless
  // status) can't stream-count; the post-read check still bounds what this
  // function *returns*, and real `fetch` responses always expose the stream.
  const reader = response.body?.getReader();
  if (!reader) {
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.byteLength > maxBytes) throw tooLarge();
    return bytes;
  }

  const chunks: Uint8Array[] = [];
  let received = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    received += value.byteLength;
    if (received > maxBytes) {
      // Stop pulling bytes off the wire before throwing — the point of the
      // cap is bounding allocation, not just reporting after the fact.
      await reader.cancel();
      throw tooLarge();
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(received);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

/**
 * The one place a `UrlSource` (or a future snapshot `ProxySource`) is
 * allowed to touch the network (plan D3, ARCHITECTURE §6). Every check here
 * runs on the *parsed* `URL`, never the raw string — `startsWith` matching
 * is exactly what a userinfo host-spoof (`https://self@evil.com`) or a
 * mixed-case scheme (`HTTPS://…`) defeats (shape enumeration EG-A5/EG-B1,
 * verified against Node's `URL` implementation in this PR's PoC).
 */
export function createEgressPolicy(options: EgressPolicyOptions = {}): EgressPolicy {
  const {
    selfOrigin,
    fetch: fetchImpl = fetch,
    timeoutMs = DEFAULT_TIMEOUT_MS,
    maxBytes = DEFAULT_MAX_BYTES,
  } = options;

  return {
    async fetchBytes(url: string): Promise<Uint8Array> {
      let parsed: URL;
      try {
        parsed = parseAgainst(url, selfOrigin);
      } catch {
        throw new DataSourceError("network-blocked", `not a resolvable URL: ${url}`);
      }

      if (parsed.protocol !== "https:") {
        throw new DataSourceError(
          "network-blocked",
          `scheme '${parsed.protocol}' is not allowed (https: only)`,
        );
      }
      // Credentials embedded in the URL never leave in a request (LGWAN
      // deanonymization concern, shape enumeration EG-A6) — reject outright
      // rather than silently stripping them, so the author sees the mistake.
      if (parsed.username || parsed.password) {
        throw new DataSourceError(
          "network-blocked",
          "URLs with embedded credentials are not allowed",
        );
      }
      // No separate "no selfOrigin configured" branch needed: `parsed.origin`
      // is always a non-empty string once parsing succeeds, so it can never
      // equal an unset (`undefined`) or empty `selfOrigin` — the deny-all
      // case (EG-A11) falls out of this one comparison for free.
      if (parsed.origin !== selfOrigin) {
        // `UrlSource.ref.url` is schema-constrained to `^https://`
        // (dashboard.ts), so an editor served over plain http — a
        // same-origin static-file-server or object-storage deployment
        // README.md lists as supported, without TLS — can *never* satisfy
        // this check: `parsed.origin` is always `https://host`, `selfOrigin`
        // is `http://host`, and no host-only match makes them equal
        // (/code-review, Phase 9). This is a known v0.1 constraint, not a
        // bug this function can fix by relaxing the scheme check — doing so
        // would mean fetching plain-http URLs, which is a real
        // confidentiality/integrity regression, not a fix. Name the actual
        // cause in the error rather than leaving it looking like a generic
        // config mistake.
        // `startsWith("http://")`, not `!startsWith("https://")`: the hint is
        // about one specific deployment (an editor actually served over plain
        // http). The deny-all configuration (`selfOrigin: ""`, EG-A11) also
        // fails the negated check, which used to mis-blame the editor's TLS
        // setup for a block that is deny-all by configuration (issue #62).
        const schemeMismatch =
          selfOrigin !== undefined &&
          selfOrigin.startsWith("http://") &&
          parsed.protocol === "https:";
        const hint = schemeMismatch
          ? ` (this editor is not served over https — UrlSource requires both the editor and the target to be https, so no same-host URL can pass; see ADR-0007)`
          : "";
        throw new DataSourceError(
          "network-blocked",
          `origin '${parsed.origin}' is not in the allowed list${hint}`,
        );
      }

      // The timeout must stay armed through the body read, not just until
      // headers resolve — a connection that stalls mid-body (rather than
      // never connecting at all) is exactly as hung, and `arrayBuffer()`'s
      // own failure must not leak as a raw, un-typed error (Codex Round 1
      // P1: an earlier draft cleared the timer right after `fetchImpl()`
      // resolved, leaving the body read uncovered by both the timeout and
      // the `DataSourceError` wrapping below).
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      try {
        // `redirect: "error"` (Security Review, Phase 8): without it, `fetch`
        // defaults to following redirects, so a same-origin URL that itself
        // 3xx-redirects to a third-party origin would still send the actual
        // request there — the same-origin check above only inspects the
        // *initial* URL, not where a redirect ultimately lands. v0.1 has no
        // legitimate same-origin-CSV-via-redirect use case, so failing
        // closed on any redirect keeps "never leaves selfOrigin" true
        // end-to-end rather than only at the check above.
        //
        // `mode: "same-origin"` (/code-review, Phase 9): this request is
        // already proven same-origin by the check above — this mode asks
        // the browser's own fetch implementation to enforce that
        // independently (per the Fetch Standard, a "same-origin" request
        // whose current URL's origin doesn't match its origin is a network
        // error before anything is sent), so a future regression in that
        // JS-level check (a typo, a refactor) still can't produce a live
        // cross-origin request — the same "browser enforces it, not just
        // app logic" principle this project applies to CSP (ARCHITECTURE
        // §6). Costs nothing today: every request this policy allows is
        // already same-origin.
        const response = await fetchImpl(parsed, {
          mode: "same-origin",
          credentials: "omit",
          redirect: "error",
          signal: controller.signal,
        });
        if (!response.ok) {
          const kind = response.status === 404 ? "network-notfound" : "network-blocked";
          throw new DataSourceError(
            kind,
            `fetch failed: ${response.status} ${response.statusText}`,
          );
        }
        return await readBodyCapped(response, maxBytes);
      } catch (cause) {
        if (cause instanceof DataSourceError) throw cause;
        if (controller.signal.aborted) {
          throw new DataSourceError("aborted", `fetch timed out after ${timeoutMs}ms`);
        }
        throw new DataSourceError("network-blocked", "fetch failed", { cause });
      } finally {
        clearTimeout(timer);
      }
    },
  };
}
