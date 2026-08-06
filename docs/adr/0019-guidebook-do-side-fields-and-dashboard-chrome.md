# ADR-0019: The guidebook's Do-side fields live on `meta`, and the renderer owns the dashboard footer

- **Status**: Accepted (2026-08-02)
- **Deciders**: yotta
- **Plan**: `.claude/plans/eager-puzzling-kitten.md`
- **Amends**: [ADR-0017](0017-v1-is-agent-generated-dashboards.md) Decision 7, which scoped four fields
  as v1.0's schema work without settling where any of them lives.
  [ADR-0008](0008-renderer-core-and-bake.md), which described a renderer that draws chart tiles and
  nothing else.

## Context

`docs/guidebook-coverage.md` splits the guidebook's machine-checkable principles by how hyakkei can
fail them. Most unmet ones are *Don't*-side: the schema cannot express the violation, which is a
guarantee rather than a gap. Four are the opposite — the schema cannot express the **requirement**,
so no amount of care satisfies them. There is nowhere to put alternative text, a summary, an update
date, or a source note.

Underneath that sits a second problem the inventory recorded but nothing acted on. `BakedMeta`
carries `generatedAt`, `sourceDataAsOf` and `hyakkeiVersion` as **required** fields, and `baked.ts`'s
own comment calls `sourceDataAsOf` "the viewer's only signal of how fresh the frozen data is" — yet
no renderer code read any of them. A baked artifact is terminal (ADR-0005): someone opens it a year
later with no way to ask when the numbers were current. The data was in the file and invisible to
its only audience.

