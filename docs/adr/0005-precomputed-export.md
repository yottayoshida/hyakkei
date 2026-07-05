# ADR-0005: Pre-computed (baked) export — the viewer never runs DuckDB or SQL

- **Status**: Accepted (2026-07-05)
- **Deciders**: yotta

## Context

ADR-0001 committed to browser-complete execution for the whole v0.x pipeline, including the exported static site. But `/plan` investigation (QA V-001/V-002, Security T1/T2, UX high-priority proposal) surfaced a structural conflict in that original design:

- Static hosts (GitHub Pages, GCS, S3) and `file://` cannot set COOP/COEP headers, so DuckDB-WASM in an exported site is permanently confined to its single-threaded build.
- Chrome blocks `fetch` from a `file://` document to sibling files (null-origin restriction), so an exported site that fetches `dashboard.json`/data files at view time may not even launch by double-click — the primary distribution path for P1 (municipal staff with no server).
- If the exported viewer still runs SQL, the security threat model must treat every exported/shared dashboard as a live SQL-execution surface (T1: data exfiltration via network-capable SQL; T2: community-extension code execution) — even though v0.1's viewer is explicitly read-only with no interactive query surface.

Codex proxy review (Phase 3) pushed further: since v0.1's viewer has zero interactivity (PRD §6.1 "Out": no custom SQL editor, no live filters), there is **no v0.1 use case for a query engine in the viewer at all**. Carrying DuckDB-WASM into exported output solves nothing that a pre-computed result doesn't already solve, at the cost of the constraints above.

## Decision

**The viewer never runs DuckDB-WASM, SQL, or a Worker.** At export time, a single shared **bake function** executes every query in the dashboard document against the resolved data and produces a **`BakedDashboard`** artifact — the query engine's entire lifetime is bounded to editing and export; it is never present in what a viewer downloads or opens.

```jsonc
// BakedDashboard — the only thing an exported/viewed site ever reads
{
  "version": 1,
  "meta": { "title": "月次KPIダッシュボード", "generatedAt": "2026-07-05T00:00:00Z",
            "sourceDataAsOf": "2026-06-30", "hyakkeiVersion": "0.1.0" },
  "theme": { "tokens": "@digital-go-jp/design-tokens@x.y.z", "palette": "guidebook-blue" },
  "charts": [
    { "id": "c1", "type": "bar", "encoding": { "x": "category", "y": "total" },
      "options": { "title": "区分別申請額" },
      "rows": [ { "category": "A", "total": 120 }, { "category": "B", "total": 90 } ] }
  ],
  "layout": { "grid": "guidebook-12col", "items": [ { "chart": "c1", "x": 0, "y": 0, "w": 6, "h": 4 } ] }
}
```

`bake(document: Dashboard, resolvedTables) → BakedDashboard` is a pure function living in `packages/core` (ARCHITECTURE §9), sharing the Renderer's theme/layout logic. This is a **first-class deliverable of M1**, pinned with a published schema and round-trip tests exactly like the authoring `dashboard.json` schema (issue #6) — not an implementation detail decided ad hoc during M3.

### Two distinct artifact kinds (do not conflate)

