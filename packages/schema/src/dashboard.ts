import { Type, type Static, type TProperties } from "@sinclair/typebox";
import {
  BaseMeta,
  ChartOptions,
  ChartVariant,
  Layout,
  NonEmptyString,
  SafeObject,
  SqlIdentifier,
  Theme,
  Version,
} from "./common.js";

/**
 * The 3 semantic categories a column-type override (issue #11b) can assign,
 * mirrored exactly from `@hyakkei/core/datasource`'s `ColumnCategory` (not
 * imported — `packages/schema` has no runtime dependency on
 * `packages/core`, and this union's whole point is to be the one place a
 * category value is trusted as a closed enum before it ever reaches a
 * generated `CAST` target-type position; see that package's `column-types.ts`
 * for the corresponding `CAST_TARGET` lookup). A category value outside this
 * union (a raw DuckDB type name, a SQL fragment, anything free-text) is
 * rejected by Ajv before any SQL is built — the load-bearing control, not
 * `quoteIdentifier`-style escaping, which cannot make a *type* position safe.
 */
export const ColumnType = Type.Union([
  Type.Literal("text"),
  Type.Literal("number"),
  Type.Literal("date"),
]);
export type ColumnType = Static<typeof ColumnType>;

/**
 * Delta-only (issue #11b): a source's `typeOverrides` lists only the columns
 * a user has explicitly overridden, not every detected column — detection
 * itself is a runtime computation (re-derived from the live registered
 * table each session), not something this document persists, so it cannot
 * go stale relative to data the user later swaps in. An array, not a
 * column-name-keyed object/`SafeRecord`: column names are data (can
 * legally be `__proto__`/`constructor`/whitespace/CJK), and keeping them out
 * of JS-object-key position removes the prototype-pollution surface a
 * keyed form would otherwise need a property-name guard for. Duplicate
 * `column` entries are schema-valid (arrays permit them); the runtime
 * resolves ambiguity as last-wins and surfaces an advisory (ADR-0011).
 */
