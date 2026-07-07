import { Type, type Static, type TProperties } from "@sinclair/typebox";
import {
  BaseMeta,
  ChartOptions,
  ChartVariant,
  Layout,
  NonEmptyString,
  SafeObject,
  Theme,
  Version,
} from "./common.js";

/**
 * Two discriminants: `kind` (file | url), and per kind, `format` — and per
 * *format*, the `ref` shape differs too (shape enumeration DA-7: xlsx takes an
 * optional sheet name, csv takes an optional encoding, parquet takes neither).
 * Each format's `ref` only *documents* its own optional field as part of the
 * published contract for that format.
 *
 * `ref` is deliberately left additive (via `SafeObject`, not
 * `additionalProperties: false`) rather than a closed shape: unlike
 * `ChartOptions`/`Theme`, a stray field here (e.g. `encoding` riding along on
 * an `xlsx` source) isn't a security boundary, so it gets the same
 * forward-compat treatment as the rest of the document rather than a special,
 * stricter rule just for this one object. A future format-specific field is
 * still additive; it does not need a version bump.
 *
 * `proxy` (ARCHITECTURE §3, "file | url | proxy (v1.0)") is deliberately
 * excluded from v0.1 — its `ref` shape isn't designed yet, and reserving an
 * enum member the editor can't act on buys nothing now. Adding it later is a
 * standard additive change, not a special case.
 */
function fileSource<Format extends string, Ref extends TProperties>(
  format: Format,
  refProperties: Ref,
) {
  return SafeObject({
    id: NonEmptyString,
    kind: Type.Literal("file"),
    format: Type.Literal(format),
    ref: SafeObject(refProperties),
  });
}

const FileSourceXlsx = fileSource("xlsx", {
  name: NonEmptyString,
  sheet: Type.Optional(Type.String()),
});
const FileSourceCsv = fileSource("csv", {
  name: NonEmptyString,
  encoding: Type.Optional(Type.String()),
});
const FileSourceParquet = fileSource("parquet", { name: NonEmptyString });

const UrlSource = SafeObject({
  id: NonEmptyString,
  kind: Type.Literal("url"),
  format: Type.Union([Type.Literal("csv"), Type.Literal("parquet")]),
  ref: SafeObject({
    // Scheme allowlist (shape enumeration AA-11): a bare `format: "uri"` check
    // alone accepts `file://` and other non-http(s) schemes, which is an SSRF
    // adjacent local-read vector once resolved by the editor's fetch layer.
    url: Type.String({ format: "uri", pattern: "^https://" }),
  }),
});

export const Source = Type.Union([FileSourceXlsx, FileSourceCsv, FileSourceParquet, UrlSource]);
export type Source = Static<typeof Source>;

export const Query = SafeObject({
  id: NonEmptyString,
  source: NonEmptyString,
  // Intentionally opaque: schema does not parse or validate SQL semantics.
  // A malicious query (e.g. reaching for httpfs) is a real risk but is
  // contained at the network layer (CSP connect-src, verified in
  // docs/spikes/m0-containment.md), not by rejecting suspicious-looking SQL
  // text here — schema-level SQL sniffing would be both incomplete and a
  // false sense of security (shape enumeration AA-5).
  sql: NonEmptyString,
});
export type Query = Static<typeof Query>;

/**
 * `query` is optional (shape enumeration DA-9): a chart tile the user just
 * added in the editor, before wiring a query, is a real and valid
 * intermediate state — requiring it would make that moment unsaveable.
 */
export const Chart = Type.Intersect([
  ChartVariant,
  SafeObject({
    id: NonEmptyString,
    query: Type.Optional(NonEmptyString),
    options: ChartOptions,
  }),
]);
export type Chart = Static<typeof Chart>;

/**
 * `sources`/`queries`/`charts`/`layout.items` are required-but-possibly-empty
 * arrays, not optional (shape enumeration DA-1): a freshly created dashboard
 * is a first-class valid state, not an exception to special-case downstream.
 */
export const Dashboard = SafeObject({
  version: Version,
  meta: BaseMeta,
  theme: Theme,
  sources: Type.Array(Source),
  queries: Type.Array(Query),
  charts: Type.Array(Chart),
  layout: Layout,
});
export type Dashboard = Static<typeof Dashboard>;
