# P1 demand hearing plan

- **Status**: Not run — decided 2026-07-11 (M2 proceeds as P1-designed, accepting the unvalidated-demand risk instead)
- **Owner**: yotta
- **Related**: [PRD.md §3](../PRD.md#3-users) · Market Research (`/plan`, 2026-07-04)

Kept as a record of the plan as originally scoped, not an active or pending task.

## Why this exists

Market Research found zero direct evidence that P1 (local-government/municipal staff) actually want Hyakkei — every observed signal in the wild is from P3 (civic-tech/vendor developers). The PRD's P1-first design (no-SQL editor, "pivot" vocabulary, guided Excel-fixing) is a bet, not a validated fact. This hearing tests that bet directly, in parallel with the M0 technical spike, without blocking it.

## What we're asking

Ask municipal/local-government staff who currently produce reports from spreadsheets:

1. Do you currently make charts/dashboards from your data? How (Excel charts, Power BI, PDF, nothing)?
2. **Knowing that Power BI Desktop is free to author in**, why haven't you used it — or if you have, what stopped you from sharing it beyond your own screen?
3. If a free tool let you build a Digital-Agency-styled dashboard and hand your team a file that "just opens" — no server, no account — would that solve a real problem for you, or is charting not actually your bottleneck?
4. What would make you *not* trust or use such a tool?

Question 2 is the load-bearing one: it directly tests the PRD §2.1 reframe ("the blocker is sharing/data sovereignty, not authoring cost"). If interviewees don't recognize that framing, the reframe is wrong, not just under-marketed.

## Who and how many

5 interviewees, municipal or local-government staff who are not already Hyakkei-aware, sourced through yotta's existing government/public-sector contacts. Informal 15–20 minute conversations, not a survey — the goal is signal on the framing, not statistical power.

## Kill criterion (decided in advance, per plan Decision 3)

> If most of the 5 interviewees would not use a free tool for this **and** the sharing/data-sovereignty pain (question 2) doesn't land as a real problem for them, **descope P1-specific editor investment** (the "pivot" vocabulary, guided Excel-fixing UX, the 5-minute test as designed for a non-technical user) and redesign around P3 first: dashboard.json as code + CLI (ROADMAP v0.4) become the primary product, with the editor UI as a secondary, more technical surface.

This criterion is written down now, before results exist, specifically so a favorable-looking but weak result can't be rationalized into "good enough" after the fact.

## What this does NOT gate

This hearing runs alongside M0 and gates the **M1 → M2 commitment** (per the implementation plan), not M0 itself. M0's technical de-risking (DuckDB-WASM performance, Excel fidelity, SQL containment) proceeds regardless of the outcome here — those facts are needed no matter which persona ends up primary.

## Recording results

Findings go in a follow-up to this file (or a dated section appended below) once the 5 conversations are complete, before M1→M2 sign-off.
