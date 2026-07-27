# ADR-0007: DataSource interface — table-registrar shape, same-origin-only `UrlSource` egress

- **Status**: Accepted (2026-07-08)
- **Deciders**: yotta

> **Read-forward note (2026-07-27, ADR-0017)**: every "v1.0" below now means **v2.0**, including all references to `ProxySource`. The server tier was renumbered when v1.0 was redefined as agent-generated dashboards.
>
> Two things worth stating because this ADR is the one that carries the forward-provision:
>
> 1. **The open question in "§`ProxySource`'s additive guarantee is scoped to snapshot form, not pushdown form" is still open, and now belongs to v2.0.** Nothing about the renumbering resolves it. Whether the server adopts snapshot form, pushdown form, or both remains undecided.
> 2. **The new v1.0 does not exercise this interface.** It receives already-resolved rows from its caller and connects to no data source, so it adds no third implementation and applies no new pressure on `register()`'s shape. The additive guarantee this ADR scopes to snapshot form is neither strengthened nor weakened by it.
>
> Original text below is unedited; it records what was decided on 2026-07-08.

## Context

ADR-0001 committed to one, and only one, v1.0 forward-provision for v0.x: a `DataSource` interface (`File`, `Url` in v0.1) shaped so that v1.0's `ProxySource` is an addition, not a redesign. Issue #7 is where that interface gets designed and where `UrlSource` — the first DataSource implementation that reaches the network — has to reconcile with the containment model ADR-0005/ARCHITECTURE §6 already committed to.

`/plan` investigation (architect/QA/security/UX + two Codex review rounds) surfaced two decisions this ADR records:

1. **What shape does the interface take**, given it must serve `FileSource` (synchronous bytes from the File API) and `UrlSource` (bytes via network) uniformly, and must not foreclose a v1.0 `ProxySource`?
2. **What does `UrlSource` treat as an allowed fetch target**, given the plan's initial design (a curated third-party allowlist — e.g. Google Sheets' publishing domains — added to editor CSP `connect-src`) turned out to conflict with the containment model itself.

On (2), Codex's second review round raised a Critical: widening `connect-src` to any additional origin — even a small, curated one — also widens what a malicious *authoring* file's SQL can reach via DuckDB's `httpfs` extension, because `connect-src` is a single, undifferentiated gate; it cannot distinguish "the app's own same-origin data fetch" from "a compromised query engine reaching the same origin." A follow-up security re-investigation found the concrete fact that makes this concrete: `httpfs` is not bundled into the DuckDB-WASM binary — it is fetched from `extensions.duckdb.org` the first time `LOAD httpfs` runs (`docs/spikes/m0-containment.md`). So the real containment lever is keeping `extensions.duckdb.org` out of `connect-src` (which forecloses `httpfs` entirely, independent of any other allowlist entry) — but *any* third-party data origin added to `connect-src` for `UrlSource`'s sake is a separate widening that the `httpfs`-blocking argument does not cover, because a compromised query engine could target that same origin with `SELECT ... FROM 'https://<allowed-origin>/...'` using an extension mechanism other than `httpfs` (or, more simply, because "a small number of trusted origins" is still strictly more attack surface than zero).

## Decision

### DataSource interface: table-registrar shape (`register()`), not query-executor

```ts
interface TableRegistrar { db: AsyncDuckDB; conn: AsyncDuckDBConnection; }
interface EgressPolicy { fetchBytes(url: string): Promise<Uint8Array>; }
interface RegisterContext { registrar: TableRegistrar; egress: EgressPolicy; }
type SourceShape = { kind: "sheets"; sheets: string[] }
                  | { kind: "columns"; columns: ColumnMeta[]; rowCountEstimate?: number };

interface DataSource {
  readonly spec: Source;
  inspect(ctx: RegisterContext): Promise<SourceShape>;
  register(ctx: RegisterContext, opts?: { sheet?: string }): Promise<RegisteredTable>;
}
```

