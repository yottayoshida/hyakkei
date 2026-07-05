# Hyakkei design docs — start here

New to the project? Read in this order:

1. **[PRD.md](./PRD.md)** — *why* this exists and *for whom*. Problem, users, scope, non-goals, risks. If you read one document, read this.
2. **[ROADMAP.md](./ROADMAP.md)** — *what* to build and *in what order*. Every version is defined by a user outcome; v0.1 is broken into milestones M0–M4, each with an acceptance check. **"What should I work on?" is answered by the first unchecked box in the current milestone.**
3. **[ARCHITECTURE.md](./ARCHITECTURE.md)** — *how* it's built. Component boundaries, the `dashboard.json` document, data flow, security model, testing strategy, repo layout.
4. **[adr/](./adr/)** — *why it's built that way*. One file per irreversible decision, with the alternatives that were rejected and why. Read these before proposing to change something fundamental — the answer to "why don't we just add login?" is [ADR-0003](./adr/0003-authentication-outside-the-app.md); the answer to "why does the viewer need DuckDB-WASM?" is [ADR-0005](./adr/0005-precomputed-export.md) (it doesn't).

## Rules that keep these docs useful

- **Outcome over features**: a feature belongs in a version only if it serves that version's outcome sentence (ROADMAP). If it doesn't, it goes to the parking lot.
- **Boundaries need ADRs**: implementation details may drift from ARCHITECTURE.md freely; component *boundaries* and anything listed in an ADR may only change with a new or amended ADR.
- **Docs change by PR** like code. If reality and docs disagree, fix one of them in the same PR that created the disagreement.

## Current status

Design phase. Step 0 corrections (2026-07-05) landed: pre-computed export architecture (ADR-0005), license track separation (ADR-0006), and several factual fixes to the original PRD/ARCHITECTURE/ADR-0004 draft. Next action: the **M0 feasibility spike**'s must-complete items ([ROADMAP.md](./ROADMAP.md#m0--feasibility-spike-timeboxed-1-week), issues #2, #3, #5, #28) — validate DuckDB-WASM (single-threaded), ExcelJS fidelity, and SQL/network containment before writing product code.
