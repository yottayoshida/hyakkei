# ADR-0015: Grid layout editor interaction model — thin custom implementation, not react-grid-layout/@dnd-kit

- **Status**: Accepted (2026-07-24)
- **Deciders**: yotta

## Context

Issue #14 (F5, ADR-0004's own deferred item — see `docs/ARCHITECTURE.md` §5, "Grid: Evaluate react-grid-layout vs thin custom in M2"; ADR-0004's Decision table itself has no "Grid" row, so this ADR corrects that attribution rather than repeating it). ADR-0014's own Consequences already named this gap explicitly: "(B)'s auto-placed grid is read-only in this PR (no drag-to-rearrange) — an explicit, UI-communicated scope boundary, not an oversight." This PR closes it, for reorder only — resize (`w`/`h` change) and responsive breakpoints are deliberately deferred to follow-up issues (the latter because `@digital-go-jp/design-tokens@2.0.1` carries no breakpoint/viewport tokens at all, confirmed directly against the installed package — the PRD's own "responsive breakpoints from the design tokens" premise may not hold as currently scoped).

`/plan` investigation (architect + qa-specialist + security-specialist + ux-designer, one Codex review round on the investigation, one independent review round on the finished plan — Codex was unavailable mid-review due to a workspace credit exhaustion, substituted with a fresh, independently-instructed subagent given the same rubric) surfaced the decision below.

## Decision

### Thin custom implementation — react-grid-layout and @dnd-kit (both generations) rejected

`packages/core`'s renderer (`mount.ts`/`patch()`) owns the live tile DOM imperatively and is shared, byte-for-byte, with the exported static viewer (ADR-0005/ADR-0008/ADR-0014). Both candidate libraries assume the opposite: that the library itself owns a React render tree for every draggable item.

- **react-grid-layout**: no keyboard operability at all (its drag engine, `react-draggable`, is pointer/touch-event-only) — a project constraint here, not a preference (WCAG 2.1.1/2.5.7, below). Even setting that aside, mounting it means handing tile DOM ownership to the library, which this project's renderer contract does not allow.
- **@dnd-kit/core + @dnd-kit/sortable** (the generation actually evaluated): last published 2024-12-05 (confirmed via `npm view ... time`), and `@dnd-kit/sortable`'s reordering model assumes DOM order matches visual order — this grid places tiles via `gridColumn`/`gridRow` (`mount.ts`'s `tileStyle`), where the two are independent by design.
- **@dnd-kit/react** (the actively-developed successor, confirmed still shipping as recently as 2026-07-13): rejected too, on two independent grounds — it is still pre-1.0 (`0.5.x` as of this writing, a supply-chain risk in its own right for a production feature), and adopting it would not resolve the underlying incompatibility anyway (it still assumes the library owns the draggable React tree).

Instead: a small pure function, `reorderLayout(items, fromIndex, toIndex, gridWidth)` (`packages/app/src/chart/layout-reorder.ts`), does an array-index move + full re-pack (via the existing `nextFreeCell`/`packItems` first-fit shelf packing, `layout-placement.ts`), and a transparent, `pointer-events`-scoped overlay (`AuthoringDashboardPreview.tsx`'s `LayoutReorderOverlay`) sits on top of the **unmodified** `patch()`-rendered grid, reading only geometry (`getBoundingClientRect()`) from it. `@hyakkei/core` gained two new exports (`GRID_ROW_SIZE`, `GRID_GAP`) so the overlay's coordinate math can never drift from the renderer's own — no new DOM-ownership coupling.

### PointerEvent-based drag, not the native HTML5 Drag and Drop API

Native HTML5 DnD's `DataTransfer` is a cross-context channel — it can carry a drop from another tab, window, or application, which a naively-implemented handler could end up trusting as an in-app move index. `PointerEvent` keeps the moved item's index in ordinary React/ref state, with no channel an external drop could inject through.

### Reorder semantics: array-order move + full re-pack, not free (x, y) placement

`reorderLayout` never lets a tile land at an arbitrary pixel/cell position — every move re-derives every item's `x`/`y` from scratch via the existing shelf-packing packer, in the new array order. This is a deliberate, narrower contract than "drag-and-drop grid" tools typically offer, chosen because it lets the whole feature reuse `nextFreeCell` verbatim (already proven correct by the existing auto-placement tests and the schema's own `validateLayoutReferences` oracle) instead of building and separately verifying a second placement engine. The UI is written to make this legible — "並び順を編集" (not "自由配置"), a highlighted drop-target slot during drag rather than a free-floating ghost — so the mismatch with a Trello-style mental model is disclosed, not hidden.