The shared contract is the **output** — a registered table (name, column metadata, row count) — not the input. `FileSource` acquires bytes synchronously from the File API; `UrlSource` acquires them via `ctx.egress.fetchBytes()`; both then run through the same byte→table registration path. `egress` is always present on `RegisterContext` (not optional) so a future snapshot-style `ProxySource` can consume it identically to `UrlSource` without `RegisterContext` needing a reshape.

`inspect()` exists alongside `register()` because a multi-sheet xlsx (a real M0 fixture shape) needs the editor to show a sheet picker before committing to one interpretation — `register()` alone cannot express "list what's available, then let the user choose." Implementations should cache acquired bytes/parse results between `inspect()` and `register()`, since for `UrlSource`, inspecting *is* fetching (there is no cheap partial-read for a CSV/xlsx over HTTP).

**Rejected: query-executor shape** (`runQuery(sql): Promise<rows>`). This would let a *pushdown*-style v1.0 `ProxySource` (server executes stored SQL, returns rows) be additive, but violates ADR-0001's "no other v1.0 preparation" — it starts building query-engine abstraction (issues #8/#9's job) into the DataSource layer, and creates responsibility overlap: `File`/`Url` would need `runQuery` to mean "run this SQL against my one registered table," which is either a thin wrapper around the real query engine (redundant surface) or a second, parallel implementation of it (drift risk).

**Rejected: each `DataSource` owns its own DuckDB instance.** Breaks cross-source `JOIN`s (a `full` dashboard sample already joins across sources) and `bake()`'s single-environment execution model (ADR-0005); also multiplies the DuckDB-WASM payload (tens of MB) per source.

### `ProxySource`'s additive guarantee is scoped to snapshot form, not pushdown form

ARCHITECTURE §7 sketches `ProxySource` as `/api/source/:id/query` executing *stored queries* server-side — a pushdown design. That shape does not fit `register()` additively: it pushes query execution itself across the network boundary, not just byte/row acquisition. A **snapshot**-style proxy (server materializes rows, browser registers them exactly like `FileSource`) fits `register()` cleanly and is what this interface's additive guarantee actually covers. Whether v1.0 adopts snapshot, pushdown, or both remains an open v1.0 decision (ARCHITECTURE §7 updated with this caveat) — this ADR does not resolve it, only makes explicit that "the M1 interface is the only v1.0 preparation needed" is true for snapshot form and not guaranteed for pushdown form.

### `UrlSource`: same-origin fetch only in v0.1; no `connect-src` widening

`UrlSource.fetchBytes()` only succeeds for a URL whose resolved origin equals the page's own origin (`connect-src 'self'`, unchanged from ARCHITECTURE §6's existing baseline). A pasted third-party URL (published Google Sheets link, open-data portal CSV, ...) is rejected before any network call, with the editor UI (PR-B, not this PR) pointing the author at the download-then-drop escape hatch (`FileSource`) instead.

Enforcement is a `new URL()` parse followed by four checks, in this order: (1) `protocol === "https:"`, (2) no `username`/`password` present (credentials embedded in a URL must never leave in a request — the value itself is a deanonymization/exfiltration channel independent of where the request goes), (3) relative references are resolved against the injected `selfOrigin` *before* checking, so a legitimate same-site relative URL works, (4) the **resolved** URL's `.origin` must equal `selfOrigin` exactly (scheme+host+port) — checked after resolution, never via string prefix matching. Rejecting on the *parsed and resolved* representation, not the input string, is what defeats a mixed-case scheme (`HTTPS://…`), a userinfo host-spoof (`https://self@evil.com`), and a protocol-relative payload (`//evil.com/x`) resolving its host from the base while keeping the base's scheme — all three were verified empirically against Node's `URL` implementation during this PR's PoC, and a naive `url.startsWith(selfOrigin)` check is fooled by at least the first two.

Deny-all (no `selfOrigin` configured) is the default and is provable without a network dependency: `fetchBytes()` throws before any call to the injected `fetch` primitive, so a pure test can assert the primitive's call count is zero.

