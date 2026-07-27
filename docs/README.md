# Hyakkei design docs — start here

New to the project? Read in this order:

1. **[PRD.md](./PRD.md)** — *why* this exists and *for whom*. Problem, users, scope, non-goals, risks. If you read one document, read this.
2. **[ROADMAP.md](./ROADMAP.md)** — *what* to build and *in what order*. Every version is defined by a user outcome; v0.1 is broken into milestones M0–M4, each with an acceptance check.

   **"What should I work on?" is answered by the open issues, not by the checkboxes.** The M0–M2 boxes are stale — 20 of them are unchecked, and most are done (see Current status below). Closing an issue has never been paired with returning to tick its box, so the boxes record what was *planned*, not what remains. Treat them as the milestone's scope statement and GitHub issues as its state. Ticking them retroactively would need each one verified against the code, which is worth doing but is its own task.
3. **[ARCHITECTURE.md](./ARCHITECTURE.md)** — *how* it's built. Component boundaries, the `dashboard.json` document, data flow, security model, testing strategy, repo layout.
4. **[adr/](./adr/)** — *why it's built that way*. One file per irreversible decision, with the alternatives that were rejected and why. Read these before proposing to change something fundamental — the answer to "why don't we just add login?" is [ADR-0003](./adr/0003-authentication-outside-the-app.md); the answer to "why does the viewer need DuckDB-WASM?" is [ADR-0005](./adr/0005-precomputed-export.md) (it doesn't).

## Rules that keep these docs useful

- **Outcome over features**: a feature belongs in a version only if it serves that version's outcome sentence (ROADMAP). If it doesn't, it goes to the parking lot.
- **Boundaries need ADRs**: implementation details may drift from ARCHITECTURE.md freely; component *boundaries* and anything listed in an ADR may only change with a new or amended ADR.
- **Docs change by PR** like code. If reality and docs disagree, fix one of them in the same PR that created the disagreement.

## Current status

*Last reconciled 2026-07-27. This line had been stale since 2026-07-05 — a reminder that the "fix docs in the same PR" rule above works for text adjacent to a change and not for a whole-repo summary that belongs to no one's diff.*

**M0 and M1 are done. M2 is nearly done.** The feasibility spikes closed (DuckDB-WASM single-threaded, ExcelJS fidelity, SQL/network containment — `docs/spikes/`), both schemas and the renderer core shipped, and the editor now has file intake, column typing, a query builder, a chart builder for all 7 types, a grid layout editor, the guideline nudge engine, and save-to-`dashboard.json`. Remaining in M2: the open half of issue #15 (file-open), and #16's five-minute acceptance test.

**v1.0 was redefined on 2026-07-27** ([ADR-0017](./adr/0017-v1-is-agent-generated-dashboards.md)): it is now *an agent produces a guidebook-conformant dashboard that the recipient opens with nothing installed* — a CLI core with an MCP server as a thin adapter. The former v1.0 (server, connectors, IdP-fronted deployment) became **v2.0** with its scope unchanged. Two things came out of that review worth knowing before reading anything else here:

- **[docs/guidebook-coverage.md](./guidebook-coverage.md) is new** and is the denominator for every conformance claim: 22 machine-checkable principles in the guidebook, 7 guaranteed in practice, of which 3 come from named rules and 1 from a runtime predicate; 3 known defects. The file states which count answers which question — the same implementation is defensibly 1, 3, or 7. Conformance is stated by count — never as "full compliance."
- **`palette.ts` diverges from the guidebook's color-role structure** ([spike](./spikes/guidebook-color-roles.md)). Secondary is supposed to be a different hue with its own ramp (Blue→Yellow, Cyan→Green), not another step of the primary's. PRD §6.1 F6, ROADMAP's M0 note, and ADR-0006 carried the wrong finding and are now corrected in place; the code fix is a separate conformance issue.