## Alternatives considered

| Option | Rejected because |
|---|---|
| react-grid-layout | No keyboard operability (fails WCAG 2.1.1/2.5.7 outright); assumes React-tree DOM ownership incompatible with the shared `patch()` renderer |
| @dnd-kit/core + @dnd-kit/sortable | Sortable's DOM-order-is-visual-order assumption doesn't hold for this grid's `gridColumn`/`gridRow` placement; last published 2024-12-05 |
| @dnd-kit/react | Still pre-1.0; does not resolve the DOM-ownership incompatibility either |
| Native HTML5 Drag and Drop API | `DataTransfer` is a cross-context input channel a handler would have to explicitly gate against external sources; `PointerEvent` avoids the channel entirely |
| Free (x, y) pixel placement (no re-pack) | Would need a second placement/collision engine independent of `nextFreeCell`, doubling the surface to verify for a `drag(reorder)`-only PR; deferred until resize (a separate follow-up issue) actually needs free placement |
| Migrating tile rendering to a React-owned tree so a DnD library could attach | Breaks the `authoring==baked` pixel-identity invariant the golden tests and ADR-0005/0008/0014 rely on (the exported viewer and editor preview must keep sharing the exact same `mount()`/`patch()` code path) |

## Residual risks (accepted for this PR)

- **RR-1 — This is a hand-written hit-testing/drag/keyboard-equivalence implementation, not a battle-tested library's.** The tradeoff this ADR makes is explicit: trading a real architectural/supply-chain incompatibility for the ongoing cost of maintaining this small amount of interaction code ourselves. Accepted because the alternative (either library) does not actually fit this project's rendering contract at any maturity level, not because "custom is always better."
- **RR-2 — `nextFreeCell`'s existing potential input space grows once F7 (`dashboard.json` load, not yet implemented) exists.** This PR hardens `nextFreeCell` (bounded loop, non-finite/sub-1 width rejection) defensively ahead of that, so F7 doesn't inherit a hang risk it would otherwise be the first to expose.
- **RR-3 — The drop-target highlight, not a pixel-exact insertion caret, is the chosen "where will this land" affordance.** A literal caret implies a single, precise final position; because a re-pack can shift several other tiles at once (mixed tile sizes), a caret would overclaim precision the underlying model doesn't have. Revisit if user feedback shows the highlight alone is insufficient.

## Consequences

- (+) Issue #14's reorder capability ships without adding a runtime dependency to `packages/app` (still just `@duckdb/duckdb-wasm` + `react` + `react-dom`).
- (+) `packages/core`'s renderer — and by extension the exported static viewer, which shares it byte-for-byte — is untouched except for two new named exports; `packages/export` has no dependency on `packages/app` at all (asserted directly, `packages/export/src/index.test.ts`), so the edit-mode UI cannot reach an exported dashboard by construction.
- (+) WCAG 2.1.1 (keyboard) and 2.5.7 (dragging movements, non-drag single-pointer alternative) are satisfied by the same `[前へ]`/`[後ろへ]` buttons as a first-class input, not a degraded fallback to a drag-first design.
- (−) Resize and responsive breakpoints, when they land, will most likely extend this same hand-written interaction layer rather than adopt a library at that point either — this ADR's rejection of react-grid-layout/@dnd-kit is not scoped to "for now," since the core incompatibility (DOM ownership) does not change with a larger feature set.
