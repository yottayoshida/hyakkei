# Hyakkei — Architecture

- **Status**: Draft v1 (2026-07-04, amended 2026-07-05). Component boundaries here are design intent; M0/M1 implementation may adjust details but not the boundaries themselves without an ADR.
- **Related**: [PRD.md](./PRD.md) · [ROADMAP.md](./ROADMAP.md) · [ADRs](./adr/)

## Amendment (2026-07-05)

`/plan` investigation settled that the viewer (exported/shared sites) never runs DuckDB-WASM or SQL — see **ADR-0005**. §2, §4, §5, and §6 below are rewritten to reflect this; the original "viewer resolves sources live via DuckDB" design is retired, not merely deprecated. If you're looking for the old "snapshot vs URL-ref source embedding" design, it no longer exists — see ADR-0005 for why and what replaced it.

---

## 1. Design constraints (from the PRD, in priority order)

1. **Browser-complete**: v0.x must run with zero server-side compute and deploy as static files (ADR-0001).
2. **One JSON file is the product**: everything renderable must round-trip through `dashboard.json` (ADR-0002). Note: this is the *authoring* document. The exported/viewed artifact is a separate, simpler `BakedDashboard` (ADR-0005) — both are "the product" for their respective audience (editor vs. viewer).
3. **No accounts, no telemetry**: the app never phones home; auth is the platform's job (ADR-0003).
4. **Design-system native**: theming and guideline rules are data consumed by the engine, not hardcoded styling.
5. **One maintainer**: minimize surface; boring, mainstream, well-documented dependencies (ADR-0004).
6. **The viewer never executes SQL**: query execution is bounded to the editor and the export-time `bake()` step (ADR-0005). No exported or shared dashboard is a live SQL-execution surface.

## 2. System overview (v0.x)

Two lifecycles share the same Renderer but touch entirely different components. **Editing** (and export) has a query engine; **viewing** never does.

```
┌────────────────────────────── Editing (browser) ───────────────────────────────┐
│                                                                                 │
│  ┌──────────┐   ┌───────────────┐   ┌──────────────┐   ┌───────────┐          │
│  │  Editor   │──▶│ dashboard.json │◀──│   Renderer   │──▶│  Charts   │  ← preview
│  │  (React)  │   │  (authoring,   │   │ (layout +    │   │ (ECharts) │          │
│  └──────────┘   │   ADR-0002)    │   │  binding)    │   └───────────┘          │
│        │        └───────────────┘   └──────┬───────┘                          │
│        │                                    │ SQL                              │
│        ▼                                    ▼                                  │
│  ┌──────────────────┐            ┌────────────────────┐                       │
│  │ Guideline engine  │            │   Query engine      │                       │
│  │ (rules.json eval) │            │   (DuckDB-WASM,     │                       │
│  └──────────────────┘            │   editor/export only,│                      │
│                                   │   ADR-0005)          │                      │
│                                   └─────────┬────────────┘                      │
│                                             │                                  │
│                              ┌──────────────┴──────────────┐                  │
│                              │     DataSource interface     │                  │
│                              ├──────────────┬──────────────┤                  │
│                              │  FileSource  │  UrlSource   │  (v0.1)          │
│                              │ (drag&drop)  │ (fetch CSV)  │                  │
│                              └──────────────┴──────────────┘                  │
│                                    [ ProxySource ]  (v1.0, ADR-0001)          │
│                                             │                                  │
│                                    ── export ──▶  bake(document, tables)      │
│                                                       → BakedDashboard (ADR-0005)│
└─────────────────────────────────────────────────────┬───────────────────────────┘
                                                        │ ships as static output
                                                        ▼
┌────────────────────────────── Viewing (browser, no query engine) ─────────────┐
│                                                                                 │
│  ┌───────────────────┐        ┌──────────────┐        ┌───────────┐          │
│  │  BakedDashboard    │───────▶│   Renderer   │───────▶│  Charts   │          │
│  │  (rows already     │        │ (same code   │        │ (ECharts) │          │
│  │   computed)        │        │  as editing) │        └───────────┘          │
│  └───────────────────┘        └──────────────┘                                │
│  No DuckDB-WASM. No SQL. No Worker. Single-file: zero network requests.        │
│  Folder: only its own two same-origin files, never a third-party origin       │
│  — a BakedDashboard carries no source URLs to fetch (ADR-0005).                │
└─────────────────────────────────────────────────────────────────────────────────┘
```

