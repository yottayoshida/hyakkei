# ADR-0001: Browser-complete architecture for v0.x

- **Status**: Accepted (2026-07-04, amended 2026-07-05)
- **Deciders**: yotta

## Amendment (2026-07-05)

**ADR-0005 narrows this decision's scope.** "The entire v0.x pipeline... runs in the browser" (below) remains true for the *editor* and for the export step itself. It is no longer true that an *exported/viewed* dashboard runs SQL or DuckDB-WASM — the viewer only ever renders pre-computed data (ADR-0005). Read "the browser" in the Decision below as "the editor's browser session," not "every browser that ever opens a dashboard."

## Context

Hyakkei targets users (municipal staff, small orgs) who have no servers, no ops capability, and often sit in restricted networks where external SaaS is unavailable. Every incumbent OSS dashboard tool (Metabase, Superset, Redash, Grafana) is server-first, which is precisely why the target users don't use them.

## Decision

The entire v0.x pipeline — file parsing, SQL queries, rendering, export — runs in the browser, **during editing and at export time**. DuckDB-WASM is the query engine for that editing/export session (never for a viewer opening the resulting export — ADR-0005). Deployment of both the app and exported dashboards is static files. No server-side compute exists until v1.0, and even then it is additive, never required.

**One forward-provision is allowed**: the DataSource layer is an interface from day one (File, Url in v0.1) so that v1.0's ProxySource is an addition, not a redesign. No other v1.0 preparation may be built in v0.x.

## Alternatives considered

1. **Server-first with a nice UI** — rejected: head-on with Metabase, and abandons the differentiator (works where servers can't exist).
2. **Electron/desktop app** — rejected: install friction, per-OS builds, and it can't serve UC2 (published dashboards on websites). The browser build can later be wrapped for desktop if demand appears; the reverse is not true.
3. **Hybrid from day one (optional light server)** — rejected: doubles the test/support surface for one maintainer before any user demand is proven.

## Consequences

- (+) Deploy anywhere: GitHub Pages, object storage, intranet share, `file://`. Data never leaves the machine — a hard requirement in government networks becomes a built-in property.
- (+) Zero operating cost for us and for users.
- (−) Bundle size (DuckDB-WASM adds tens of MB) and browser memory ceilings bound the data size we can honestly support. Mitigation: M0 spike measures the limits; docs state them plainly.
- (−) No scheduled refresh or live DB connections in v0.x. Accepted: that is v1.0's outcome.
- (−) Browser matrix (esp. Safari workers) becomes a first-class test concern.
