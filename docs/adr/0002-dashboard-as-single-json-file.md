# ADR-0002: A dashboard is a single declarative JSON file

- **Status**: Accepted (2026-07-04, amended 2026-07-05)
- **Deciders**: yotta

## Amendment (2026-07-05)

Two phrases below predate ADR-0005 and are corrected in place: "one execution path in the renderer" (Decision) described a renderer that ran SQL wherever it was invoked, including in a viewer — that is no longer the design. And "data snapshots... only when the user opts to embed them" (Alternatives Considered #2) described embedding raw data *into the authoring file* for a viewer to later query — superseded by `BakedDashboard`, a separate export-time artifact (ADR-0005), not a field inside `dashboard.json`.

## Context

Hyakkei's distribution thesis (PRD UC3) is templates: one prefecture builds a dashboard, forty municipalities reuse it. That requires dashboards to be portable artifacts, not rows in an app database. Developers (P3) additionally want Git-reviewable dashboards.

## Decision

The unit of a dashboard is one `dashboard.json` file: metadata, theme reference, data-source references, SQL queries, chart specs, grid layout. The GUI editor is a view over this document — everything the editor can do round-trips through the file. A published JSON Schema versions the format; changes are additive-only within a major version, and unknown fields survive round-trips.

Queries are stored as SQL strings even though the v0.1 UI is GUI-only (the GUI generates SQL): one execution path in the **editor's** query engine (never a viewer's — ADR-0005), an escape hatch for developers, and headroom beyond what the GUI can express.

## Alternatives considered

1. **Opaque app state (IndexedDB/localStorage) with export as an afterthought** — rejected: kills templates, Git workflows, and CLI; couples users to one browser profile.
2. **Multiple files (layout + queries + data manifest)** — rejected for the *authoring* file: "send someone a template" must be one attachment (ADR-0005's authoring/export distinction is a separate, later decision about the *export*, not about this file).
3. **Code-based dashboards (JSX/Markdown like Evidence/Observable)** — rejected for the core: P1 users don't write code. The JSON is machine-writable, so a code layer can be built *on top* later.

## Consequences

- (+) Templates are "here's a JSON file". Git diff/review works. CLI (v0.4) and CI validation are trivial. The schema, not the app, is the stable public contract.
- (+) Third parties can generate dashboards programmatically (including LLMs) without touching our code.
- (−) Schema design quality becomes load-bearing; mistakes are expensive after v0.1. Mitigation: schema is an explicit M1 deliverable with review, not an emergent artifact.
- (−) Some editor features must be constrained to what serializes cleanly. Accepted: that constraint is the feature.
