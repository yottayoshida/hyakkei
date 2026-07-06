# M0 spike: SQL/network containment (issue #28)

**Status: GO.** Both attack attempts fail with zero successful external requests, in
every combination tested — including the adversarial case where DuckDB's own
defense-in-depth flags are entirely absent. This empirically confirms Security Threat
Model judgment 2 (`.claude/plans/2026-07-04-hyakkei-v0.1.md`): **CSP `connect-src` is
the real enforcement primitive; DuckDB's config flags are defense-in-depth, not the
thing actually stopping the network call.** The strength of that evidence differs by
engine — see "Evidence strength by engine" below; it does not change the GO decision,
but the per-engine confidence isn't uniform and this document is explicit about that.

## Method

Two independent conditions were tested against the same two attacks, in all 3 engines,
under one shared strict CSP served via a real HTTP response header (not a `<meta>` tag,
which some directives ignore):

```
default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; connect-src 'self'; worker-src 'self'
```

- **`restricted`**: DuckDB config flags applied before the attack —
  `autoinstall_known_extensions=false`, `autoload_known_extensions=false`,
  `allow_community_extensions=false`, `enable_external_access=false`,
  `lock_configuration=true` (applied last, since it freezes further `SET`s).
- **`unrestricted`**: no DuckDB flags applied at all. This simulates "the flags are
  misconfigured, forgotten, or don't work as documented in the WASM build" — exactly
  the risk this issue exists to check, since DuckDB's own docs only document flag
  behavior for native builds, not WASM.

Attacks, run via SQL against both conditions:

```sql
SELECT * FROM 'https://attacker.example/x.csv';
INSTALL httpfs;
LOAD httpfs;
```

Three independent detection methods, not "DuckDB returned an error" alone:

1. `page.on('request')` — every network request whose origin differed from the serving
   origin, regardless of what DuckDB/JS reported.
2. `page.on('console')` — browsers report CSP violations to console; this catches
   engines that describe *why* a call failed, not just that it failed.
3. A same-origin **control test** (`runControlTest` in `spikes/containment/run.mjs`): a
   plain `fetch()` from the main document under the identical CSP, listening for the
   native `securitypolicyviolation` DOM event. This isolates "does this engine's CSP
   `connect-src` enforcement mechanism work at all" from "did DuckDB's specific call get
   blocked by it" — the two can't be fully unified because DuckDB's actual network
   attempts happen inside its own Worker bundle, which this spike can't instrument
   directly.

## Results

| Condition | Engine | `SELECT ...https://...` | `INSTALL httpfs` | `LOAD httpfs` | External requests observed |
|---|---|---|---|---|---|
| restricted | all 3 | blocked — DuckDB permission error, no fetch attempted | **not blocked** (see below) | blocked — DuckDB permission error | **none** |
| unrestricted | Chromium | blocked — browser-level `NetworkError` on the actual XHR send | not blocked | blocked — browser-level `NetworkError` on the actual XHR send | **attempted, then blocked**: `attacker.example/x.csv`, `extensions.duckdb.org/.../httpfs.duckdb_extension.wasm` |
| unrestricted | WebKit | blocked — explicit CSP refusal (see below) | not blocked | blocked — explicit CSP refusal | none logged as a `request` event (see evidence-strength note) |
| unrestricted | Firefox | blocked — generic `NetworkError` | not blocked | blocked — generic `NetworkError` | none logged |

Control test (plain `fetch()` from the main document, same CSP, same origin, all 3 engines):

| Engine | `securitypolicyviolation` fired | `violatedDirective` | `disposition` |
|---|---|---|---|
| Chromium | yes | `connect-src` | `enforce` |
| Firefox | yes | `connect-src` | `enforce` |
| WebKit | yes | `connect-src` | `enforce` |

## Evidence strength by engine (not uniform — stated plainly)

- **WebKit — direct, explicit**: the console literally reports
  `"Refused to connect to https://attacker.example/x.csv because it does not appear in
  the connect-src directive of the Content Security Policy."` for both attack calls.
  No inference needed.