const TypeOverrideEntry = SafeObject({ column: NonEmptyString, category: ColumnType });

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
 *
 * `typeOverrides` (issue #11b) sits at this top level, a sibling of `ref`,
 * not nested inside it: it is format-independent shaping applied after
 * registration, not part of any one format's own ingestion parameters —
 * every `Source` variant (including `UrlSource` below) produces a queryable
 * table, so all of them can carry it the same way.
 */
function fileSource<Format extends string, Ref extends TProperties>(
  format: Format,
  refProperties: Ref,
) {
  return SafeObject({
    id: SqlIdentifier,
    kind: Type.Literal("file"),
    format: Type.Literal(format),
    ref: SafeObject(refProperties),
    typeOverrides: Type.Optional(Type.Array(TypeOverrideEntry)),
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
  id: SqlIdentifier,
  kind: Type.Literal("url"),
  format: Type.Union([Type.Literal("csv"), Type.Literal("parquet")]),
  ref: SafeObject({
    // Scheme allowlist (shape enumeration AA-11): a bare `format: "uri"` check
    // alone accepts `file://` and other non-http(s) schemes, which is an SSRF
    // adjacent local-read vector once resolved by the editor's fetch layer.
    //
    // Deliberately case-sensitive-lowercase-only (`^https://`, not
    // `^[Hh][Tt]...`): this is the *authoring* shape, and a hand-written
    // `HTTPS://` is worth bouncing back to the author to fix, not silently
    // accepting. `EgressPolicy` (packages/core/src/datasource/egress-
    // policy.ts) — the network chokepoint that actually resolves this URL —
    // is deliberately more lenient (parses with `new URL()`, so a
    // mixed-case scheme normalizes and is not rejected on that basis alone):
    // it must not trust that this schema already ran, so it re-derives
    // safety from the parsed URL rather than from this pattern having
    // matched. The two layers disagreeing on `HTTPS://` is intentional, not
    // a bug — reject early and precisely at authoring time; re-verify from
    // first principles at the network chokepoint (Codex review, PR-A1).
    url: Type.String({ format: "uri", pattern: "^https://" }),
  }),
  typeOverrides: Type.Optional(Type.Array(TypeOverrideEntry)),
});

export const Source = Type.Union([FileSourceXlsx, FileSourceCsv, FileSourceParquet, UrlSource]);
export type Source = Static<typeof Source>;

/**
 * The closed comparison-operator set the light-shaping GUI's filter builder
 * offers (issue #11c). Like `ColumnType`, this exists so a category value
 * never reaches the WHERE-clause operator position as free text — that
 * position is exactly as unescapable as the CAST type position ADR-0011
 * already established this project cannot make safe with quoting alone.
 * `is_null`/`is_not_null` need no `value` at all (see `FilterCondition`);
 * `contains`/`not_contains` compile to `LIKE`/`NOT LIKE` with the value
 * escaped against SQL wildcards (`packages/core/src/datasource/
 * query-sql.ts`'s `likePatternLiteral`).
 */
export const FilterOperator = Type.Union([
  Type.Literal("eq"),
  Type.Literal("ne"),
  Type.Literal("lt"),
  Type.Literal("lte"),
  Type.Literal("gt"),
  Type.Literal("gte"),
  Type.Literal("contains"),
  Type.Literal("not_contains"),
  Type.Literal("is_null"),
  Type.Literal("is_not_null"),
]);
export type FilterOperator = Static<typeof FilterOperator>;

/** Closed aggregate-function set (sum/count/avg only, per PRD F2) — same closed-position rationale as `FilterOperator`. */
export const AggregateFn = Type.Union([
  Type.Literal("sum"),
  Type.Literal("count"),
  Type.Literal("avg"),
]);
export type AggregateFn = Static<typeof AggregateFn>;

/**
 * `value` is optional: absent means "this condition is not yet complete,
 * exclude it from the query" for every operator that needs a value (the
 * light-shaping GUI's own "an incomplete filter doesn't affect results yet"
 * behavior) — `is_null`/`is_not_null` never use `value` at all, complete or
 * not. `value: ""` (empty string) is a DIFFERENT, complete, meaningful
 * condition ("matches a blank cell") and is never conflated with an absent
 * value (shape enumeration G4).
 */
const FilterCondition = SafeObject({
  column: NonEmptyString,
  operator: FilterOperator,
  value: Type.Optional(Type.String()),
});
export type FilterCondition = Static<typeof FilterCondition>;

const Measure = SafeObject({ column: NonEmptyString, aggregate: AggregateFn });
export type Measure = Static<typeof Measure>;

/**
 * The light-shaping GUI's structured selection state (issue #11c),
 * compiled into `Query.sql` by `packages/core/src/datasource/query-sql.ts`.
 * Persisted structurally (not just the compiled SQL) so a user can reopen
 * and re-edit their filter/groupBy/measure choices later — an opaque SQL
 * string alone cannot be safely reverse-parsed back into GUI selections
 * (independently confirmed necessary by both the UX and security
 * investigations for this PR).
 *
 * All three arrays are required (not `Type.Optional` each) — only the
 * whole `builderState` object is optional on `Query`. This makes `{}` (all
 * three missing) Ajv-invalid, distinct from `{filters:[],groupBy:[],
 * measures:[]}` (all three present but empty, a legitimate "nothing
 * configured yet" state) — shape enumeration G1.
 *
 * `groupBy` is an array of column-name values, never a column-name-keyed
 * object — same array-shaped, no-JS-object-key-position principle
 * `TypeOverrideEntry` already established, since a column can legally be
 * named `__proto__`/`constructor`/`prototype`.
 */
const BuilderState = SafeObject({
  filters: Type.Array(FilterCondition),
  groupBy: Type.Array(NonEmptyString),
  measures: Type.Array(Measure),
});
export type BuilderState = Static<typeof BuilderState>;

export const Query = SafeObject({
  id: NonEmptyString,
  // `source` is a `Source.id` FK an author's own SQL text also references
  // verbatim (e.g. `FROM apps`) — same SQL-identifier constraint as
  // `Source.id` itself (common.ts's `SqlIdentifier` doc comment). `Query.id`
  // is left unrestricted: unlike `source`, it is never embedded in generated
  // or user-authored SQL text, only used as an opaque cross-reference key
  // (`Chart.query`), so restricting it would add authoring friction (e.g.
  // rejecting a Japanese or reserved-word-shaped query id) without a
  // corresponding injection surface to close.
  source: SqlIdentifier,
  // Intentionally opaque: schema does not parse or validate SQL semantics.
  // A malicious query (e.g. reaching for httpfs) is a real risk but is
  // contained at the network layer (CSP connect-src, verified in
  // docs/spikes/m0-containment.md), not by rejecting suspicious-looking SQL
  // text here — schema-level SQL sniffing would be both incomplete and a
  // false sense of security (shape enumeration AA-5).
  sql: NonEmptyString,
  // Additive (issue #11c). When present, `sql` is its compiled output —
  // the editor recompiles both together on every builderState edit so they
  // never drift; a `Query` with no `builderState` is a hand-authored/
  // pre-#11c query and is read-only from the light-shaping GUI's
  // perspective (there is nothing to reverse-compile it from).
  builderState: Type.Optional(BuilderState),
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
    altText: Type.Optional(
      Type.String({
        description:
          "A concise text alternative that communicates the chart's purpose and main takeaway without requiring the visual chart or its data table.",
      }),
    ),
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
