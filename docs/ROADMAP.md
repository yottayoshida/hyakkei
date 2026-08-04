# Hyakkei — Roadmap

- **Status**: Draft v1 (2026-07-04, amended 2026-07-05, amended 2026-07-27)
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
| **v1.0** | An agent produces a guidebook-conformant dashboard, and the recipient can open it with none of this software installed. |
| **v2.0** | A team operates dashboards on live data, safely, behind their own identity provider. |

Versions v0.2–v0.5 are the current best guess at ordering; feedback after v0.1 may reorder them. The **outcomes** are stable; the **sequence** is not.

> **Amendment (2026-07-27, ADR-0017)**: v1.0's outcome was rewritten and the former v1.0 (server tier, connectors, IdP-fronted deployment) became v2.0 with its scope and entry criteria unchanged.
>
> Note what this amendment did to the rule directly above it. The scope-creep firewall protects a version from accreting features; it does not protect an **outcome** from being rewritten, and rewriting one moves scope with it. Concretely: shape (c) — the MCP/CLI returning a self-contained HTML — *is* M3's bake-and-package deliverable, and "guidebook-conformant" is close to v0.5's outcome verbatim. **Redefining v1.0 pulled content from both M3 and v0.5 into it.** That is stated here rather than left for a reader to discover, because v1.0 otherwise reads like a small addition on top of v0.5 when it is not.

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

