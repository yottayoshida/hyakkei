# Hyakkei — Architecture

- **Status**: Draft v1 (2026-07-04). Component boundaries here are design intent; M0/M1 implementation may adjust details but not the boundaries themselves without an ADR.
- **Related**: [PRD.md](./PRD.md) · [ROADMAP.md](./ROADMAP.md) · [ADRs](./adr/)

---

## 1. Design constraints (from the PRD, in priority order)

1. **Browser-complete**: v0.x must run with zero server-side compute and deploy as static files (ADR-0001).
2. **One JSON file is the product**: everything renderable must round-trip through `dashboard.json` (ADR-0002).
3. **No accounts, no telemetry**: the app never phones home; auth is the platform's job (ADR-0003).
4. **Design-system native**: theming and guideline rules are data consumed by the engine, not hardcoded styling.
5. **One maintainer**: minimize surface; boring, mainstream, well-documented dependencies (ADR-0004).

## 2. System overview (v0.x)

```
┌─────────────────────────────── Browser ───────────────────────────────┐
│                                                                        │
│  ┌──────────┐   ┌───────────────┐   ┌──────────────┐   ┌───────────┐  │
│  │  Editor   │──▶│ dashboard.json │◀──│   Renderer   │──▶│  Charts   │  │
│  │  (React)  │   │  (in-memory    │   │ (layout +    │   │ (ECharts) │  │
│  └──────────┘   │   document)    │   │  binding)    │   └───────────┘  │
│        │        └───────────────┘   └──────┬───────┘                  │
│        │                                    │ SQL                      │
│        ▼                                    ▼                          │
│  ┌──────────────────┐            ┌────────────────────┐               │
│  │ Guideline engine  │            │   Query engine      │               │
│  │ (rules.json eval) │            │   (DuckDB-WASM)     │               │
│  └──────────────────┘            └─────────┬──────────┘               │
│                                             │                          │
│                              ┌──────────────┴──────────────┐          │
│                              │     DataSource interface     │          │
│                              ├──────────────┬──────────────┤          │
│                              │  FileSource  │  UrlSource   │  (v0.1)  │
│                              │ (drag&drop)  │ (fetch CSV)  │          │
│                              └──────────────┴──────────────┘          │
│                                    [ ProxySource ]  (v1.0, ADR-0001)  │
└────────────────────────────────────────────────────────────────────────┘
```

Five components, five responsibilities:

| Component | Responsibility | Explicitly NOT its job |
|-----------|---------------|------------------------|
| **Editor** | Mutate the dashboard document via UI; file I/O for open/save | Rendering charts (delegates to Renderer for preview) |
| **Renderer** | dashboard.json + query results → laid-out, themed DOM. Pure function of (document, data, theme) | Fetching data; knowing where data came from |
| **Query engine** | Execute the SQL stored in the document against registered tables (DuckDB-WASM) | Parsing files (DataSources register tables) |
| **DataSource layer** | Uniform interface: bytes/rows in, DuckDB table registered. Implementations: File, Url (v0.1), Proxy (v1.0) | Query logic, caching policy beyond its own source |
| **Guideline engine** | Evaluate `guideline-rules.json` against chart specs; emit nudges with guidebook citations | Blocking the user; styling |

The **Renderer is shared verbatim** between the editor preview, the exported static site, and the future CLI (v0.4). This is the key reuse decision: export and CLI are thin shells around the same rendering core, so preview-vs-published divergence is structurally impossible.

## 3. The `dashboard.json` document (schema v1 sketch)

Finalized in M1 with a published JSON Schema. Shape:

