# Hyakkei — Product Requirements Document

- **Status**: Draft v1 (2026-07-04)
- **Owner**: yotta (@yottayoshida)
- **Related**: [ROADMAP.md](./ROADMAP.md) · [ARCHITECTURE.md](./ARCHITECTURE.md) · [ADRs](./adr/)

---

## 1. One-liner

> Anyone who can open a spreadsheet can build and share a Digital Agency-quality dashboard, for free, in five minutes.

Just as ukiyo-e woodblock prints democratized art in Edo-period Japan — mass-produced, affordable, made for common people rather than aristocrats — Hyakkei democratizes data visualization. The name comes from *hyakkei* (百景, "one hundred views"), the classic ukiyo-e series format (e.g. Hiroshige's *One Hundred Famous Views of Edo*).

## 2. Problem

### 2.1 The gap

The [Digital Agency of Japan publishes a Dashboard Design Guidebook](https://www.digital.go.jp/resources/dashboard-guidebook): design principles (Do's & Don'ts), a 7-color palette, a layout grid system, and chart samples. It is excellent — and its only ready-to-use deliverable is a **Power BI template (.pbit)**.

This creates a gap:

| Who | Blocker |
|-----|---------|
| Local-government staff | No Power BI license, or no budget approval path for one. Data lives in Excel. IT can't operate servers. |
| Small businesses / NPOs | Same: no BI budget, data in spreadsheets, nobody to run Metabase. |
| Civic tech developers / vendors | Want to build guideline-compliant dashboards, but there is no OSS implementation of the guidebook — every project re-implements the palette and layout by hand. |
| Individuals | Existing free tiers (Looker Studio etc.) require accounts and send data to third-party clouds. |

### 2.2 Why existing OSS doesn't close it

Metabase, Superset, Redash, and Grafana are all **database-first, server-first**: they assume a DB to connect to and a server someone operates. The people in the table above have neither. File-first newer tools (Evidence, Observable Framework, Rill) target **developers** — they require SQL, Markdown, or a build pipeline. None of them implement the Japanese government design system.

### 2.3 The wedge

Two properties no incumbent combines:

1. **Browser-complete.** The entire pipeline — file load, query, render — runs in the browser (DuckDB-WASM). Deployment is static files. **Data never leaves the machine.** In restricted government networks where external SaaS is unavailable, this is not a feature but the only viable delivery mechanism.
2. **Design-system native.** The Digital Agency design tokens (MIT), the guidebook's palette, grid, and Do's & Don'ts are built into the editor as defaults and constraints. Following the guidelines is what happens when you don't think about it.

## 3. Users

### P1 — Government / municipal staff ("Sato-san")

Runs monthly reports in Excel. No coding. No server. Needs to publish KPI dashboards internally (file share / intranet) or externally (city website). Success = replaces a static PDF report with an interactive dashboard without asking IT for anything.

### P2 — Small-org operator ("Tanaka-san")

Ops person at a small company or NPO. Comfortable with spreadsheets, maybe light SQL. Success = a shared team dashboard hosted as static files on existing infrastructure (Google Drive-adjacent workflows, S3, a rented web server).

### P3 — Civic tech / vendor developer ("Dev")

Builds dashboards for governments. Wants guideline compliance out of the box, dashboards as reviewable code (Git), and templates to hand to non-developer clients. Success = ships a compliant dashboard in a day instead of a week, and the client can edit it themselves afterwards.

**Priority: P1 > P3 > P2.** P1 is the differentiated core. P3 is the amplifier (vendors and civic tech spread templates; templates acquire P1 users). P2 comes along for free.

### Non-users (v0.x)

- Data engineers with warehouses and dbt pipelines (use Rill/Evidence/Superset).
- Ops/infra monitoring (use Grafana).
- Orgs needing row-level security and per-viewer data (out of scope until v1.0, maybe forever).

## 4. Use cases

1. **Monthly KPI report** — Sato-san drops `applications_2026-06.xlsx`, picks a bar chart + line chart + stat tiles, arranges them on the grid, exports static HTML, puts it on the intranet file share. Next month: drop the new file into the same dashboard definition, re-export.
2. **Open data publication** — a city publishes population/budget dashboards on its website as static files; the underlying CSV is downloadable from the same page (open data by construction).
3. **Template distribution** — a prefecture makes a "COVID-style situation dashboard" template; 40 municipalities load the JSON, swap in their own CSV, publish.
4. **Dashboard as code** — Dev keeps `dashboard.json` in Git, reviews changes via PR, CI exports and deploys static files to GitHub Pages.
5. **Live-data team dashboard (v1.0)** — a team connects PostgreSQL/BigQuery/HTTP APIs through a thin server, refreshes on schedule, and puts the whole thing behind their IdP via IAP/oauth2-proxy.

## 5. Product principles

1. **Data never leaves by default.** v0.x processes everything client-side. Any future network feature must be explicit, visible, opt-in.
2. **Guidelines are defaults, not homework.** Palette, grid, typography come from the design tokens. Do's & Don'ts are encoded as editor nudges (see §6.3). The user can override — we advise, never lock.
3. **A dashboard is one JSON file.** Portable, diffable, versionable, distributable. The GUI is just an editor for it. (ADR-0002)
4. **The app has no accounts.** No login, no user table, no telemetry. Authentication, when needed (v1.0 server), is delegated to the deployment platform. (ADR-0003)
5. **Boring technology, small surface.** Every dependency is a liability owned by one maintainer. Prefer platform features over libraries, libraries over frameworks, and cutting scope over both.

## 6. Scope

### 6.1 v0.1 (MVP) — "one person, one file, five minutes"

**In:**

| # | Capability | Notes |
|---|-----------|-------|
| F1 | Load data: CSV / Excel (.xlsx) via drag & drop; Google Sheets via *published-CSV URL* paste | All parsed in-browser; DuckDB-WASM as the query engine |
| F2 | Data preview + light shaping | Column types, filter, aggregate (group by + sum/count/avg) — GUI generating SQL, not a SQL editor |
| F3 | Charts: bar, line, area, pie/donut, scatter, table, stat tile (big number) | The guidebook's core set; each maps to a guidebook sample |
| F4 | Guideline nudges | e.g. pie with >6 categories → suggest bar; guideline-violating color use → warn (§6.3) |
| F5 | Grid layout editor | Guidebook grid system; drag-resize-reorder; responsive breakpoints from the design tokens |
| F6 | Theming | Digital Agency design tokens + guidebook 7-color palette as the default (and only, in v0.1) theme; light/dark |
| F7 | Save/open `dashboard.json` | Download / file-open; the file embeds data-source *references*, optionally inlined data snapshots |
| F8 | Export static site | Self-contained folder (HTML+JS+assets+data files) that renders the dashboard read-only; "put it anywhere" |
| F9 | Japanese + English UI | Japanese first-class, not an afterthought |

**Out (deliberately):** server anything, auth anything, DB/API connectors, scheduled refresh, collaboration/comments, custom themes, plugin system, non-tabular data (geo/maps deferred — see Open Questions), custom SQL editor.

### 6.2 v0.x — grow without breaking "browser-complete"

Template gallery (guidebook-derived starter dashboards), embed snippet (iframe/script tag), print/PDF layout, map chart (guidebook includes maps), CLI exporter for CI (dashboard.json → static site in a pipeline), more shaping operations. Ordering decided by user feedback; see [ROADMAP.md](./ROADMAP.md).

### 6.3 Guideline nudges (F4) — what "design-system native" concretely means

The guidebook's Do's & Don'ts are encoded as **data**: a rules file (`guideline-rules.json`) evaluated against the chart spec, each rule carrying a message and a citation to the guidebook section. Examples:

| Rule | Trigger | Nudge |
|------|---------|-------|
| `pie-too-many-slices` | pie/donut with > 6 categories | "Consider a bar chart" + one-click convert |
| `line-too-many-series` | line chart with > 4 series | "Consider small multiples or highlight one series" |
| `truncated-axis` | bar chart with non-zero y-axis baseline | "Truncated axes exaggerate differences" |
| `3d-anything` | (not offered at all) | 3D charts simply don't exist in Hyakkei |
| `palette-order` | manual colors deviating from palette sequence | "Use palette order for categorical data" |

Rules are warnings with explanations, never hard blocks (except by omission, like 3D). This file is independently useful and may become its own artifact for the community.

### 6.4 v1.0 — "a team, live data, behind your IdP"

Defined as an outcome, not a feature list: *a team can operate dashboards connected to live data sources, safely, behind their own identity provider.* Adds a **single-container server** that (a) serves the static app, (b) proxies data-source connections (PostgreSQL, MySQL, BigQuery, HTTP APIs) with credentials held server-side, (c) refreshes snapshots on schedule. Still no built-in login — deployment docs show IAP / ALB+Cognito / oauth2-proxy patterns. See ARCHITECTURE §7.

## 7. Success metrics

Honest constraint: no telemetry (Principle 4) means no usage analytics. We measure what's publicly observable plus self-run tests:

| Metric | Target | How measured |
|--------|--------|--------------|
| Time-to-first-dashboard (new user, sample CSV → exported site) | ≤ 5 min | Scripted usability test, run each release |
| GitHub stars | 300 by v0.1+3mo; 1,000 by v1.0 | Proxy for developer (P3) traction |
| Community templates in the gallery | 10 by v0.5 | Direct measure of the template flywheel (UC3) |
| Public deployments spotted in the wild | 3 municipalities / orgs by v1.0 | Search + community reports; the metric that actually matters |
| Guideline-compliance of default output | 100% of nudge rules pass on all gallery templates | CI check |

## 8. Risks

| Risk | Sev | Mitigation |
|------|-----|-----------|
| **Maintenance load**: a dashboard builder is a large surface for one maintainer | High | Ruthless v0.1 scope; JSON spec as the stable contract; "boring tech"; say no by default |
| **Sherlocking**: Digital Agency ships its own OSS tool | Med | Their current deliverable is Power BI-based; if it happens, celebrate — pivot Hyakkei to the community/extension layer, or archive with pride (mission accomplished) |
| **Design-system churn**: tokens/guidebook change | Med | Pin token versions; theming isolated in one layer; treat token upgrades as releases |
| **Trademark/affiliation confusion** | Med | Name contains no official terms; visible disclaimer in README and app footer; comply immediately if contacted |
| **DuckDB-WASM constraints** (bundle size ~ tens of MB, memory ceiling, Safari quirks) | Med | Architecture spike is the first v0.1 task (ROADMAP M0); fallback path documented in ADR-0004 |
| **Excel parsing fidelity** (merged cells, 和暦 dates, multi-sheet) | Med | v0.1 supports well-formed tables only, with a clear "fix your sheet like this" error UX; fidelity grows in v0.x |
| **"Free Power BI" expectation mismatch** — users ask for pivot tables, DAX-like measures | Low | PRD non-goals + a public "what Hyakkei is not" doc section |

## 9. Non-goals (durable)

- Not a general-purpose BI platform. No ambition to out-feature Metabase.
- No built-in authentication or user management, ever (ADR-0003).
- No proprietary cloud service as the primary distribution (a hosted demo is fine).
- No telemetry.

## 10. Open questions (to resolve in /plan and M0 spike)

1. **Excel parsing library**: SheetJS CE vs ExcelJS vs DuckDB excel extension in WASM — fidelity, bundle size, license check. → M0
2. **Chart library final check**: ECharts (assumed; see ADR-0004) vs Vega-Lite — bundle size and a11y of rendered output. → M0
3. **`dashboard.json` schema versioning policy** — forward-compat strategy from day one. → design in M1, ship with `"version": 1`
4. **Map charts**: guidebook includes maps; standard Japanese municipal boundary GeoJSON exists (国土数値情報). In v0.x — which milestone?
5. **Accessibility bar**: the design system implies WCAG conformance; charts are notoriously hard. Define the v0.1 a11y statement honestly (keyboard nav + data-table fallback for every chart?).
6. **Community language policy**: repo is English (workspace rule), but P1 users are Japanese. Docs likely need `docs/ja/` mirrors — when?
