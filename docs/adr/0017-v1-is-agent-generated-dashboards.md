# ADR-0017: v1.0 is agent-generated guidebook-conformant dashboards; the server tier moves to v2.0

- **Status**: Accepted (2026-07-27)
- **Deciders**: yotta
- **Plan**: `.claude/plans/2026-07-27-issue26-mcp-whether-recheck-roadmap-revision.md`
- **Supersedes**: the NO-GO verdict on issue #26 ([comment of 2026-07-16](https://github.com/yottayoshida/hyakkei/issues/26#issuecomment-4990280494)) — see "Why the NO-GO is being overturned" below.

> **Read forward (2026-07-27, later the same day — [#122](https://github.com/yottayoshida/hyakkei/issues/122) / [ADR-0018](./0018-chart-color-roles-follow-the-guidebook-role-layer.md))**: two things this ADR states as measurements have moved. The decisions are unaffected; the numbers and one residual risk are not.
>
> - **Counts.** Context and the Alternatives table quote **7 of 22 guaranteed** and **3 known defects**. Fixing the chart color roles moved that principle from *defect* to *by construction*, so the current figures are **8 guaranteed** and **2 known defects**. `docs/guidebook-coverage.md` remains the single source; these lines are a snapshot of it on the day this ADR was written. Decision 5's *claim form* — "conforms to N of the 22 machine-checkable principles in guidebook version X" — is exactly what makes this survivable: the form did not change, only N.
> - **RR-5 is retired.** It recorded that only two of seven palettes had been verified against the guidebook's role assignment and that the other five were assumed. **All seven reference images have since been retrieved and read.** The assumption did not hold: Green's Secondary is Cyan, a third hue nobody had predicted, and the SolidGray palette has no Neutral row and skips 600 in its Primary ramp. Two further divergences surfaced with it, both deliberately not adopted ([#127](https://github.com/yottayoshida/hyakkei/issues/127) per-palette Error, [#128](https://github.com/yottayoshida/hyakkei/issues/128) Positive/Negative).
>
> Worth stating plainly, because this ADR's own Decision 5 argues for count-based claims on exactly this ground: the risk RR-5 named was real, it materialised within a day, and the count-based claim form absorbed it without any published statement becoming false.

## Context

ROADMAP defined v1.0 as *"a team operates dashboards connected to live data sources, safely, behind their own identity provider"* — a single-container server with PostgreSQL/MySQL/BigQuery/HTTP connectors, scheduled refresh, and platform-delegated auth (ARCHITECTURE §7).

Separately, issue #26 (an MCP server exposing the dashboard spec and guideline rules) had been through a full WHETHER review on 2026-07-16 and returned **NO-GO**, parked with two named defer triggers: real inbound demand, **or** "M2 editor ships AND #13's rules.json reaches v1."

On 2026-07-26 yotta decided to redefine v1.0 around agent-generated dashboards. That decision and the parked NO-GO contradict each other, and the redefinition existed only in a planning file — nothing in the repository reflected it. Writing the ROADMAP change without resolving the contradiction would have left two authoritative records disagreeing.

The second defer trigger had in fact been half-met: `guideline-rules.json` shipped with #13 on 2026-07-25. A re-review was run (architect role performed by the orchestrator after the subagent failed to return; qa-specialist, security-specialist, ux-designer, market-researcher, plus two Codex rounds).

### Why the NO-GO is being overturned

The 2026-07-16 verdict rested on four grounds. Two are dissolved by a shape the original review did not consider, one is mitigated structurally, and one still stands.

**Ground ② — the structural flaw — is dissolved.** The original review framed two possible shapes: (a) return an authoring `dashboard.json`, which a never-install recipient cannot view, or (b) have the LLM emit recharts directly, which cannot carry the guideline guarantee because it bypasses the renderer. "The reachable shape can't be guaranteed; the guaranteed shape can't be reached."

There is a third shape. The MCP receives **rows the caller already holds** plus a chart spec, and returns a baked artifact — `BakedDashboard`, or a self-contained HTML file. `bake()` is already a pure function taking `(document, resolvedRows, meta)` with no DuckDB dependency (`packages/core/src/bake/bake.ts`), and `docs/spikes/single-file-viewer.md` measured the whole baked→view path working over `file://` in all three engines with zero network requests. That spike's own scope correction states the limit precisely: the result holds "only for documents whose rows are already resolved." **Shape (c) satisfies that condition by construction** — resolution never happens inside hyakkei.

**Ground ④ — SQL execution in Node without CSP containment — is dissolved by the same move.** No SQL is executed in the MCP process because no query resolution happens there. Remote data (BigQuery and similar) reaches hyakkei by composition with a separate data MCP, not by hyakkei connecting to anything.

**Ground ③ — solo-maintainer economics — is structurally mitigated.** Making the CLI the core and the MCP a thin adapter means an MCP spec revision breaks the adapter, not the product. Measured CI cost of the additional verification is roughly +1 minute on an 11-minute pipeline if e2e coverage is held to a single spec (E2E is 96% of current wall-clock at 606s; unit is 20s).

**Ground ① — nobody is asking for this — still stands and is not dissolved.** It is addressed by entry criteria rather than by argument (see Decision 6). Worth recording plainly: PRD §3 already states that P1 demand is "a hypothesis, not a fact — knowingly unvalidated," that the validating interviews "will not run," and that M2 proceeds "accepting the unvalidated-demand risk." The same evidence was treated as acceptable for the product's core and as disqualifying for this idea. That asymmetry is real, and the reason it kept producing different answers is that neither decision had a written kill criterion. This ADR adds one.

## Decision

### 1. v1.0's outcome is agent-generated, guidebook-conformant dashboards

An agent (Claude or another MCP/CLI caller) can produce a dashboard that conforms to the Digital Agency guidebook, and hand the result to someone who has none of this software installed.

### 2. The server tier moves to v2.0 unchanged

Connectors, scheduled refresh, and IdP-fronted deployment keep their design (ARCHITECTURE §7) and their entry criteria; only the version label changes. ADR-0001's single permitted forward-provision — the DataSource interface existing so that `ProxySource` is an addition rather than a redesign — still holds; it now points at v2.0. The new v1.0 does not use the DataSource layer at all, because it connects to no data source.

### 3. The CLI is the core; the MCP is an adapter over it

The delivery vehicle is the CLI already on the roadmap as v0.4 (`hyakkei build dashboard.json -o dist/`), with the MCP server as a thin wrapper that accepts rows, writes a temporary file, and invokes the same code path.

This preserves PRD §2.3's first wedge. Data reaching hyakkei through an MCP tool call has necessarily passed through a cloud model's context; data reaching the CLI has not. "Data never leaves the machine" is the property that makes hyakkei the only viable option in a restricted government network, and an MCP-first design forfeits it for the design-target persona. It also confines MCP specification churn to the adapter.

**The CLI does not exist yet** — no package in this repository declares a `bin` entry (verified). "Already on the roadmap" is a statement about design intent, not about shipped code.

### 4. Two delivery channels, not alternatives — but only one is guaranteed on release day

- **A written file** — required. Mail, intranet, shared drive, `file://` double-click; the only channel that reaches someone with no Claude at all, and the only one needing no host cooperation.
- **In-conversation preview** via MCP Apps (`ui://` resource + sandboxed iframe, SEP-1865) — built and conformance-verified in v1.0, but whether it renders depends on a host-side fix this project does not control (Decision 6's transport gate).

They answer different needs and neither replaces the other. The asymmetry is not a ranking: it is the difference between what this project can promise and what it can only prepare for.

Returning the artifact as a tool result is eliminated: 1.22 MiB of minified JS is roughly 370k tokens, and a measurement in Claude Code confirmed a payload that size is spilled to a host-internal file with only a 2 KB preview surviving. It can be returned; nobody receives it.

MCP Apps currently does not render in Claude Desktop, claude.ai, or Claude Code for Web ([`ext-apps#671`](https://github.com/modelcontextprotocol/ext-apps/issues/671), open since 2026-05-27, multiple independent reproductions, and provably host-side: a reporter's static no-JS marker never appeared either). The same servers render correctly in Cowork. **This is a constraint on when the preview lights up, not on what shape to build** — conformance is verifiable today without a working host via `npx mcp-app-debug`, which drives the same App Bridge and double-iframe sandbox path a conformant client uses. Full analysis: `docs/spikes/mcp-transport-gate.md`.

### 5. Conformance is claimed by count, never as "full compliance"

The claim takes the form *"conforms to N of the M machine-checkable principles in guidebook version X; K principles are not machine-checkable; J are not yet covered."* A public "fully conformant to the Digital Agency guidebook" claim is not made.

An inventory of the guidebook (PDF v02, all 59 pages, cross-checked against the official 27-item checklist — 44% vs 46% machine-checkable, consistent) found **22 machine-checkable principles. Three are addressed by a named rule, and only one of those has a runtime predicate.** (Counting the guarantee a user actually gets — rule-enforced *or* impossible to violate — gives seven, and that is the figure worth quoting; `docs/guidebook-coverage.md` states which reading applies where, because the same implementation is defensibly 1, 3, or 7 depending on the question.) Four principles need a new schema field before they can be satisfied at all ([#124](https://github.com/yottayoshida/hyakkei/issues/124)). Three confirmed conformance defects exist today: chart color roles ([#122](https://github.com/yottayoshida/hyakkei/issues/122), evidence in `docs/spikes/guidebook-color-roles.md`), plus an unsourced rule threshold and an unverified vertical grid constraint ([#123](https://github.com/yottayoshida/hyakkei/issues/123)).

Beyond the accuracy problem: an unofficial project claiming full conformance to a government design system amplifies the trademark/affiliation-confusion risk PRD §8 already tracks. And a count-based claim survives guidebook revisions, which a "full compliance" claim does not — the guidebook's own color codes changed on 2026-07-17.

### 6. Entry and kill criteria are written before the work starts

Two gates, with different consequences, because they fail for different reasons:

| Gate | Test | Consequence of failure |
| --- | --- | --- |
| **Transport** | `mcp-app-debug` green (hyakkei's own spec conformance — **not** whether a host renders it), and file output produced at a caller-independent path | Conformance failing means the App is built wrong and gets fixed. File output failing too reverts the whole lane to NO-GO. The host bug is neither case: it is unfixable from here and therefore never a gate |
| **Demand** | Signals from outside this project, within a window set when the Skill ships (see note) | **Drop the MCP from v1.0 entirely** — CLI alone becomes v1.0 |

The demand gate is tested before the expensive work, not after: publish the rules and tokens as a **Claude Skill** first — no npm publishing lane, no spec-tracking lane, near-zero cost. If a free Skill draws no response, an MCP server will not either. This is the demand test that has never actually been run.

`ProxySource`'s "recurring real-user requests for live data, not hypothetical" entry criterion travels with the server tier to v2.0.

### 7. Rules whose violations the schema cannot express stay `doc-only`

`truncated-axis`, `palette-order`, and `3d-anything` remain `status: "doc-only"` and are documented as **enforced by construction**, not as unimplemented.

Making them active would require first adding the fields that let a user commit the violation — a `ChartOptions.yAxisMin` equivalent, per-series color control. "You cannot draw a truncated axis" is a stronger guarantee than "we warn you when you draw one," and a warning is reproducible by any general-purpose model with a prompt, so it is not a differentiator either. `3d-anything` would additionally be permanently vacuous: `ChartVariant` has no 3D variant to fire against.

Schema extension is scoped to the **Do-side** principles the guidebook requires and the schema cannot currently express — `altText`, summary text, `updatedAt`, and `sourceNote`. All four are additive. (Two more were on this list during the review and came off it: `decal` turned out to be implemented already — `build-options.ts` sets `aria.decal.show` unconditionally — and the vertical grid constraint would *narrow* an existing field rather than add one, making it a breaking change that needs its prior question settled first.) These fail in the opposite direction: not "a violation cannot be written" but "the requirement cannot be met." That distinction is the whole basis for extending in one case and not the other.

## Alternatives considered

| Option | Rejected because |
| --- | --- |
| MCP server as v1.0's core, CLI later or never | Every dashboard's data would pass through a cloud model's context, forfeiting PRD §2.3's first wedge and excluding the P1 design target (municipal staff on restricted networks) by construction. This redefines who the product is for, which is a larger change than it appears |
| Keep "full guidebook compliance" as the v1.0 claim | Contradicted by measurement (7 of 22 guaranteed, only 3 from named rules, 1 with a runtime predicate, 4 requiring a schema field that does not exist, 3 known defects); amplifies PRD §8's trademark/affiliation risk; breaks on the next guidebook revision |
| Activate all four guideline rules | Two would require making the violations expressible first — a net loss of guarantee. One is permanently vacuous. One misfires against this project's own reference dashboards under the current (incorrect) color-role model |
| Leave issue #26 parked | A named defer trigger was half-met, and the shape that dissolves grounds ② and ④ was not considered in the original review. Continuing to park it on grounds that no longer hold would be as much a records defect as overwriting the NO-GO silently |
| Return the artifact as a tool result | ~370k tokens; measured to be spilled to a host-internal path the user cannot reach |
| Serve ECharts from a CDN to shrink the artifact | Destroys the zero-network `file://` property the artifact exists to provide |

## Residual risks (accepted)

- **RR-1 — Demand is still unvalidated.** Ground ① was never dissolved, only deferred to the demand gate. If the Claude Skill draws nothing, the MCP lane is dropped. This ADR does not argue the demand exists; it makes the absence of evidence actionable.
- **RR-2 — The in-conversation preview may stay dark through v1.0.** `ext-apps#671` is host-side; hyakkei cannot fix it and cannot schedule it. v1.0 may ship with the App implemented and conformance-verified but not rendering in the primary hosts.
- **RR-3 — Redefining v1.0 pulls M3 and v0.5 into it.** The single-file packaging that shape (c) returns *is* M3's deliverable (`packages/export` is a placeholder today), and "guidebook-conformant" is v0.5's outcome nearly verbatim. Changing one outcome sentence moves two milestones' worth of content. ROADMAP states this explicitly rather than letting v1.0 read as a small addition.
- **RR-4 — the new v1.0 has one metric, and it is a gate rather than a measure of success.** Two of PRD §7's targets were pinned to the old v1.0 ("1,000 GitHub stars"; "3 municipalities or organizations running it in the wild — the metric that actually matters"); both were re-pointed at v2.0 in this change, since re-aiming them at the new v1.0 would have silently changed what they measure. The new v1.0's own row is the Claude Skill demand gate — which decides whether part of the version ships, and says nothing about whether it succeeded once shipped. **There is currently no way to tell whether an agent-generated dashboard was any good**: no telemetry by principle 4, and a generated file leaves no trace to count. Living with that is a choice, not an oversight, but it means v1.0 cannot be judged the way v0.1 or v2.0 can.
- **RR-5 — Only two of seven palettes were verified** against the guidebook's role assignment. Blue→Yellow and Cyan→Green are confirmed by direct reading; the other five are assumed to follow the same per-palette structure but were not checked.

## Consequences

- ROADMAP's v1.0 section is rewritten and the former v1.0 becomes v2.0, carrying its entry and release criteria unchanged. The parking-lot entry "natural-language chart authoring (LLM)" leaves the lot and connects to v1.0.
- ROADMAP's own rule — "every version is defined by a user outcome, not a feature list… the outcomes are stable; the sequence is not" — is being applied to the side it declared stable. The scope-creep firewall protects against features accreting into a version; it does not protect against an outcome being rewritten. That gap is now on the record.
- PRD §6.4, PRD UC5, README's version list, and ARCHITECTURE §7 follow. Five ADRs carry v1.0 assumptions (0001, 0003, 0005, 0006, 0007) and get read-forward notes; 0007 and 0003 have the most references.
- `docs/guidebook-coverage.md` becomes the canonical inventory: 22 machine-checkable principles against hyakkei's handling of each, with a dated human attestation line. The unanswerable question ("have we covered the guidebook?") is replaced by a checkable one ("does the inventory match the code?").
- The correct source for chart color *roles* is the guidebook's "カラーパレットの使い方" page, not `@digital-go-jp/design-tokens`. ADR-0006's principle stands; its scope narrows to primitive hex values. PRD §6.1 F6 and ROADMAP's M0 note need the same correction (`docs/spikes/guidebook-color-roles.md`).