Reading the guidebook directly (p41 / p56, `pdftotext` against each page's printed footer, 2026-08-02;
recorded in the coverage file's attestation table) settled two things a summary would have obscured.
p41 lists 「データの更新日」 and 「いつ時点の数値なのか」 as **separate items** — so the author's claim
about the upstream data and the bake's record of the frozen rows are two facts, not one. And p56's
enumeration maps cleanly onto coverage rows #22 / #24 / #23, with the caveat that its body text
contains a duplicated word in the source.

## Decision

### 1. `updatedAt` / `sourceNote` / `summary` go on `meta`, hand-duplicated onto `BakedMeta`

Three optional fields on `BaseMeta`, copied by hand into `BakedMeta` for the reason `baked.ts`
already documents: `Type.Composite` rebuilds an object from `properties` alone and silently drops
the `propertyNames` guard that closes the prototype-pollution hole.

That duplication is now six fields rather than three, so `baked.test.ts` pins the two objects
against each other — identical schemas for shared keys, identical optionality (the `required` array,
because `Type.Optional` lives on a symbol that JSON-serializes away), and a baked-only key set that
is exactly the three stamps.

Not top-level on `Dashboard`: that would trip `SAVE_NARRATIVE_COVERED_KEYS`'s exact-match assertion
and pull the save-flow copy into a change that has nothing to do with it.

### 2. `sourceNote` is per dashboard

`BakedDashboard` applies `ForbidFields("sources", "queries")`, so a per-source field **cannot reach
a baked artifact at all**. The requirement's audience is the third party who opens that artifact, so
a placement that never reaches them fails by definition. Multiple sources are cited in one free-text
field. If a structured source list is ever needed on the viewer side, it is an addition to
`BakedMeta` — this decision does not close that door.

### 3. `updatedAt` is `format: "date"`, and is not `sourceDataAsOf`

**`updatedAt` is the author's claim about when the upstream dataset last changed. `sourceDataAsOf` is
what `bake()` recorded about the rows frozen into this artifact.** A dataset updated 2026-06-30 and
baked 2026-08-02 legitimately disagrees, which is why p41 asks for both.

`date`, matching `sourceDataAsOf`, so a footer showing the two side by side uses one spelling.
`date-time` was rejected: an author who only knows the day would have to invent `T00:00:00Z`.
Widening to `date | date-time` later is additive, so this is the reversible direction.

**Do not let `bake()` default one from the other.** The moment it does, the distinction p41 draws
disappears and the artifact asserts something nobody stated.

### 4. The renderer owns the footer

`normalizeBaked` → `mount()` is the only path from a `BakedDashboard` to pixels. `packages/export` is
a placeholder and `packages/app` is the editor, so an app-owned footer cannot satisfy a requirement
about distributed artifacts. This is the first DOM the renderer owns that is not a chart tile.

Drawn unconditionally for baked documents, with no "does this have provenance?" test: the three
stamps are `required`, so "a baked artifact showing no as-of date" stops being representable rather
than being something to remember to avoid.

### 5. Provenance is modelled by who asserted it, and split before the drawing site

`RenderModel` carries a `FooterModel` whose items are tagged `recorded` (stamped by `bake()`) or
`declared` (passed through from the document). Labels are module constants; a document never supplies
one.

**The split happens in `normalizeBaked` / `normalizeAuthoring`, not in the footer builder**, and that
is the load-bearing part. Passing `meta: BaseMeta | BakedMeta` and letting the builder decide looks
tidier and is wrong twice:

- On the authoring side those three keys are **not schema-typed at all**. `BaseMeta` is a
  `SafeObject` with `additionalProperties` open, so a hand-written document may carry
  `generatedAt: null` — or a number, or an object — and still parse. Verified against the generated
  validator, not inferred.
- TypeScript would then hand out a guarantee it cannot keep: narrowing that union with
  `"generatedAt" in meta` yields `string`, which is false for exactly those values. The footer is
  appended outside any per-tile `try`, so the resulting `TypeError` takes down the whole dashboard —
  while every other failure in this renderer is contained to one tile.

Splitting at normalization moves the question to where the input type already answers it.
`normalizeAuthoring` receives a `BaseMeta` with no such fields to read, so "an authoring document
cannot show bake-recorded provenance" is a compile error rather than a rule someone remembers.

### 6. Fields are ordered as p41 enumerates them, and the summary is a separate element

出典 → 更新日 → データ時点 → 作成. This project's conformance claim is that it cites the guidebook;
an order of our own invention would need explaining every time. `hyakkeiVersion` is last because it
describes the tool, not the data.

The summary sits in its own block, before the provenance list. It is the one field that makes a claim
about the **data**; the others describe the **file**. Keeping them adjacent but distinct means a
re-bake that moves `sourceDataAsOf` while leaving a stale summary shows the contradiction in place.

Provenance items share one paragraph, each in a `dir="auto"` span. The `dir` attribute is what
isolates them — the HTML rendering spec gives `[dir]` elements `unicode-bidi: isolate`, so one item
cannot reorder the next without needing a block boundary. They are joined by a literal separator
character, not by CSS spacing: **this repository ships no stylesheet**, so anything expressed only in
CSS renders as nothing. Review caught the first version running the items together
(「…「家計調査」更新日: …」), which the tests missed because they asserted on each span in isolation
while both a sighted reader and a screen reader consume the concatenation.

**Its placement is a compromise, recorded as one.** p56 frames the summary as something to read
*instead of* the charts, which argues for the top of the page — and for a screen reader the current
position means hearing every tile first. Putting it above the grid requires shifting every tile down
one row, touching `gridStyle`/`tileStyle` and the editor's overlay coordinates. Out of scope here;
revisit when M3 gives the artifact an outer shell.

### 7. Document text is sanitized for display, with a separate function

`sanitizeDisplayText` strips `\p{Bidi_Control}`, zero-width characters and non-whitespace C0/C1, then
applies NFC. The Unicode property rather than a hand-written range list, because
`download-filename.ts` writes that list by hand and shipped it missing U+061C until review caught it.

**Not `download-filename.ts`'s `UNSAFE_CHARS`**, which also strips `\ / : * ? " < > |` because a
filename must not carry path separators. A source citation legitimately contains those characters, so
reuse would corrupt the field this exists to display honestly.

Newlines and tabs fall through to whitespace collapse rather than being deleted: `sourceNote` holds a
source, notes and disclaimers in one field, and deleting its separators merges two statements into
one word.

NFC, never NFKC — NFKC rewrites ﬁ to fi and full-width to half-width, editing a citation's typography.

### 8. The footer's grid row is unclamped

`(items.length ? max(y + h) : 1) + 1`. The `+ 1` is required: `tileStyle` starts a tile at `y + 1`, so
`max(y + h)` names the last tile's own row. The empty-layout case counts as one row because the
"配置されたチャートがありません" tile auto-places, and a footer claiming row 1 across all columns
would push that message below it.

Clamping was implemented, tested, and **withdrawn**. `MAX_LAYOUT_Y` is 100,000, but `tileStyle`
already hands that number to `gridRow`, so a cap on the footer removes no implicit tracks. It instead
adds two faults: a tile at the cap row and the footer land on the same row, and for layouts past the
cap the "footer" renders above every tile. If a bound is wanted it belongs at the document level, not
on one element.

**The row must also be allowed to grow**, which `gridStyle`'s `grid-auto-rows: 4rem` forbids: an
implicit row is exactly that tall, and an over-full one does not expand — its content spills outside
the container's height and stops being visible. `appendFooter` therefore declares the rows above the
footer explicitly at the same 4rem and leaves the footer's own row `auto`
(`grid-template-rows: repeat(N-1, 4rem) auto`), and clears that template when a patch removes the
footer, since `replaceChildren` leaves inline styles behind. Tile sizing is byte-identical: the tiles
sit in the `repeat()` part at the size they already had. This was not in the original design — it
came from looking at the rendered page, where the provenance line was missing entirely while the
whole test suite was green (see RR-6).

One consequence worth stating: for an adversarial layout this emits
`grid-template-rows: repeat(110000, 4rem) auto`, turning what were implicit tracks into explicit
ones. The track count is unchanged — `tileStyle` already forced them into existence — but the
declaration is now explicit, and no test observes the container template at that scale.

## Read-forward: recorded guidebook edition (2026-08-06, issue #130)

The original decision above deliberately kept the guidebook edition outside the authoring Do-side fields. The claim form now has a separate optional `BakedMeta.guidebookVersion`: `bake()` stamps it from the immutable `GUIDEBOOK_SOURCE` constant, overriding any author or caller value, and the footer renders it as `ガイドブック: v02` between the creation and tool stamps. The field is optional so pre-#130 baked artifacts continue to parse and render.

`v02` is the publisher's edition label, not a content hash. The same PDF URL and label have served different byte streams, so the retrieval and `Last-Modified` dates in `GUIDEBOOK_SOURCE` and the coverage attestation remain the staleness evidence. This note extends the accepted decision without rewriting the historical rationale above.

## Alternatives considered

| Option | Rejected because |
| --- | --- |
| `altText` on `ChartOptions` (as issue #124 originally proposed) | `ChartOptions` is a closed security allowlist whose unknown-key **rejection** is pinned by `round-trip.test.ts` — it is outside the forward-compatibility contract. A document using it would fail to open in an older hyakkei. Deferred to PR-2 with `Chart.altText` instead |
| `sourceNote` per source | Cannot reach a baked artifact (`ForbidFields("sources")`) |
| The three fields at `Dashboard` top level | Trips the save-narrative key assertion; buys nothing |
| `updatedAt` as `date-time` | Forces invented precision on an author who knows only the day |
| `updatedAt` as free text | Cannot be compared or ordered against `sourceDataAsOf` |
| App-owned footer | Cannot reach the exported artifact — the only audience the requirement has |
| `RenderModel.meta` with the split at the drawing site | The narrowing is a lie for untyped authoring values, and the failure is a whole-dashboard crash rather than a degraded tile |
| A separate provenance-origin tag beside `meta` | Two fields that must agree, with no symptom when they do not |
| Footer via grid auto-placement | Lands mid-grid whenever the layout has a gap |
| Clamping the footer's grid row | Removes no cost, adds an overlap and an inversion |
| A rules-evaluated count in the footer | `getGuidelineRules()` fails open to `[]`; printing "N rules evaluated" after a failure to evaluate is the false-compliance path ADR-0016 already records |

## Residual risks

- **RR-1 — an SSR-based export would silently omit the footer.** The only entry point today is
  `mount()`. A DOM-serializing export inherits the footer; an SSR one does not, and nothing would
  report it. This is the same shape as ECharts' own `if (!dom) return` in its aria pass. **M3 must
  call the footer builder explicitly**, and that is the single most useful line in this document.
- **RR-2 — the hand-duplication between `BaseMeta` and `BakedMeta` is six fields and growing.**
  Mitigated by `baked.test.ts`'s mirror assertions, which are themselves the thing to keep alive.
- **RR-3 — nothing verifies that a `declared` field is true.** Under ADR-0017 Decision 1 the author is
  usually an agent, so a hallucinated citation is the expected failure mode rather than a remote one.
  The `recorded`/`declared` split limits the damage to what the document itself claims; it does not
  detect a false claim. Homoglyph substitution in a source name is not detectable at all — the
  characters are legitimate. README and any future SECURITY.md should state this as a non-guarantee.
- **RR-4 — an author can write a summary that contradicts the data.** The gallery samples are pinned
  against their own rows (`golden-samples.roundtrip.test.ts`), but that is a fixture-quality guard,
  not a runtime check, and there is deliberately no rule requiring or validating these fields:
  a rule that fires on every unfilled optional would be noise, and one that judged content would be
  claiming a capability this project does not have.
- **RR-5 — `schemaFieldsOwed` reaching 0 removes the pressure that keeps this inventory read.** Seven
  `not covered` rows remain, and nothing surfaces them.
- **RR-7 — the container's grid box now has two writers.** `gridStyle` owns `display`,
  `gridTemplateColumns`, `gridAutoRows` and `gap`; `appendFooter` writes `gridTemplateRows` from a
  different function at a different point, and on `patch()` under a different trigger (`gridStyle`
  runs only when `layout.grid` changed; `appendFooter` runs every time). Raised by `/simplify`'s
  altitude pass and **not fixed here**: `gridStyle` is named in Decision 6 as out of this PR's scope,
  and folding the row template into it means changing a function every tile depends on.

  The concrete hazard is the next planned change, not this one. Decision 6 defers a header row for
  the summary, and a header row implemented in `gridStyle` would write `gridTemplateRows` — which
  `appendFooter` then clears and overwrites, since it runs after `gridStyle` on both paths. jsdom
  performs no layout and the tests assert only the footer-shaped string, so the header row would
  disappear with a green suite: the same failure mode as RR-6, re-armed.

  **Whoever builds the header row should make `gridStyle` the single writer first**
  (`gridStyle(container, layout, footerRow?)`), rather than adding a third writer. The unconditional
  clear in `appendFooter`, and V-122 which polices it, both exist only because ownership is split.
- **RR-6 — long text in the footer.** *This risk was written as "accepted: the footer only extends
  below the last tile, so tile geometry is unaffected." **That acceptance was withdrawn before this
  ADR shipped, because its premise was measurably false.*** `gridStyle` sets
  `grid-auto-rows: 4rem`, which pins every implicit row at exactly that size — an over-full row does
  not grow, so the content spilled outside the container's own height and the entire provenance line
  was **not visible at all**. Found by screenshotting the real browser: every unit test passed, and
  the PR's own thesis did not hold in the product.

  Decision 8 therefore also declares the rows above the footer explicitly
  (`grid-template-rows: repeat(N-1, 4rem) auto`), leaving tile sizing identical while letting the
  footer's own row size to its content. `overflow: hidden` remains deliberately unset — truncating a
  source citation silently is worse than letting it run on, and it would reintroduce the same defect
  in a form that looks intentional. Both properties are pinned (`mount.test.ts` V-121 through V-124).

  What survives as a risk is narrower: a very long summary makes the footer tall. That costs vertical
  space and nothing else — tile geometry is unchanged, which is now asserted rather than assumed.

## Consequences

- Three of issue #124's four fields exist; `Chart.altText` remains, and with it coverage row #23.
- Coverage rows #12 and #24 move to a new `supported` status — expressible, drawn, and pinned, but
  with no rule requiring an author to fill them in and no check on what they wrote. It deliberately
  counts toward no headline figure. Row #13 becomes `partly by construction`: its bake-recorded half
  is unforgeable, its authored half optional.
- `schemaFieldsOwed` is derived from the schema rather than hand-typed, so this document and the code
  can no longer drift into agreement.
- The renderer now has a place to put dashboard-level chrome. A header row remains unbuilt, and the
  summary's placement is the first thing that will want it.