- [x] Chart library: **done 2026-07-10** (issue #4, `docs/spikes/m0-charts.md`). ECharts 6.1.0 SVG renderer confirmed: byte-exact hex fidelity across all 7 key colors × 2 appearances, functional ARIA/decal, 0 residual WCAG contrast failures, acceptable performance. Palette structure confirmed as 7 key-color templates (Solid Gray/Blue/Light Blue/Cyan/Green/Orange/Red), each a 6-step ramp + shared Yellow accent + Semantic Success/Error — neither the old "7-color categorical" nor "single-hue ramp + red accent" framing was correct (PRD F6, corrected). ~~**The Cyan/Green mutual-accent open point is resolved as moot, not confirmed either way** (PR-A, 2026-07-11): `palette.ts` consumes `@digital-go-jp/design-tokens` directly (ADR-0006 amendment) rather than a hand-transcribed re-derivation, and that package's actual structure has no data encoding "Cyan and Green accent each other" — each `Color.Primitive` family is independent, and only `Color.Primitive.Yellow` functions as a shared categorical accent across every palette. There was nothing to visually confirm against a structure the authoritative source doesn't have; a single shared Yellow accent is used for all 7 palettes.~~ **Retracted 2026-07-27** — the accent question was not moot; the role layer simply is not in the token package. The guidebook's own [カラーパレットの使い方](https://www.digital.go.jp/resources/dashboard-guidebook/color-palette) page publishes a per-palette Primary/Secondary/Neutral assignment, verified by direct reading of the official reference images: **Blue's Secondary is Yellow, Cyan's Secondary is Green** — a different hue with its own three-step ramp. ADR-0006's "consume the authoritative source directly" principle stands; what was wrong is which source is authoritative for *roles* versus for *primitive hex values*. **Fixed 2026-07-27** ([ADR-0018](adr/0018-chart-color-roles-follow-the-guidebook-role-layer.md)), and narrower than this note first claimed: the mis-mapped field was `accent` (Yellow-fixed across all seven), not the same-hue second step, which the official template does use for category 2. All seven palettes are now verified — Secondary takes three hues, and `Neutral` exists as a role. See the dated correction at the top of `docs/spikes/guidebook-color-roles.md`. ADR-0004's chart-library row is now Accepted; the Vega-Lite escape hatch did not trigger.
- [ ] CORS reality check: attempt a browser `fetch` against real Google published-CSV URLs and a few Japanese open-data CSV endpoints; if most fail, downgrade `UrlSource`'s F1 framing to "CORS-permitting" rather than a reliable path
- [ ] Test infrastructure decision: DuckDB-WASM does not run under jsdom — decide how the query layer is tested (Playwright / Vitest browser mode) before M1's test suite is built

#### M1 — Dashboard spec + rendering core

The contract everything else builds on — **two schemas now, not one** (ADR-0005): the authoring `dashboard.json` and the exported `BakedDashboard`. Both are first-class, both pinned with published JSON Schemas and round-trip tests; neither is an implementation detail decided later.

- [ ] `dashboard.json` schema v1 (authoring): metadata, data-source refs, queries, chart specs, grid layout (JSON Schema published in-repo)
- [ ] `BakedDashboard` schema v1 (export/view): metadata incl. `sourceDataAsOf`, theme, charts with pre-computed rows, grid layout — no sources, no queries (ADR-0005)
- [ ] `bake(document, resolvedTables) → BakedDashboard`: the pure function that produces the latter from the former; lives in `packages/core`
- [ ] Data-access abstraction: one interface, two implementations (local file, fetched URL), **editor/export-time only — never present in a viewer**. This is the only forward-provision allowed in v0.1, and it points at **v2.0**'s `ProxySource` — see ADR-0001 (the target was labelled v1.0 until the 2026-07-27 renumbering; the provision itself is unchanged, and the new v1.0 does not use this layer at all)
- [ ] Renderer: accepts either the authoring document (editor preview, with live query results) or a `BakedDashboard` (viewer, CLI output) → laid-out themed dashboard through the same layout/theme code path
- [ ] Theme layer consuming Digital Agency design tokens + a guidebook color theme — **theme-color resolution done 2026-07-11** (issue #9 PR-A, `packages/core/src/theme/`): consumes `@digital-go-jp/design-tokens@2.0.1`'s `Color.Primitive`/`Color.Neutral`/`Color.Semantic` directly (ADR-0006 amended — design-tokens does carry chart-capable color ramps, correcting an earlier finding), not a hand-transcribed re-derivation. Box stays unchecked pending Renderer/bake (PR-B) and goldens (PR-C), which this bullet's acceptance also covers
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

> **Also a v1.0 prerequisite (2026-07-27, ADR-0017).** The self-contained HTML that v1.0's CLI and MCP adapter return *is* this milestone's single-file deliverable — v1.0 consumes it rather than reimplementing it, so M3 is upstream of v1.0, not parallel to it. `docs/spikes/single-file-viewer.md` already proved the recipe end to end (real `bake()` + esbuild IIFE + JSON island, three engines, zero network requests) and put productization at roughly a 70-line build script. `packages/export` is still a placeholder.

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

> **Promoted into v1.0 (2026-07-27, ADR-0017).** This CLI is v1.0's core, with the MCP server as a thin adapter over it. The reason it is the core rather than the MCP: data handed to a CLI stays on the machine, data handed to an MCP tool has passed through a cloud model's context. That difference is PRD §2.3's first wedge. Nothing in this entry's scope changed — it is simply needed earlier than the v0.4 slot suggests. **No `bin` entry exists in any package today**; this remains intent, not shipped code.

## v0.5 — Guidebook completion

**Outcome**: everything the guidebook shows, Hyakkei renders.

- Map charts (choropleth) with bundled Japanese municipal boundaries (国土数値情報-derived GeoJSON)
- Remaining chart types (waterfall, etc.) and any guideline rules not yet encoded
- **Exit criterion for the v0.x line**: a side-by-side of guidebook samples vs Hyakkei renders, all matching.

> **Partly absorbed into v1.0 (2026-07-27, ADR-0017)**, and **now measurable for the first time**. A full inventory of the guidebook (PDF v02, all 59 pages, cross-checked against the official 27-item checklist) found **22 machine-checkable principles**. **9** are guaranteed in practice (rule-enforced or impossible to violate — 7 at the time of the inventory, 8 on 2026-07-27 when [#122](https://github.com/yottayoshida/hyakkei/issues/122) fixed the chart color roles, 9 on 2026-07-29 when [#123](https://github.com/yottayoshida/hyakkei/issues/123) found that the layout principle had been misread and was already satisfied); of those, three come from a named rule and one has a runtime predicate. So this outcome sits somewhere in 1–9 of 22 depending on which question is asked — a range, but a knowable one, where before it was an unknown fraction. `docs/guidebook-coverage.md` says which reading applies where. One of the remaining principles needs a new schema field before it can be satisfied at all ([#124](https://github.com/yottayoshida/hyakkei/issues/124)); that subset is v1.0's schema work, and three of its original four landed on 2026-08-02 (`meta.updatedAt` / `sourceNote` / `summary`, drawn by the dashboard footer — [ADR-0019](adr/0019-guidebook-do-side-fields-and-dashboard-chrome.md)), leaving `Chart.altText`. The rest, plus maps and the remaining chart types, stay here. `docs/guidebook-coverage.md` is the canonical inventory. **Three conformance defects were found during the same inventory** ([#122](https://github.com/yottayoshida/hyakkei/issues/122), [#123](https://github.com/yottayoshida/hyakkei/issues/123)) — they were hyakkei's own bugs and independent of any version's scope. **All three are now resolved**: #122 fixed the color roles on 2026-07-27 ([ADR-0018](adr/0018-chart-color-roles-follow-the-guidebook-role-layer.md)); #123 on 2026-07-29 disclosed that the pie threshold is hyakkei's own and corrected every rule citation, and established that the 16:9 vertical grid was never a requirement in the first place. Two qualifiers survive the zero and are recorded with it in the coverage file: the one runtime rule checks a threshold hyakkei chose, and the rule engine fails open.
>
> An outcome stated as a sentence ("everything the guidebook shows, Hyakkei renders") had no denominator for a year. It has one now.

---

## v1.0 — Agent-generated, guidebook-conformant dashboards

**Outcome**: an agent produces a dashboard that conforms to the Digital Agency guidebook, and the recipient can open it with none of this software installed.

Full rationale, including why the former v1.0 moved to v2.0 and why the MCP idea's 2026-07-16 NO-GO was overturned: [ADR-0017](./adr/0017-v1-is-agent-generated-dashboards.md).

**Scope**:

- **A CLI is the core** — `hyakkei build dashboard.json -o dist/`, the v0.4 entry below, promoted to v1.0's delivery vehicle. Data handed to the CLI never passes through a cloud model's context, which is what keeps [PRD §2.3](./PRD.md)'s first wedge intact for restricted-network users
- **An MCP server is a thin adapter over it** — accepts rows the caller already holds plus a chart spec, writes a temporary file, invokes the same code path. hyakkei connects to no data source; remote data (BigQuery and similar) arrives by composition with a separate data MCP. Confining the MCP to an adapter also confines MCP specification churn to the adapter
- **Two delivery channels, asymmetric in status**: a **written file is required** — mail, intranet, shared drive, `file://` double-click, and the only channel reaching someone with no Claude at all. An **in-conversation preview via MCP Apps** (`ui://` + sandboxed iframe; the official `io.modelcontextprotocol/ui` extension, formerly SEP-1865) is the target and is built and conformance-verified in v1.0, but its lighting up depends on a host-side fix outside this project (see the transport gate below). They serve different people and neither substitutes for the other — the asymmetry is about what this project can guarantee on release day, not about which matters
- **Bake-and-package** (M3 below) is a prerequisite, not a parallel track — the self-contained HTML the MCP returns is exactly M3's deliverable
- **Guidebook conformance stated by count**, never as "full compliance": *"conforms to N of the M machine-checkable principles in guidebook version X; K are not machine-checkable; J are not yet covered."* [docs/guidebook-coverage.md](./guidebook-coverage.md) is the canonical inventory
- **Schema extension is limited to Do-side principles** the guidebook requires and the schema cannot express: `altText`, summary text, `updatedAt`, `sourceNote` — four additive fields, of which three landed on 2026-08-02 ([ADR-0019](adr/0019-guidebook-do-side-fields-and-dashboard-chrome.md)) leaving `Chart.altText`. Rules whose *violations* the schema cannot express stay `doc-only` and are documented as enforced by construction — see ADR-0017 Decision 7

**Two things this scope depends on that do not exist yet**, stated plainly so v1.0 is not read as a small delta:

- The CLI is roadmap intent, not shipped code — **no package declares a `bin` entry today**
- `packages/export` is a placeholder; M3's packaging is unwritten

**Entry criteria** (do not start v1.0 before these):

1. M2 acceptance passes and M3 ships — v1.0 consumes M3's output rather than reimplementing it
2. **Transport gate**: `npx mcp-app-debug` green against the MCP server, and file output produced at a path the caller does not choose.

   Be precise about what the tool measures: **`mcp-app-debug` verifies hyakkei's own spec conformance, not that any host renders the result.** It drives the same App Bridge and double-iframe sandbox path a conformant client uses, so it goes green while `ext-apps#671` is still open. That is the point — it is the half of the problem this project controls.

   Failing conformance means the MCP App is not correctly built and must be fixed. Failing file output too reverts this whole lane to NO-GO. **Neither failure is the host bug**, which is tracked separately below and cannot be gated on
3. **Demand gate**: publish the guideline rules and design tokens as a **Claude Skill first** — no npm publishing lane, no spec-tracking lane, near-zero maintenance cost — and observe whether anyone outside this project responds. A free Skill drawing no response predicts an MCP server drawing none. This is the demand test that has never actually been run.

   **The observation window is not set here, deliberately.** It depends on when the Skill actually ships, and picking a number now would be inventing one. Set it in the same change that publishes the Skill. Until then this gate cannot fire in either direction — a known state, not an oversight, and the reason it is called out rather than left blank is that a gate with an unstated window is indistinguishable from no gate at all
4. `docs/guidebook-coverage.md` exists and the Do-side schema plan is complete, so the N in the conformance claim is a real number

**Kill criteria** (written before the work, per ADR-0017 Decision 6 — the previous two rounds of this decision had none, which is why the same question kept producing different answers):

- Demand gate returns nothing within its window → **the MCP leaves v1.0 entirely**; the CLI alone is v1.0. (The window itself is set when the Skill ships — see the entry criteria above.)
- Transport gate fails on both channels → the lane reverts to NO-GO and this section is rewritten

**Release criteria**: a dashboard generated end-to-end by an agent, opened by someone with nothing installed; the conformance count backed by `docs/guidebook-coverage.md` with a dated human attestation; `mcp-app-debug` green in CI — meaning **hyakkei's App is spec-conformant**, which is required. **A host actually rendering it is not a release criterion**, because no amount of work here can produce it.

**Known constraint** (written 2026-07-27, updated 2026-08-02): MCP Apps does not reliably render in Claude Desktop, claude.ai, or Claude Code for Web, while the same servers render in Cowork. v1.0 may therefore ship with the App implemented and conformance-verified but the preview dark. That determines whether a feature is lit on release day, not whether the shape is right. Two things about it have moved since it was written:

- **Track [`anthropics/claude-ai-mcp#165`](https://github.com/anthropics/claude-ai-mcp/issues/165), not [`ext-apps#671`](https://github.com/modelcontextprotocol/ext-apps/issues/671).** `#671` lives in the spec and SDK repository; on 2026-07-31 its most active investigator stated that triage for a host rendering bug does not happen there and moved the writeup. `#671` is still open and may stay open regardless of whether the host is ever fixed, so a re-test trigger phrased as "when #671 closes" can never fire.
- **"Host-side and unfixable from here" is now too broad.** A wrong `_meta.ui.domain` produces the same visible symptom entirely server-side and is reliably fatal (0 of 8 renders in a 2026-07-31 measurement), while omitting the field is harmless to mounting. Getting that value right is hyakkei's responsibility, not the host's.

See `docs/spikes/mcp-transport-gate.md`, and read its 2026-08-02 amendment first — it also records what protocol revision `2026-07-28` changes for the adapter.

---

## v2.0 — Team + live data

**Outcome**: a team operates dashboards connected to live data sources, safely, behind their own identity provider.

*Formerly v1.0; renumbered 2026-07-27 by ADR-0017 with scope and criteria unchanged. ADR-0001's single permitted forward-provision — the DataSource interface existing so `ProxySource` is an addition rather than a redesign — now points here.*

**Scope** (architecture in [ARCHITECTURE.md §7](./ARCHITECTURE.md)):

- Single-container server: serves the app, proxies data-source connections, holds credentials server-side
- Connectors: PostgreSQL, MySQL, BigQuery, generic HTTP API (JSON/CSV) — **four, not forty**
- Scheduled snapshot refresh
- **No built-in login** (ADR-0003): deployment recipes for Cloud Run + IAP, AWS ALB + Cognito, oauth2-proxy for on-prem/other
- Browser-complete mode remains fully supported forever — the server is additive, never required

**Entry criteria** (do not start v2.0 before these):

1. v0.1–v0.3 shipped and stable
2. Demand signal: recurring real-user requests for live data (issues/discussions), not hypothetical
3. Data-access abstraction from M1 has survived v0.x without redesign

**Release criteria**: one real team (not the author) running it behind IAP for 30 days; security review of the proxy layer; connector credential handling audited.

---

## Parking lot (recorded, not planned)

Row-level security / per-viewer data, real-time streaming, alerting, comments/annotations, custom theme builder, plugin API, hosted SaaS. Each needs its own WHETHER-before-HOW case before leaving this list.

*Left the lot 2026-07-27*: **natural-language chart authoring (LLM)** — became v1.0's outcome via ADR-0017, after a WHETHER review (issue #26) that returned NO-GO on 2026-07-16 and was re-run when a named defer trigger was met. The exit went through the process this section requires; the record of both the NO-GO and its reversal is in ADR-0017 and on the issue.

## Maintenance policy

- `dashboard.json` schema: additive-only within a major version. **A breaking schema change is what would force a new schema major version** — this is about `"version": 1` in the document, not about the product's version number. (Before 2026-07-27 this line read "…is what makes a 2.0," which now collides with the v2.0 section above: that renumbering was a scope move, not a schema break. The schema is still at v1 and additive-only.) v1.0's Do-side additions — `altText`, summary text, `updatedAt`, `sourceNote` — are all additive and keep `"version": 1`; three of the four shipped on 2026-08-02 as optional `meta` fields ([#124](https://github.com/yottayoshida/hyakkei/issues/124), [ADR-0019](adr/0019-guidebook-do-side-fields-and-dashboard-chrome.md)), and `baked.test.ts` now pins `BakedMeta` against `BaseMeta` so the hand-duplication between them cannot drift unnoticed. (Until 2026-07-29 this line went on to cite a vertical grid constraint as the one guidebook item that would *not* be additive, excluded from v1.0 for that reason. [#123](https://github.com/yottayoshida/hyakkei/issues/123) found the guidebook never asked for it — p51 describes what its grid affords, not a division a layout must adopt — so there is no such item, and the narrowing of `LayoutItem.y`/`h` it referred to is not owed. The additive-only policy above is unaffected.)
- Design-token / guidebook updates: treated as normal releases with visual-regression goldens
- Dependency budget: every new runtime dependency needs a line in the PR explaining why the platform can't do it