- **Chromium — strong, converging**: `page.on('request')` shows the browser actually
  attempted `attacker.example/x.csv` and `extensions.duckdb.org/.../httpfs...wasm`
  (proving DuckDB really tried to reach the network with no flags stopping it), and the
  failure is Blink's standard `"Failed to execute 'send' on 'XMLHttpRequest'"` message —
  the known signature of a synchronous CSP `connect-src` block at XHR send time. No
  explicit "Refused... CSP" console text was captured, but the combination of (attempted
  URL + this exact error shape + a passing control test on the same policy) is strong
  circumstantial evidence.
- **Firefox — weakest single-engine evidence, but not unsupported**: neither the request
  event nor a CSP-specific console string was captured for the actual DuckDB attack calls
  — only a generic `"NetworkError: A network error occurred."` This is the residual gap
  Codex R1 review flagged. It is **not left as bare assertion**: the control test proves
  Firefox's `connect-src` enforcement mechanism fires correctly under the identical
  policy on the identical origin (`disposition: enforce`), no DuckDB flag was active in
  `unrestricted` mode to explain the block any other way, and zero requests reached any
  server. The causal chain is well-supported but inferential for Firefox specifically,
  not directly observed the way it is for WebKit and Chromium.

**Why this doesn't block GO**: all three engines independently converge on "zero
successful external requests, in every condition." The gap is about *how directly each
engine's evidence proves the mechanism*, not about whether containment held. If Firefox's
CSP enforcement had a gap here, the request would still have had to succeed for the
attack to work — and no detection method (request log, console, or the control test)
showed any evidence that it did.

### `INSTALL httpfs` "succeeding" is not a containment gap

`INSTALL httpfs` returned without error in both conditions, in all three engines, and
produced **zero requests** in the `restricted` condition. Comparing against
`unrestricted` mode — where the actual extension binary fetch only appeared once `LOAD
httpfs` ran, not at `INSTALL` — shows `INSTALL` alone doesn't touch the network in this
WASM build; it appears to be a local/no-op registration step, and `LOAD` is what
actually fetches and would execute extension code. The operation that matters (`LOAD`)
is blocked in every condition tested.

## Recommendation

- **Go** on the CSP-primary / DuckDB-flags-secondary containment design (ADR-0005
  threat model consequence, judgment 2). No rework needed before M1.
- Carry forward to M1 (SR-1 "封じ込め" implementation — this spike is scoped to
  containment only; it has no bearing on SR-2 DataSource centralization or SR-3 the
  origin-approval gate, which are separate, untested-here concerns):
  1. Ship the CSP header exactly as tested here (adjust `connect-src` if the editor
     needs additional same-origin paths, but keep it deny-by-default for other origins).
  2. **Do not set `enable_external_access=false`** — issue #5's integration demo found
     this flag also blocks `registerFileBuffer`'s local, in-memory reads, breaking the
     editor's core "load the user's own file" workflow (see `m0-summary.md`). Rely on
     CSP alone for network containment, per this spike's `unrestricted` result. The other
     four flags (`autoinstall_known_extensions`, `autoload_known_extensions`,
     `allow_community_extensions`, `lock_configuration`) had no such side effect observed
     and can still be applied.
  3. Do not treat `INSTALL <ext>` returning success as a signal that an extension is
     usable — `LOAD` is the actual gate and it holds.
  4. Add this exact test as a permanent CI regression at M1, with wording matched to what
     was actually observed: assert **zero successful responses from non-self origins**
     (not "zero requests" — Chromium's own unrestricted-mode result shows a request can
     be attempted and still be safely blocked; a test asserting literal zero attempts
     would be a false requirement that Chromium's correct, safe behavior would fail).
     Include the `unrestricted` variant specifically, since it's the one that would catch
     a future DuckDB-WASM version regressing this behavior even if config flags exist.
  5. If stronger Firefox-specific attribution is wanted before relying on this for a
     production security claim (e.g. for a public security writeup), rerun against a
     real external test server with a server-side hit counter instead of relying on
     client-side signals alone — this spike's evidence is sufficient for the M0 go/no-go
     decision but not framed as a substitute for that kind of external verification.
