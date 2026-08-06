# ADR-0020: Chart alternative text is a top-level, optional field

- **Status:** accepted
- **Date:** 2026-08-06
- **Issue:** [#124](https://github.com/yottayoshida/hyakkei/issues/124)

## Context

The guidebook asks each chart to have alternative text (p56). A chart title and
the existing data-table fallback are useful, but neither reliably states the
chart's purpose and main takeaway. The authoring preview and baked viewer must
keep the same contract, while older version-1 documents remain valid.

## Decision

Add optional `altText` directly to `Chart` and `BakedChart`, beside `id` and
outside the closed `ChartOptions` allowlist. `bake()` preserves the field in
the existing authoring-to-baked projection. Blank or whitespace-only text is
omitted by the editor and treated as absent by the renderer.

The shared renderer uses one non-duplicative presentation per chart family:

- ECharts-backed charts receive the sanitized value as `aria.description`.
- `table` and `stat` charts receive one `dir="auto"` visually-hidden
  `.hyakkei-chart-alt-text` paragraph whose `textContent` is sanitized; the
  visible chart/table remains adjacent.

`sanitizeDisplayText()` removes bidi controls, default-ignorable characters,
and control characters before NFC/whitespace normalization. The renderer never
interprets document text as HTML. The data-table fallback remains a separate
adjacent affordance and is not treated as a substitute for author-provided
alternative text.

## Consequences

- The schema remains version `1` and additive; old artifacts without the field
  continue to validate.
- ECharts and DOM chart variants avoid announcing the same prose twice.
- Authors still choose the accuracy of the takeaway; the schema does not claim
  to verify that a description matches the data.
- Canonical samples carry substantive, data-grounded descriptions and tests
  protect their presence without inventing a universal quality threshold.
