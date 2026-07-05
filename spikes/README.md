# M0 spike scratch space

Throwaway code for the M0 feasibility spike (ROADMAP M0; issues #2, #3, #4, #5, #28, #29). This is explicitly **not product code** — it exists to de-risk technical unknowns before M1 implementation begins.

- Everything in this directory except this README is git-ignored — nothing here is meant to be reviewed or maintained.
- It lives inside the pnpm workspace (add it to `pnpm-workspace.yaml` if you need `pnpm add` for a candidate library) so spikes can freely install and drop dependencies without touching `packages/*`.
- **Written results go in `docs/spikes/*.md`** (tracked, per ROADMAP) — not here. This directory is for the code that produced those results, not the results themselves.
- Delete and recreate freely. Nothing here survives past the M0 gate (issue #30).