Six components, six responsibilities:

| Component | Responsibility | Explicitly NOT its job |
|-----------|---------------|------------------------|
| **Editor** | Mutate the authoring dashboard document via UI; file I/O for open/save | Rendering charts (delegates to Renderer for preview) |
| **Renderer** | (Authoring document \| BakedDashboard) + data → laid-out, themed DOM. Pure function of (document-or-baked, data, theme) | Fetching data; knowing where data came from; running queries |
| **Query engine** | Execute the SQL stored in the authoring document against registered tables (DuckDB-WASM). **Lives only in the editor and at export time — never in a viewer** (ADR-0005) | Anything at view time |
| **DataSource layer** | Uniform interface: bytes/rows in, DuckDB table registered. Implementations: File, Url (v0.1), Proxy (v1.0). **Editor/export-time only** | Query logic beyond its own source; anything at view time |
| **Bake function** | `bake(document, resolvedTables) → BakedDashboard`: runs every query once, at export, producing pre-computed chart rows (ADR-0005) | Editing, interactivity, anything beyond a pure transform |
| **Guideline engine** | Evaluate `guideline-rules.json` against chart specs; emit nudges with guidebook citations | Blocking the user; styling |

The **Renderer is shared verbatim** across the editor preview, the exported static site, and the future CLI (v0.4) — it accepts either the authoring document (editor preview) or a `BakedDashboard` (viewer, CLI output) through the same layout/theme code path. This is the key reuse decision: export and CLI are thin shells around the same rendering core, and because `bake()` is the *only* thing standing between them, preview-vs-published divergence is structurally impossible — not because the two paths happen to agree, but because there is only one path after baking.

## 3. The `dashboard.json` document (schema v1 sketch)