**Rejected: fixed third-party allowlist added to `connect-src`** (the plan's original design — `'self'` plus a small set of known-good origins such as Google's published-sheet domains). Rejected per the Context section: any widening of `connect-src` is a widening of what a compromised query engine can reach, not just what the app's own fetch layer can reach, and `connect-src` cannot express "only my own fetch calls, not SQL's." Revisit in M2/SR-3 once a mechanism exists (most likely Service Worker-mediated response interception) that can grant the app's own fetch layer broader reach without also granting it to `connect-src` at large.

**`extensions.duckdb.org` must never appear in `connect-src`, independent of the above.** This is a distinct, narrower control: it forecloses `httpfs` (the DuckDB extension that lets SQL read an `https://` URL) from ever loading, regardless of what else is or isn't in the allowlist. *(Originally written when no CSP artifact existed in the repository yet to check against — PR-A1.5's amendment below wires that artifact and its CI regression ahead of schedule; this paragraph is left as the historical record of the decision, not a still-current status.)*

**Known v0.1 constraint: the editor itself must be served over https for `UrlSource` to ever succeed** (`/code-review`, Phase 9). `UrlSource.ref.url` is schema-constrained to `^https://` (dashboard.ts) — the author cannot author a plain-http url even if they wanted to — while `EgressPolicy` requires the *resolved* origin to equal `selfOrigin` exactly, scheme included. Serving the editor over plain http (a same-origin static-file-server or object-storage deployment without TLS — both are README.md-listed v0.1 deployment targets) makes this comparison structurally impossible to satisfy: `parsed.origin` is always `https://host`, `selfOrigin` is `http://host`, and no same-host URL can match. This is *not* fixed by loosening the schema or the scheme check to accept `http://` — doing so would mean fetching plain-http URLs, a real confidentiality/integrity regression, not a fix for a false restriction. The constraint is accepted as-is for v0.1: `UrlSource` requires an https-served editor; an http-served editor can still use `FileSource` (which never touches the network) without restriction. `EgressPolicy`'s rejection message names this specific cause (scheme mismatch) rather than reading as a generic allowlist miss.

### SQL-identifier hardening (schema change, bundled into this PR)