| | Authoring `dashboard.json` (ADR-0002) | Exported `BakedDashboard` |
|---|---|---|
| Contains | `sources`, `queries` (SQL), `charts`, `layout` | `charts` (with baked `rows`), `layout` — no sources, no SQL |
| Produced by | The editor, as the user works | `bake()`, once, at export time |
| Consumed by | The editor (open/save), the Renderer (preview), `bake()` | The Renderer, in view-only mode |
| Re-editable? | Yes — this is what templates distribute (UC3: a prefecture's template is an authoring file; municipalities open it, swap sources, re-bake) | No — frozen at the data snapshot in `meta.sourceDataAsOf`. Re-templating requires the authoring file, not the export |
| Needs DuckDB-WASM to consume? | Yes (editor) | **Never** |

Template distribution (PRD UC3) always moves the **authoring** file. An exported site is a terminal artifact, like a PDF — not something you re-template from.

### Packaging: single-file default, folder is the advanced option

Because a `BakedDashboard` is just data (no query engine required to read it), export packaging becomes a pure size/portability tradeoff, not a data-freshness one:

- **Single HTML file (default)**: `BakedDashboard` inlined as a `<script>` JSON blob; renderer bundle inlined. One file, double-click, done. This is what issue #18 now covers (redefined below).
- **Folder (advanced option)**: `index.html` + `renderer.js` + `dashboard.json` (the baked artifact) as separate files. Useful for embedding (v0.3) or when inlining would bloat a single file past a practical size (large `table`/`scatter` charts with many rows — tracked as a risk in the implementation plan).

**Issue #18 is retired in its original form** ("snapshot vs URL-ref *source* embedding," a data-freshness choice that no longer exists once sources stop traveling into the viewer) and **redefined** to this single-file-vs-folder packaging axis.

#### How single-file packaging survives a strict CSP (Codex review, 2026-07-05)

A naive single-file export — `BakedDashboard` JSON and the renderer bundle both inlined as `<script>` tags — conflicts with the CSP in ARCHITECTURE §6 (`script-src 'self'` blocks inline `<script>` execution; `'wasm-unsafe-eval'` does not grant an inline-script exception). The fix keeps the CSP strict rather than weakening it to `'unsafe-inline'`:

1. **The baked data ships as an inert data island**, not executable script: `<script type="application/json" id="hyakkei-data">{...BakedDashboard...}</script>`. A `type="application/json"` block is never executed by the browser — CSP `script-src` governs script *execution*, and this block is not a script to execute, so it is unaffected by `script-src` regardless of how strict it is.
2. **The renderer bundle is the only inline content that actually executes**, and its bytes are identical for a given Hyakkei release — it is not user data and does not vary per export. The exporter computes its SHA-256 hash once per release and bakes `script-src 'self' 'sha256-<hash>'` into the CSP meta tag template it writes into every export. This is standard CSP hash-based allow-listing, not `'unsafe-inline'` — an attacker who controls dashboard *data* (chart titles, row values) still cannot get arbitrary script to execute, because only the one hash matching the known-good renderer bundle is permitted. **Two build-time obligations this depends on** (verify in M1/M3, do not assume): the CSP hash covers the exact bytes between `<script>` and `</script>` including whitespace/indentation — the export template must emit that tag identically byte-for-byte on every export, not just ship "the same bundle content" with different surrounding formatting; and the bundle build must be deterministic (no embedded build timestamps, non-deterministic minifier output, etc.) or the hash silently goes stale on a release that changed nothing meaningful. Treat this the same way as the DuckDB containment flags (ARCHITECTURE §6): verify empirically, don't trust it by construction.
3. Folder packaging doesn't need this at all: `renderer.js` is loaded via `<script src="renderer.js">`, a same-origin file load that `script-src 'self'` already permits.

This detail belongs here (not just ARCHITECTURE §6) because it's what makes Decision §"Packaging" actually work under the security model — a future implementer must not "fix" a broken single-file export by loosening the CSP.

### F2 (data shaping/filter) is authoring-time only

PRD F2 "filter" happens in the editor, before baking. Nothing about filtering exists at view time — the baked rows are already the filtered/aggregated result. This must be stated plainly in the PRD so no one designs a viewer-side filter UI expecting it to touch live data.

### Threat model consequence (feeds Security's SR list)

Because the viewer never executes SQL, **T1 (data exfiltration via SQL network egress) and T2 (malicious extension load) do not exist in exported/shared sites.** The primary attack surface collapses to **opening an authoring file in the editor** (V-050: a malicious template's SQL runs when *you* open it to edit, never when someone else views your export). SR-1/SR-2/SR-3 (DuckDB containment, DataSource network isolation, origin approval) are therefore editor-side controls, not viewer-side ones — this narrows and clarifies where those controls must live.

## Alternatives considered

1. **Keep DuckDB-WASM in the viewer, resolve sources live (original design)** — rejected: solves no v0.1 use case (viewer has no interactivity to justify a live query engine), while inheriting every WASM/COOP-COEP/file:// constraint and the full SQL threat surface into every shared dashboard.
2. **Two viewer modes (baked for static export, live DuckDB for a "connected" mode)** — rejected for v0.1: doubles the runtime and test surface for a single maintainer (ADR-0004 §Consequences already flags DuckDB+ECharts as a heavy baseline). Revisit only if v0.3 embed or v1.0 live data genuinely requires it — a live/connected viewer mode is a new decision, not a variant of this one.
3. **Bake at *save* time instead of *export* time** — rejected: would make every editor save slow and would go stale the moment source data changes before the next export; baking exactly once, at export, keeps `meta.sourceDataAsOf` meaningful.

## Consequences

- (+) Exported sites work from `file://` double-click and any static host without exception — the COOP/COEP and null-origin-fetch constraints (QA V-001/V-002) stop applying to the viewer entirely.
- (+) Bundle size for viewers drops by the DuckDB-WASM payload (tens of MB) and its Worker; only the renderer + baked JSON ship.
- (+) Threat surface for shared/published dashboards shrinks to zero SQL execution (T1/T2 eliminated at view time); the remaining surface (V-050, opening untrusted templates in the editor) is smaller and better understood.
- (+) `BakedDashboard` and authoring `dashboard.json` can each stay simple, instead of one schema trying to serve both a live-editable document and a frozen view.
- (−) Interactive viewer features (live filters, drill-down) are not possible in v0.1 exports by construction — deferred to the parking lot until a "connected viewer" is separately decided (v0.3+/v1.0).
- (−) Two schemas to maintain instead of one; mitigated by sharing the theme/layout types between them and generating both from the same `packages/schema` package.
- (−) Large non-aggregating charts (full `table`/`scatter` over many rows) bake to large row arrays — tracked as a risk (implementation plan) with an M3 acceptance check and a size-triggered fallback to folder packaging.
