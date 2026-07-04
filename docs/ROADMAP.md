# Hyakkei — Roadmap

- **Status**: Draft v1 (2026-07-04)
- **Rule**: every version is defined by a **user outcome**, not a feature list. A feature ships in a version only if it serves that version's outcome. This is the scope-creep firewall.

---

## Version outcomes at a glance

| Version | Outcome (the sentence that defines "done") |
|---------|--------------------------------------------|
| **v0.1** | An individual turns a spreadsheet into a Digital Agency-quality dashboard in five minutes and shares it as static files. |
| **v0.2** | A non-author can start from a template instead of a blank page. |
| **v0.3** | A dashboard lives inside other things: web pages (embed) and paper (print). |
| **v0.4** | A developer can build and deploy dashboards from CI without opening a browser. |
| **v0.5** | Guidebook coverage is complete — including maps. |
| **v1.0** | A team operates dashboards on live data, safely, behind their own identity provider. |

Versions v0.2–v0.5 are the current best guess at ordering; feedback after v0.1 may reorder them. The **outcomes** are stable; the **sequence** is not.

---

## v0.1 — MVP

**Outcome**: an individual turns a spreadsheet into a Digital Agency-quality dashboard in five minutes and shares it as static files.

**Feature set**: F1–F9 in [PRD §6.1](./PRD.md#61-v01-mvp--one-person-one-file-five-minutes).

### Milestones

Each milestone has an acceptance check. Do not start milestone N+1 with milestone N's check failing.

#### M0 — Feasibility spike (timeboxed: 1 week)

De-risk the two biggest unknowns before committing to the architecture.

- [ ] DuckDB-WASM: load a 100 MB CSV and a 50k-row .xlsx in Chrome/Firefox/Safari; measure load time, memory, bundle size impact
- [ ] Excel parsing: pick the library (SheetJS CE / ExcelJS / other) via a fidelity test on 10 realistic messy Japanese workbooks (merged headers, 和暦, full-width digits)
- [ ] Chart library: render the guidebook's sample charts pixel-faithfully in ECharts; if blocked, evaluate Vega-Lite; record decision in ADR-0004 (amend if needed)
- [ ] **Acceptance**: a throwaway page that loads an .xlsx, runs `SELECT category, SUM(v) GROUP BY 1` in DuckDB-WASM, and renders a guideline-styled bar chart — in all three browsers

#### M1 — Dashboard spec + rendering core

The contract everything else builds on.

- [ ] `dashboard.json` schema v1: metadata, data-source refs, queries, chart specs, grid layout (JSON Schema published in-repo)
- [ ] Data-access abstraction: one interface, two implementations (local file, fetched URL). **This is the only v1.0 forward-provision allowed in v0.1** — see ADR-0001
- [ ] Renderer: `dashboard.json` + data → laid-out themed dashboard (read-only, no editor yet)
- [ ] Theme layer consuming Digital Agency design tokens + guidebook palette
- [ ] **Acceptance**: a hand-written dashboard.json renders correctly; schema validates in CI; goldens for 3 sample dashboards

#### M2 — Editor

- [ ] Drag & drop file load, data preview, column typing (F1, F2)
- [ ] Chart builder for the 7 chart types (F3)
- [ ] Guideline nudge engine: `guideline-rules.json` + evaluation + nudge UI with guidebook citations (F4)
- [ ] Grid layout editor (F5)
- [ ] Save / open dashboard.json (F7)
- [ ] **Acceptance**: the 5-minute test — a first-time user (real human, not the author) goes from sample CSV to arranged dashboard in ≤ 5 min without help

#### M3 — Export + publish path

- [ ] Static-site export: self-contained folder, works from `file://` and any static host (F8)
- [ ] Data embedding options: snapshot-inline vs reference-by-URL, chosen per source at export time
- [ ] "How to publish" docs: GitHub Pages, GCS, S3, plain file server — copy-paste level
- [ ] **Acceptance**: exported site renders identically to the editor preview on GitHub Pages and from a local folder, with zero network requests when data is inlined

#### M4 — Polish + release

- [ ] Japanese + English UI (F9); Japanese proofread by a human
- [ ] A11y pass: keyboard navigation, chart data-table fallback, axe clean on editor and exported output
- [ ] 3 sample dashboards (gallery seed) built from public open data
- [ ] Docs: README quickstart, template authoring guide
- [ ] Security review + Codex adversarial review (workspace /develop Phase 6 discipline)
- [ ] **Acceptance**: release checklist passes; time-to-first-dashboard ≤ 5 min re-verified on the release build

### Explicitly NOT in v0.1

Server, auth, DB/API connectors, scheduled refresh, custom themes, plugins, maps, custom SQL editor, collaboration. Requests for these go to the parking lot, not the milestone list.

---

## v0.2 — Templates

**Outcome**: a non-author can start from a template instead of a blank page.

- Template gallery (in-app + repo directory of dashboard.json files)
- "Swap data, keep layout": load a template, replace its data source, columns re-bind by name with a mapping UI for mismatches
- Contribution guide for community templates + CI validation (schema + nudge-rules pass)
- **Why second**: templates are the acquisition flywheel (PRD UC3) — a prefecture makes one, forty municipalities use it. Highest leverage per line of code.

## v0.3 — Embed + print

**Outcome**: a dashboard lives inside other things.

- Embed: script tag / iframe snippet from an exported site; per-chart embed
- Print/PDF layout mode (A4, the medium government reporting actually runs on)
- **Why**: meets P1 users where their outputs go today — web pages and paper.

## v0.4 — CLI / CI

**Outcome**: a developer builds and deploys dashboards without opening a browser.

- `hyakkei build dashboard.json -o dist/` (Node CLI reusing the renderer)
- GitHub Actions example: data lands in repo → dashboard redeploys
- **Why**: makes UC4 (dashboard as code) first-class; P3 developers become distribution.

## v0.5 — Guidebook completion

**Outcome**: everything the guidebook shows, Hyakkei renders.

- Map charts (choropleth) with bundled Japanese municipal boundaries (国土数値情報-derived GeoJSON)
- Remaining chart types (waterfall, etc.) and any guideline rules not yet encoded
- **Exit criterion for the v0.x line**: a side-by-side of guidebook samples vs Hyakkei renders, all matching.

---

## v1.0 — Team + live data

**Outcome**: a team operates dashboards connected to live data sources, safely, behind their own identity provider.

**Scope** (architecture in [ARCHITECTURE.md §7](./ARCHITECTURE.md)):

- Single-container server: serves the app, proxies data-source connections, holds credentials server-side
- Connectors: PostgreSQL, MySQL, BigQuery, generic HTTP API (JSON/CSV) — **four, not forty**
- Scheduled snapshot refresh
- **No built-in login** (ADR-0003): deployment recipes for Cloud Run + IAP, AWS ALB + Cognito, oauth2-proxy for on-prem/other
- Browser-complete mode remains fully supported forever — the server is additive, never required

**Entry criteria** (do not start v1.0 before these):

1. v0.1–v0.3 shipped and stable
2. Demand signal: recurring real-user requests for live data (issues/discussions), not hypothetical
3. Data-access abstraction from M1 has survived v0.x without redesign

**Release criteria**: one real team (not the author) running it behind IAP for 30 days; security review of the proxy layer; connector credential handling audited.

---

## Parking lot (recorded, not planned)

Row-level security / per-viewer data, real-time streaming, alerting, comments/annotations, custom theme builder, plugin API, natural-language chart authoring (LLM), hosted SaaS. Each needs its own WHETHER-before-HOW case before leaving this list.

## Maintenance policy

- `dashboard.json` schema: additive-only within a major version; a breaking change to the schema is what makes a 2.0
- Design-token / guidebook updates: treated as normal releases with visual-regression goldens
- Dependency budget: every new runtime dependency needs a line in the PR explaining why the platform can't do it