`Source.id` and `Query.source` (the FK pair — an author's own SQL text references `Source.id` verbatim, e.g. `FROM apps`) are now `SqlIdentifier` (`^[A-Za-z_][A-Za-z0-9_]*$`, max 64 chars) instead of an unconstrained non-empty string. This structurally rules out injection syntax (spaces, quotes, semicolons, pipes) without a denylist. `Query.id` is deliberately left unrestricted — it is never embedded in generated or user-authored SQL text, only used as an opaque cross-reference key (`Chart.query`), so restricting it would add authoring friction (rejecting a Japanese or reserved-word-shaped query id) without closing any injection surface.

The pattern alone cannot reject SQL reserved words (`select`, `from`, ...) — every letter of a keyword is itself a valid identifier character. Two layers, not one:
1. **Primary**: generated SQL always double-quotes identifiers (`CREATE TABLE "<id>"`) — the DuckDB-native way to make a reserved word syntactically safe (DuckDB's own `KeywordHelper::RequiresQuotes` follows the same quote-when-needed principle). Implemented in PR-A2 (the ingestion code that actually generates SQL).
2. **Defense-in-depth**: `validate.ts` rejects a `Source.id` matching a snapshotted DuckDB reserved-keyword list, case-insensitively — DuckDB identifier lookups are always case-insensitive, quoted or not (confirmed against DuckDB's own documentation), so `select`/`Select`/`SELECT` are equally unsafe as an unquoted identifier. This exists purely to give an author a clear authoring-time error, not as the thing actually preventing injection.

**New shape found during this PR's shape enumeration, not previously covered**: two source ids differing only by case (`Apps` vs `apps`) pass schema validation individually but collide as the same DuckDB table (case-insensitive identifier lookup) — a silent-clobber trap the existing exact-match duplicate check (`AA-7`) does not catch. `validateDashboardReferences`'s duplicate check for source ids is now case-insensitive; `Query`/`Chart` ids (which never become table names) keep exact-match-only dedup.

## Alternatives considered

| Option | Rejected because |
|---|---|
| Query-executor DataSource shape (`runQuery(sql)`) | Violates ADR-0001 (builds query-engine abstraction into DataSource); overlaps issue #8/#9's responsibility |
| Each `DataSource` owns its own DuckDB instance | Breaks cross-source `JOIN` and `bake()`'s single-environment model |
| Fixed third-party allowlist in `connect-src` (original plan) | Widens what SQL can reach, not just what the app's fetch layer can reach — `connect-src` cannot express the distinction |
| DuckDB config flags as the primary `httpfs`/network defense | Reverses ADR-0005/ARCHITECTURE §6's "CSP holds even if the query engine is compromised" principle; DuckDB's WASM flag behavior is explicitly documented (M0) as non-authoritative |
| Restrict `Query.id` the same as `Source.id` | No corresponding injection surface — `Query.id` is never embedded in SQL text; would only add authoring friction |

## Amendment (2026-07-14, PR-A1.5): CSP wired ahead of DuckDB-WASM landing, not after

This ADR's "Decision" section above, and ARCHITECTURE §6, described the CSP `connect-src`
containment model but left the artifact itself — a real header or `<meta>` tag — deferred
to M2, "when CSP headers/meta are actually implemented." `/plan`'s differential re-review
of the remaining issue #7 work (PR-A2 ingestion, PR-B intake UI) surfaced that this was
backwards: PR-A2 is the first PR that instantiates real DuckDB-WASM in this repository, and
without a shipped CSP artifact, that instantiation would run in an environment with *no*
`connect-src` enforcement at all — the primary containment mechanism this ADR and
ARCHITECTURE §6 rely on would simply not exist yet, leaving DuckDB's own defense-in-depth
flags (`autoinstall_known_extensions=false` etc.) as the *only* control during that window,
which M0 (`docs/spikes/m0-containment.md`) explicitly found insufficient on its own to rely
on ("DuckDB's WASM flag behavior is explicitly documented as non-authoritative").

**Decision**: split the remaining issue #7 work into three PRs instead of two —
**PR-A1.5** (containment wiring: CSP as a real artifact, DuckDB-WASM self-hosted via
`MANUAL_BUNDLES` rather than the package's default `getJsDelivrBundles()` CDN, the
defense-in-depth flag `SET` sequence as a shared function, and a CI regression) lands
**before** PR-A2 (FileSource/UrlSource ingestion, the first PR that actually instantiates
DuckDB-WASM). PR-A2 then lands into an environment where containment is already verified,
rather than needing to prove it itself.

**CSP string correction**: ARCHITECTURE §6 previously documented the editor's target CSP as
`default-src 'none'; script-src 'self' 'wasm-unsafe-eval'; connect-src 'self'; object-src
'none'` — this omits `worker-src`, and per the CSP fallback chain (`worker-src -> child-src
-> script-src -> default-src`), a `default-src 'none'` with no `worker-src` would have
blocked DuckDB's own Worker outright had it shipped as written. PR-A1.5 ships
`docs/spikes/m0-containment.md`'s exact tested string (`default-src 'self'; ...;
worker-src 'self'`) plus `object-src 'none'` as additional hardening M0 didn't test but
which cannot regress anything M0 verified.

**DuckDB-WASM vendor files are not committed to git.** `spikes/vendor/`'s 4 files (2
Worker scripts + 2 wasm binaries, ~75MB total) were never tracked — `.gitignore` excludes
all of `spikes/*` — and PR-A1.5 follows the same pattern for `packages/app/public/vendor/`:
a build-time script (`packages/app/scripts/copy-duckdb-vendor.mjs`) copies these 4 files
from the already-pinned `@duckdb/duckdb-wasm` npm dependency (exact version match by
construction — there is no separate version to drift) into `public/vendor/` on `dev`/
`build`, and Vite copies `public/` into `dist/` like any other static asset. This keeps the
same-origin self-hosting property (the actual security-relevant fact — no third-party CDN
origin in `connect-src`) without a 75MB binary blob accumulating in git history on every
DuckDB-WASM version bump.

**DuckDB factory/containment-flag ownership: `packages/app`, not `packages/core/
src/datasource`.** `packages/core/src/renderer/bundle-isolation.test.ts` forbids a
`new Worker(` marker anywhere in core's bundle — core cannot construct an `AsyncDuckDB`
instance without breaking that guarantee, and this ADR's own interface design (`
TableRegistrar` as dependency injection, never constructed by a `DataSource`) already
established the same boundary for `register()`'s DuckDB handle. `configureContainment()`
(the flag `SET` sequence) takes an already-connected `AsyncDuckDBConnection` and issues no
construction of its own, so it *could* live in either package on that basis alone — it
stays in `packages/app` (`src/duckdb/containment.ts`) so DuckDB-facing code (the eventual
factory PR-A2 adds, plus this flag sequence) isn't split across two packages for no benefit.

**Residual risks this amendment adds** (PR-A1.5 security review; both are PR-A2 preconditions,
not exploitable by this PR, which never instantiates a real DuckDB-WASM `Worker`):

- **RR-NEW-1 — CSP's `connect-src` containment does not reach a same-origin Worker on a
  header-less static host.** A network-loaded (non-`blob:`/`data:`) Worker does not inherit
  its creating document's CSP — its policy comes from its own response's
  `Content-Security-Policy` header (CSP3; see ARCHITECTURE §6's amended text). On a deployment
  target that cannot set response headers (GitHub Pages, a plain object-storage bucket — both
  README.md-listed v0.1 targets), the Worker's `connect-src` is unenforced by the browser, and
  `configureContainment()`'s DuckDB flags become the *sole* control against `LOAD
  httpfs`/`SELECT ... FROM 'https://...'` in that shape, not defense-in-depth alongside CSP.
  Attacker capability required: victim deploys the editor to a header-less host **and** opens a
  malicious authoring file **and** PR-A2 ships without addressing RR-NEW-2 below.
- **RR-NEW-2 — nothing yet structurally prevents PR-A2 from wiring a DuckDB connection without
  calling `configureContainment()`.** The function exists and is tested in isolation
  (`containment.test.ts`) but has no caller. PR-A2 must either route every connection through a
  single wrapper that calls it (and forbid the raw path via lint, mirroring how
  `bundle-isolation.test.ts` forbids a bare `new Worker(` in core), or cover the call in an
  integration test that would fail if a future edit ever bypassed it.

## Consequences

- (+) `register()`'s additive guarantee is real for the interface v0.1 actually ships (`File`, `Url`, future snapshot-`Proxy`) — verified by construction (shared output contract), not by convention.
- (+) `UrlSource`'s network chokepoint (`EgressPolicy`) is fully testable without a real DuckDB-WASM instance or a live network — the headline invariant (deny-all → reject + zero network calls) is a pure unit test.
- (+) The containment model gains a second, independent lever (`extensions.duckdb.org` exclusion) that holds even if a future `connect-src` widening (M2/SR-3) is done carelessly for an unrelated reason.
- (−) v0.1 `UrlSource` cannot fetch third-party data directly — a real capability gap versus the plan's original design, mitigated by the file-drop escape hatch. Users pasting a Google Sheets URL get a "download then drop" message, not a live fetch, until M2/SR-3 lands a mechanism that can widen fetch reach without widening SQL's reach.
- (−) `Source.id`/`Query.source` is a breaking schema change from PR #47's v1 shape — accepted now because the schema has zero real users yet (issue #6 merged 2026-07-07); this is the cheapest point in the project's life to make this change.
- (−) A curated DuckDB reserved-keyword list (`validate.ts`) needs re-syncing on a DuckDB *engine* upgrade (not an `@duckdb/duckdb-wasm` npm version bump — the two are independently numbered); documented in-code with the source file and date it was snapshotted from.