```jsonc
{
  "version": 1,
  "meta": { "title": "月次KPIダッシュボード", "description": "...", "locale": "ja" },
  "theme": { "tokens": "@digital-go-jp/design-tokens@x.y.z", "palette": "guidebook-7" },
  "sources": [
    {
      "id": "apps",
      "kind": "file",                      // "file" | "url" | "proxy" (v1.0)
      "format": "xlsx",
      "ref": { "name": "applications_2026-06.xlsx", "sheet": "data" },
      "snapshot": "data/apps.parquet"      // optional embedded copy, set at export
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

- **Queries are SQL strings** even though v0.1's UI is GUI-only: the GUI *generates* SQL. This keeps the document expressive beyond what the GUI can build, gives P3 developers an escape hatch, and means the renderer needs exactly one execution path.
- **Sources are references, snapshots are optional**: a dashboard can point at a file by name (re-dropped each session), a URL (fetched live), or carry an embedded snapshot (chosen at export). Privacy implication of each is surfaced in the export UI.
- **Schema evolution**: additive-only within `version: 1`; unknown fields are preserved on round-trip (forward compatibility for older editors opening newer files).

## 4. Data flow examples

**Editing (v0.1)**: drop .xlsx → FileSource parses (SheetJS or per-M0 decision) → registers DuckDB table → user builds chart in GUI → GUI emits SQL into `queries[]` → Renderer runs query, draws ECharts with theme → Guideline engine evaluates the chart spec → nudges shown.

**Export (M3)**: user picks per-source embedding (snapshot vs URL ref) → app writes `dist/`: `index.html`, JS bundle (renderer only, no editor), `dashboard.json`, optional `data/*.parquet` → folder works from `file://`, GitHub Pages, GCS, S3, intranet share. Zero network requests when fully snapshotted.

**Viewing an exported site**: static page boots renderer → loads dashboard.json → DataSources resolve (snapshot files or URL fetch) → DuckDB-WASM query → charts. Same pipeline, minus editor.

## 5. Technology choices (details in ADR-0004)

| Layer | Choice | One-line why |
|-------|--------|--------------|
| Language | TypeScript | Ecosystem fit with design tokens + one language across app/CLI |
| UI | React 18 | Digital Agency publishes React example components; largest hiring/contribution pool |
| Charts | Apache ECharts | Covers all guidebook chart types incl. maps later; canvas perf; strong CJK text handling; Apache-2.0 |
| Query | DuckDB-WASM | SQL over CSV/XLSX/Parquet fully client-side; the enabling technology for ADR-0001 |
| Build | Vite | Boring, fast, default choice |
| Styling | Digital Agency design tokens + tailwind-theme-plugin (both MIT, official) | The point of the product |
| State | Zustand or equivalent small store | The document is the state; no heavy state framework |
| Grid | Evaluate `react-grid-layout` vs thin custom in M2 | Must express the guidebook grid exactly; decide against real requirements |

Known DuckDB-WASM constraints to validate in M0: bundle adds tens of MB (mitigate: lazy-load worker, cache aggressively), memory ceiling for very large files (mitigate: document limits honestly, e.g. "hundreds of MB, not GB"), Safari worker/threads quirks (test matrix from day one).

## 6. Security & privacy model (v0.x)

- **No data egress**: file processing is in-browser; UrlSource fetches only URLs the user typed. No analytics, no error reporting to third parties, no CDN-loaded code in exported output (fully self-contained bundles).
- **Exported sites**: contain exactly what the user chose to embed — the export dialog states plainly *"this folder contains your data; anyone who can read the files can read the data."* Secrecy of a published dashboard is the host's access control, not ours.
- **Supply chain**: lockfile committed, dependabot on, dependency budget rule (ROADMAP §maintenance). CI builds exported-site goldens so a compromised dependency changing output is visible.
- **CSP**: exported sites ship with a restrictive Content-Security-Policy meta tag by default (no remote script/connect except user-declared data URLs).

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

- The browser app gains exactly one new DataSource implementation: `ProxySource`, speaking to `/api/source/:id/query`. Renderer, editor, document format: unchanged. This is why the M1 DataSource interface is the only forward-provision v0.1 is allowed.
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
| Export | Build export in CI, serve statically, Playwright asserts identical render vs editor preview and zero unexpected network requests |
| The 5-minute test | Manual, scripted protocol, every release (ROADMAP M2/M4 acceptance) |

## 9. Repository layout (target, v0.1)

```
hyakkei/
├── docs/                  # you are here (PRD, ROADMAP, this file, adr/)
├── packages/
│   ├── schema/            # dashboard.json JSON Schema + TS types (zero-dep)
│   ├── core/              # renderer, query engine glue, DataSource layer, guideline engine
│   ├── app/               # editor (React) — imports core
│   └── export/            # static-site export (M3); later reused by CLI (v0.4)
├── templates/             # gallery dashboard.json files (v0.2, seeded in M4)
├── rules/                 # guideline-rules.json + guidebook citations
└── e2e/                   # Playwright
```

Monorepo (pnpm workspaces) so that `schema`/`core` can later publish as npm packages for the CLI and for third parties without extracting them from the app.