This is the **authoring** format — what the editor reads and writes, and what templates distribute (ADR-0005's "two artifact kinds" table). The exported/viewed artifact is the separate, simpler `BakedDashboard` sketched in ADR-0005 — both are finalized in M1 with published JSON Schemas (issue #6 covers both as co-deliverables, not just this one).

Shape:

```jsonc
{
  "version": 1,
  "meta": { "title": "月次KPIダッシュボード", "description": "...", "locale": "ja" },
  "theme": { "tokens": "@digital-go-jp/design-tokens@x.y.z", "palette": "guidebook-blue" },
  "sources": [
    {
      "id": "apps",
      "kind": "file",                      // "file" | "url" | "proxy" (v1.0)
      "format": "xlsx",
      "ref": { "name": "applications_2026-06.xlsx", "sheet": "data" }
      // no "snapshot" field: sources are resolved by the editor and never
      // travel into an export — bake() produces a separate BakedDashboard
      // artifact instead (ADR-0005). This authoring file only ever holds
      // a reference to where the editor should (re-)load the data from.
    }
  ],
  "queries": [
    { "id": "by_category", "source": "apps",
      "sql": "SELECT category, SUM(amount) AS total FROM apps GROUP BY 1 ORDER BY 2 DESC" }
  ],
  "charts": [
    { "id": "c1", "type": "bar", "query": "by_category",
      "encoding": { "x": "category", "y": "total" },
      "options": { "title": "区分別申請額" } }
  ],
  "layout": {
    "grid": "guidebook-12col",
    "items": [ { "chart": "c1", "x": 0, "y": 0, "w": 6, "h": 4 } ]
  }
}
```

Design notes:

- **Queries are SQL strings** even though v0.1's UI is GUI-only: the GUI *generates* SQL. This keeps the document expressive beyond what the GUI can build, gives P3 developers an escape hatch, and means the editor's query engine needs exactly one execution path. These SQL strings never travel into a viewer (ADR-0005) — they are consumed only by the editor's DuckDB-WASM instance and by `bake()` at export time.
- **Sources are references, resolved during editing**: a dashboard can point at a file by name (re-dropped each session) or a URL (fetched by the editor). There is no "embed a live source for the viewer to re-fetch" option — that design was retired by ADR-0005. `bake()` resolves sources once, at export, and the result is what ships; F2-style filtering/shaping is authoring-time only (PRD §6.1) and has no equivalent at view time.
- **Schema evolution**: additive-only within `version: 1`; unknown fields are preserved on round-trip (forward compatibility for older editors opening newer files).

## 4. Data flow examples

**Editing (v0.1)**: drop .xlsx → ExcelJS parses it into rows (DuckDB-WASM cannot read `.xlsx` directly, ADR-0004 Amendment) → FileSource registers the rows as a DuckDB table → user builds chart in GUI → GUI emits SQL into `queries[]` → Renderer runs the query against the editor's DuckDB-WASM instance, draws ECharts with theme → Guideline engine evaluates the chart spec → nudges shown.

**Export (M3)**: `bake(document, resolvedTables)` runs every query once, producing a `BakedDashboard` (ADR-0005) → user picks packaging: **single HTML file (default)** — `BakedDashboard` inlined as an inert JSON data island, renderer bundle inlined and CSP-allow-listed by hash (ADR-0005), one file, double-click, done, **literally zero network requests to open it** — or **folder (advanced)** — `index.html` + `renderer.js` + `dashboard.json` (the baked artifact) as separate files, for embedding or when inlining would be impractically large; opening it makes exactly two same-origin relative-path requests (for `renderer.js` and `dashboard.json`) and never a third-party one, because a `BakedDashboard` carries no source URLs to fetch. Either way, the exported output contains **no DuckDB-WASM, no SQL, no Worker** — just the renderer and already-computed data.

**Viewing an exported site**: static page boots the renderer → loads the `BakedDashboard` (inlined `<script>` blob or a fetched JSON/Parquet file, per packaging choice) → renders charts directly from the pre-computed rows. No query engine is ever loaded. This is why `file://` double-click and any static host work unconditionally (ADR-0005) — the COOP/COEP and null-origin-fetch constraints that would otherwise confine DuckDB-WASM (QA V-001/V-002) simply don't apply, because there is no DuckDB-WASM in a viewer to confine.

## 5. Technology choices (details in ADR-0004)

| Layer | Choice | One-line why |
|-------|--------|--------------|
| Language | TypeScript | Ecosystem fit with design tokens + one language across app/CLI |
| UI | React 18 | Digital Agency publishes React example components; largest hiring/contribution pool |
| Charts | Apache ECharts 6.1.0, **SVG renderer** | Covers all guidebook chart types incl. maps later; SVG chosen over canvas for golden-test determinism and a screen-reader-readable DOM (M0 spike, ADR-0004 amended 2026-07-10); strong CJK text handling (with an explicit `axisLabel.interval` override — see spike); Apache-2.0 |
| Query | DuckDB-WASM 1.32.0 (pinned) | SQL over CSV/Parquet, editor/export-time only (ADR-0005); the enabling technology for ADR-0001. Cannot read `.xlsx` directly (ADR-0004 Amendment) |
| Excel parsing | ExcelJS | Parses `.xlsx` into rows before DuckDB table registration; MIT, npm-standard, dependabot-covered (ADR-0004 Amendment) |
| Build | Vite | Boring, fast, default choice |
| Styling | Digital Agency design tokens + tailwind-theme-plugin (both MIT, official) | The point of the product |
| State | Zustand or equivalent small store | The document is the state; no heavy state framework |
| Grid | Evaluate `react-grid-layout` vs thin custom in M2 | Must express the guidebook grid exactly; decide against real requirements |

Known DuckDB-WASM constraints to validate in M0 (**editor only** — a viewer never loads DuckDB-WASM at all, ADR-0005): bundle adds tens of MB (mitigate: lazy-load worker, cache aggressively), memory ceiling for very large files (mitigate: document limits honestly, e.g. "hundreds of MB, not GB"), and — because `file://`/static hosts can't set COOP/COEP — the editor itself may need to run the single-threaded build unless self-hosted with isolation headers; measure both configurations in M0.

## 6. Security & privacy model (v0.x)

The precise, honest claim is not "data never leaves your machine" — it's **"data leaves only to origins you explicitly approved."** In v0.1/M1, "approved" is deliberately narrow: the only origin ever approved is the app's own (`connect-src 'self'`) — there is no per-session approval UI yet (see below). The claim widens, without becoming less precise, once M2/SR-3 adds a real approval step. Either way it is enforced mechanically, not by policy:

- **CSP `connect-src` is the primary containment mechanism**, in both the editor and exported output. **v0.1 (M1) ships `connect-src 'self'` only, with no per-session origin-approval mechanism** — `UrlSource` fetches same-origin data exclusively; a pasted third-party URL (e.g. a published Google Sheets link) is routed to a download-then-drop escape hatch (`FileSource`) instead of a live fetch. This is a correction from an earlier draft of this section, which described a per-session "approved origins" model: issue #7's implementation found that widening `connect-src` to any third-party origin (even a fixed, curated allowlist) also widens what a malicious *authoring* file's SQL can reach via DuckDB's `httpfs` extension — `connect-src` is a single, undifferentiated gate that cannot distinguish "the app's own same-origin data fetch" from "a compromised query engine reaching the same origin." Per-session origin approval is deferred to M2/SR-3, gated on a mechanism (Service Worker-mediated CSP, most likely) that can widen `connect-src` for the app's own fetches without also widening what SQL can reach. In the **viewer**, `connect-src` is `'self'` only, full stop — a `BakedDashboard` carries no source references or URLs to fetch (ADR-0005), so there is no "origins to approve" case at all. This is enforced by the browser and cannot be bypassed from SQL — unlike a DuckDB configuration flag, a CSP directive holds even if the query engine itself is compromised.
- **DuckDB-WASM configuration (`autoinstall_known_extensions=false`, `autoload_known_extensions=false`, `allow_community_extensions=false`, `lock_configuration=true`) is defense-in-depth, not the primary control.** M0 verified this empirically (`docs/spikes/m0-containment.md`): CSP `connect-src` alone blocks a crafted `SELECT ... FROM 'https://...'` and `INSTALL`/`LOAD` with zero successful external requests, even with **all** of these flags absent. **`enable_external_access=false` is deliberately excluded from this list** — the same spike found it also blocks `registerFileBuffer`'s local, in-memory reads, breaking the editor's own "load the user's file" workflow; DuckDB's flag doesn't distinguish a locally-registered buffer from a network resource. **The viewer needs none of this — it never loads DuckDB-WASM at all (ADR-0005)**, so this entire control surface is scoped to the editor and to `bake()` at export time. **`extensions.duckdb.org` must never appear in `connect-src`**: `httpfs` (the extension that lets SQL read an `https://` URL at all) is not bundled into the WASM binary — DuckDB fetches it from `extensions.duckdb.org` the first time `LOAD httpfs` runs (issue #7 finding, `docs/spikes/m0-containment.md`). Keeping that origin out of `connect-src` makes `httpfs` permanently unloadable, which forecloses the entire `SELECT ... FROM 'https://...'` attack class structurally, independent of the DuckDB config flags above. A CI check for this omission is tracked for whenever CSP headers/meta are actually wired up (M2 — no CSP artifact exists in the repo yet to check against).
- **No data egress by default**: file processing is in-browser; a `UrlSource` fetches only same-origin data (see above). No analytics, no error reporting to third parties, no CDN-loaded code anywhere (fully self-contained bundles, editor and viewer alike).
- **Exported sites**: contain exactly what the user chose to embed — the export dialog states plainly *"this folder contains your data; anyone who can read the files can read the data."* Secrecy of a published dashboard is the host's access control, not ours. Because the viewer never executes SQL (ADR-0005), an exported/shared dashboard carries no query-injection or extension-loading risk regardless of who opens it — the corresponding risk (a malicious *authoring* file's SQL running when opened in the editor) is a separate, editor-side concern, tracked as V-050 in the implementation plan.
- **Supply chain**: lockfile committed, GitHub's default Dependabot security alerts remain on (no separate config needed), dependency budget rule (ROADMAP §maintenance). Scheduled routine version-update PRs (`.github/dependabot.yml`) are deliberately not configured — a one-maintainer project reviewing every dependency bump on a fixed cadence is a maintenance-budget mismatch (ROADMAP §maintenance); security alerts alone give the supply-chain signal without the routine-PR overhead. CI builds exported-site goldens so a compromised dependency changing output is visible. ExcelJS (not SheetJS CE — ADR-0004 Amendment) keeps the Excel parser inside this supply-chain net.
- **CSP**: the **editor** ships with `default-src 'none'; script-src 'self' 'wasm-unsafe-eval'; connect-src 'self'; object-src 'none'` (v0.1/M1 — no per-session origin widening; see above) — `'wasm-unsafe-eval'` is needed there because the editor loads DuckDB-WASM. The **exported viewer never loads DuckDB-WASM** (ADR-0005), so it does not need `'wasm-unsafe-eval'` at all: single-file exports ship `default-src 'none'; script-src 'self' 'sha256-<renderer-bundle-hash>'; connect-src 'self'; object-src 'none'` (the baked data is an inert `type="application/json"` data island, unaffected by `script-src`; the inlined renderer bundle is allow-listed by its per-release hash, not `'unsafe-inline'`); folder exports can use plain `script-src 'self'` since `renderer.js` loads via `<script src>`. See ADR-0005 for the full mechanism and its build-time obligations (determinism, exact-bytes hashing).

## 7. v1.0 server extension (design intent — build only when ROADMAP entry criteria pass)

One container, three jobs, still no identity:

```
        Internet ──▶ [ IAP / ALB+Cognito / oauth2-proxy ]   ← platform-owned auth
                                   │ authenticated traffic
                                   ▼
                    ┌─────────── hyakkei-server ───────────┐
                    │ 1. serve the static app (same build)  │
                    │ 2. data proxy: /api/source/:id/query  │
                    │    credentials from env/secret store   │
                    │ 3. scheduler: snapshot refresh, cron   │
                    └───────────────┬───────────────────────┘
                                    ▼
                     PostgreSQL · MySQL · BigQuery · HTTP APIs
```

- The browser app gains exactly one new DataSource implementation: `ProxySource`, speaking to `/api/source/:id/query`. Renderer, editor, document format: unchanged. This is why the M1 DataSource interface is the only forward-provision v0.1 is allowed. **Caveat surfaced during issue #7's implementation**: the M1 interface's additive guarantee (`register()` returning a registered table, no reshape needed) holds cleanly for a *snapshot*-style proxy (the server materializes rows, the browser registers them exactly like a `FileSource`/`UrlSource`). The design sketched above — the proxy executing *stored queries* server-side and returning results — is a *pushdown* style, which is not the same shape: it pushes query execution itself across the network boundary, rather than only the byte/row acquisition step. Whether v1.0 adopts snapshot, pushdown, or both is an open v1.0 design decision, not decided by this document; the M1 interface promises additive-only for the snapshot case only.
- Connector credentials live server-side (env vars / secret manager), never in dashboard.json, never in the browser.
- The server trusts its perimeter (ADR-0003): it reads identity headers (e.g. `X-Goog-Authenticated-User-*`) at most for audit logging, not for authorization decisions in v1.0. Per-user data authorization is parking-lot.
- Query safety at the proxy: allowlisted source IDs, per-source read-only credentials, statement timeouts, row limits. The proxy executes *stored* queries by ID plus bound parameters — it is not an open SQL endpoint.

## 8. Testing strategy

| Layer | Approach |
|-------|----------|
| Document schema | JSON Schema validation in CI; round-trip (open→save) property tests |
| Renderer | Golden-image tests on the 3+ sample dashboards, both themes, ja/en |
| Guideline engine | Table-driven: every rule has trigger + non-trigger fixtures; gallery templates must pass all rules in CI |
| Query/data layer | Fixture files (messy real-world CSV/XLSX corpus from M0) → expected tables |
| Bake function | Round-trip/property tests: `bake()` output matches editor-preview query results exactly, for both packaging modes |
| Export | Build export in CI, serve statically (and open via `file://`), Playwright asserts identical render vs editor preview; single-file mode asserts literally zero network requests, folder mode asserts only its two same-origin requests |
| The 5-minute test | Manual, scripted protocol, every release (ROADMAP M2/M4 acceptance) |

## 9. Repository layout (target, v0.1)

```
hyakkei/
├── docs/                  # you are here (PRD, ROADMAP, this file, adr/)
├── packages/
│   ├── schema/            # dashboard.json + BakedDashboard JSON Schemas, TS types (zero-dep)
│   ├── core/              # renderer, query engine glue, DataSource layer, guideline engine, bake()
│   ├── app/               # editor (React) — imports core
│   └── export/            # single-file/folder packaging (M3); later reused by CLI (v0.4)
├── templates/             # gallery dashboard.json files (v0.2, seeded in M4)
├── rules/                 # guideline-rules.json + guidebook citations
└── e2e/                   # Playwright
```

Monorepo (pnpm workspaces) so that `schema`/`core` can later publish as npm packages for the CLI and for third parties without extracting them from the app.
