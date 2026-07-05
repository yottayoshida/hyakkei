# Hyakkei — Roadmap

- **Status**: Draft v1 (2026-07-04, amended 2026-07-05)
- **Rule**: every version is defined by a **user outcome**, not a feature list. A feature ships in a version only if it serves that version's outcome. This is the scope-creep firewall.

## Amendment (2026-07-05)

Following ADR-0005 (pre-computed export), the M0 checklist below is restructured into **must-complete** (go/no-go for the architecture) vs. **time-permitting** (can slip into M1's first days) items — the original flat list under-scoped a 1-week timebox once SQL-containment and export-artifact verification were added. M1 gains the `BakedDashboard` schema as a co-deliverable alongside the authoring schema. M3's "snapshot vs URL ref" framing is retired — see ADR-0005 for why and its replacement (single-file vs folder packaging).

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

De-risk the biggest unknowns before committing to the architecture. **Must-complete** items gate the M0 go/no-go decision; **time-permitting** items may slip into M1's first days without blocking the gate.

**Must-complete:**

- [ ] DuckDB-WASM (**single-threaded build** — `file://`/static hosts can't set COOP/COEP, so this is the build that actually ships in the editor unless self-hosted with isolation headers): load a 100 MB CSV in Chrome/Firefox/Safari; measure load time, memory, bundle size impact; confirm OOM produces a user-facing error, not a silent crash
- [ ] Excel parsing: fidelity test for **ExcelJS** (default candidate, ADR-0004 Amendment) on 10 realistic messy Japanese workbooks (merged headers, 和暦, full-width digits, Shift_JIS/BOM CSVs); fall back to SheetJS CE only with a vendoring plan if ExcelJS fails
- [ ] **SQL/network containment proof**: with the chosen CSP (`connect-src`) and DuckDB configuration flags in place, confirm a crafted `SELECT ... FROM 'https://...'` and `INSTALL`/`LOAD` actually fail in the WASM build, and produce zero network requests — do not trust documented flag behavior without an empirical check (Security SR-1)
- [ ] **Export artifact verification**: build a throwaway single-file HTML export (baked data inlined, no DuckDB) and confirm it opens via `file://` double-click and from an SMB/shared-folder path, in Chrome, Firefox, and Safari
- [ ] **Acceptance (must-complete gate)**: the four items above pass. Recorded as a go/no-go decision in `docs/spikes/m0-summary.md`, which also re-baselines the implementation plan.

**Time-permitting** (may continue into M1 without blocking the gate):

- [ ] Chart library: render the guidebook's sample charts pixel-faithfully in ECharts, including a contrast check on the red accent color; confirm the actual palette semantics (single-hue ramp + red per theme, not multi-hue categorical — PRD F6) against the guidebook PDF before M1 locks the `palette-order` nudge rule; if ECharts is blocked, evaluate Vega-Lite and amend ADR-0004
- [ ] CORS reality check: attempt a browser `fetch` against real Google published-CSV URLs and a few Japanese open-data CSV endpoints; if most fail, downgrade `UrlSource`'s F1 framing to "CORS-permitting" rather than a reliable path
- [ ] Test infrastructure decision: DuckDB-WASM does not run under jsdom — decide how the query layer is tested (Playwright / Vitest browser mode) before M1's test suite is built

#### M1 — Dashboard spec + rendering core

The contract everything else builds on — **two schemas now, not one** (ADR-0005): the authoring `dashboard.json` and the exported `BakedDashboard`. Both are first-class, both pinned with published JSON Schemas and round-trip tests; neither is an implementation detail decided later.

- [ ] `dashboard.json` schema v1 (authoring): metadata, data-source refs, queries, chart specs, grid layout (JSON Schema published in-repo)
- [ ] `BakedDashboard` schema v1 (export/view): metadata incl. `sourceDataAsOf`, theme, charts with pre-computed rows, grid layout — no sources, no queries (ADR-0005)
- [ ] `bake(document, resolvedTables) → BakedDashboard`: the pure function that produces the latter from the former; lives in `packages/core`
- [ ] Data-access abstraction: one interface, two implementations (local file, fetched URL), **editor/export-time only — never present in a viewer**. This is the only v1.0 forward-provision allowed in v0.1 — see ADR-0001
- [ ] Renderer: accepts either the authoring document (editor preview, with live query results) or a `BakedDashboard` (viewer, CLI output) → laid-out themed dashboard through the same layout/theme code path
- [ ] Theme layer consuming Digital Agency design tokens + a guidebook color theme (re-derived values, not the source theme JSON verbatim — ADR-0006)
- [ ] **Acceptance**: a hand-written `dashboard.json` renders correctly in the editor preview; `bake()` on that same document produces a `BakedDashboard` that the Renderer renders identically; both schemas validate in CI; goldens for 3 sample dashboards. This is also where the M0-throwaway component pipeline (issue #5) gets its full, production-quality re-confirmation (issue #10) — the M0 demo was deliberately partial.

#### M2 — Editor

- [ ] Drag & drop file load, data preview, column typing (F1, F2)
- [ ] Chart builder for the 7 chart types (F3)
- [ ] Guideline nudge engine: `guideline-rules.json` + evaluation + nudge UI with guidebook citations (F4)
- [ ] Grid layout editor (F5)
- [ ] Save / open dashboard.json (F7)
- [ ] **Acceptance**: the 5-minute test — a first-time user (real human, not the author) goes from sample CSV to arranged dashboard in ≤ 5 min without help

#### M3 — Export + publish path

- [ ] Bake-then-package pipeline: `bake()` (M1) → package as **single self-contained HTML file (default)** or **folder (advanced)** (F8, ADR-0005). No per-source snapshot/URL-ref choice — that axis no longer exists once sources stop traveling into the viewer
- [ ] Size-triggered fallback: if a `BakedDashboard` (e.g. a large `table`/`scatter` chart) would make a single-file export impractically large, fall back to folder packaging automatically or prompt the user (tracked as a risk in the implementation plan)
- [ ] "How to publish" docs: GitHub Pages, GCS, S3, plain file server, and "just double-click it" — copy-paste level
- [ ] **Acceptance**: exported output (either packaging mode) renders identically to the editor preview; single-file export opens via `file://` double-click in Chrome/Firefox/Safari making **literally zero network requests**; folder export makes only its two same-origin relative-path requests (`renderer.js`, `dashboard.json`), never a third-party one

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
