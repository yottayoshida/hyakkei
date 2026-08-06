import { Type, type Static } from "@sinclair/typebox";
import {
  BASE_META_FIELDS,
  ChartOptions,
  ChartVariant,
  ForbidFields,
  JsonPrimitive,
  Layout,
  NonEmptyString,
  SafeObject,
  SafeRecord,
  Theme,
  Version,
} from "./common.js";

/**
 * Staleness stamping (UX carry-forward, M3 acceptance): baked-only metadata
 * with no authoring equivalent. `generatedAt`/`sourceDataAsOf` are the
 * viewer's only signal of how fresh the frozen data is. The `hyakkeiVersion`
 * pattern is anchored at both ends (`^...$`) — an unanchored pattern accepts
 * trailing garbage after a valid-looking prefix (e.g. `"0.1.0<script>"`).
 * Prerelease/build metadata suffixes are not supported: hyakkei's own release
 * versions are plain `x.y.z` (rules/release-checklist.md).
 *
 * `BaseMeta`'s fields arrive by spreading `BASE_META_FIELDS`, the raw property
 * record `common.ts` builds `BaseMeta` from — NOT via
 * `Type.Composite([BaseMeta, ...])`. Composite rebuilds a fresh object schema
 * from the two inputs' `properties` only, silently dropping other top-level
 * keywords like `propertyNames`; a `Composite`d meta would have re-opened the
 * AA-12 prototype-pollution guard that `SafeObject` exists to close (caught by
 * Codex R2 review). Spreading a plain record has no such problem — the
 * `SafeObject` call here still applies the guard, exactly as `chartVariant`
 * relies on for the seven chart encodings.
 *
 * Issue #124 took the shared block from three fields to six, and an earlier
 * draft of that change hand-copied all six (including their `description`
 * prose) into this file, then added drift-detection tests to notice when the
 * two fell out of step. `/simplify` pointed at the record-sharing idiom
 * already in `common.ts`: the two cannot drift if there is only one of them.
 * What remains worth asserting is the set of keys unique to THIS object —
 * see `baked.test.ts`, which pins it to exactly the three stamps below,
 * because a fourth would be something a viewer can be told and an author
 * cannot state.
 */
export const BakedMeta = SafeObject({
  ...BASE_META_FIELDS,
  generatedAt: Type.String({ format: "date-time" }),
  sourceDataAsOf: Type.String({ format: "date" }),
  hyakkeiVersion: Type.String({ pattern: "^\\d+\\.\\d+\\.\\d+$" }),
});
export type BakedMeta = Static<typeof BakedMeta>;

/**
 * `query`/`sql` are explicitly forbidden here (shape enumeration AB-4), not
 * merely absent from the allowed properties — `additionalProperties` stays
 * open for genuine forward-compat, so an *allowed* field list alone would not
 * stop these two specific authoring-only keys from riding along as "unknown"
 * fields. `rows` replaces `query` (ADR-0005: the viewer never runs SQL). Row
 * values are constrained to JSON primitives only — sanitizing a cell's
 * *content* for safe rendering (shape enumeration AB-1: a rows cell can
 * still carry an XSS payload as plain text) is the renderer's job, not the
 * schema's; the schema's job is only to guarantee the shape is inert data,
 * never markup or a callable.
 */
export const BakedChart = Type.Intersect([
  ChartVariant,
  SafeObject({
    id: NonEmptyString,
    altText: Type.Optional(
      Type.String({
        description:
          "A concise text alternative that communicates the chart's purpose and main takeaway without requiring the visual chart or its data table.",
      }),
    ),
    options: ChartOptions,
    rows: Type.Array(SafeRecord(JsonPrimitive)),
  }),
  ForbidFields("query", "sql"),
]);
export type BakedChart = Static<typeof BakedChart>;

const BakedDashboardShape = SafeObject({
  version: Version,
  meta: BakedMeta,
  theme: Theme,
  charts: Type.Array(BakedChart),
  layout: Layout,
});

/**
 * Explicitly forbids `sources`/`queries` (shape enumeration AB-4): ADR-0005's
 * invariant is that a baked artifact never carries a query engine's inputs.
 * This is a `not` clause layered on top of the shape, not
 * `additionalProperties: false` — arbitrary *other* unknown fields must still
 * pass through for forward-compat (BakedMeta/BakedChart additive fields).
 */
export const BakedDashboard = Type.Intersect([
  BakedDashboardShape,
  ForbidFields("sources", "queries"),
]);
export type BakedDashboard = Static<typeof BakedDashboard>;
