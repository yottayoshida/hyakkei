import {
  Type,
  type ObjectOptions,
  type Static,
  type TProperties,
  type TSchema,
} from "@sinclair/typebox";

/**
 * `__proto__`/`constructor`/`prototype` as a property name (shape enumeration
 * AA-12) don't pollute the object *as parsed by `JSON.parse`* — modern
 * engines create it as a normal own property, not a prototype swap — but a
 * later unsafe recursive merge (bracket assignment in a loop, rather than
 * spread/`Object.assign`) elsewhere in the codebase could still turn it into
 * one. Rejecting these key names in every config object closes that door now
 * regardless of what merge code is written later, rather than relying on
 * every future call site independently choosing a safe merge strategy.
 */
const SAFE_PROPERTY_NAMES = Type.Not(
  Type.Union([Type.Literal("__proto__"), Type.Literal("constructor"), Type.Literal("prototype")]),
);

// PascalCase (not camelCase) is deliberate here and on the other schema-
// builder helpers below (SafeRecord, ForbidFields): these are drop-in
// extensions of TypeBox's own Type.Object/Type.Union/... naming convention,
// called the same way and interchangeably with them throughout this file —
// camelCase would read as a different kind of thing at every call site.
export function SafeObject<T extends TProperties>(properties: T, options?: ObjectOptions) {
  return Type.Object(properties, { ...options, propertyNames: SAFE_PROPERTY_NAMES });
}

/**
 * For dynamic-key objects (e.g. a baked row, keyed by source column names)
 * where `SafeObject`'s named-`properties` shape doesn't apply. Deliberately
 * NOT `Type.Record`: TypeBox's `Type.Record(Type.String(), V)` compiles to
 * `patternProperties: {"^(.*)$": V}` with no `propertyNames` guard at all —
 * `.` doesn't match line-terminator characters without the regex `s` flag,
 * so a key containing an embedded newline fails to match that pattern and
 * its value is left completely unconstrained (caught by `/code-review`:
 * both a `__proto__` key and a newline-containing key with a non-primitive
 * value passed real Ajv validation before this fix). `additionalProperties:
 * V` instead of `patternProperties` checks every key's value unconditionally
 * — there is no pattern to route around.
 */
export function SafeRecord<V extends TSchema>(valueSchema: V) {
  // Type.Unsafe: `Type.Object({}, {additionalProperties: valueSchema})` runs
  // correctly (Ajv validates every key against valueSchema, confirmed above)
  // but its OWN Static<> inference collapses to `{}` — TypeBox only widens
  // object schemas to an index signature via `Type.Record`, which is exactly
  // the constructor this function exists to avoid at the JSON Schema level.
  // Type.Unsafe supplies the JSON Schema as-is while asserting the type this
  // function's callers actually need: an index signature over `valueSchema`.
  return Type.Unsafe<Record<string, Static<V>>>({
    type: "object",
    additionalProperties: valueSchema,
    propertyNames: SAFE_PROPERTY_NAMES,
  });
}

/**
 * The "forbid these specific fields while staying additive elsewhere" idiom
 * (shape enumeration AB-4) — one level up from `SafeObject`'s "forbid these
 * specific *property names* everywhere." Each call site names the exact
 * fields that must never ride along on a given object (e.g. authoring-only
 * `sources`/`queries` on a baked artifact), without closing the object to
 * other, genuinely unknown, forward-compat fields the way
 * `additionalProperties: false` would.
 */
export function ForbidFields(...fields: string[]) {
  return Type.Not(
    Type.Union(
      fields.map((field) => Type.Object({ [field]: Type.Unknown() }, { required: [field] })),
    ),
  );
}

/** Shared, since almost every id/name/sql/title field in this schema needs it. */
export const NonEmptyString = Type.String({ minLength: 1 });

/**
 * Restricts `Source.id`/`Query.source` (dashboard.ts) to strings that are
 * always safe to embed as an unquoted DuckDB identifier: ASCII
 * letter-or-underscore start, then letters/digits/underscores, bounded
 * length. These two fields are the one place a schema string becomes a table
 * name an *author's own SQL text* references verbatim (e.g. `FROM apps`), so
 * unlike the rest of this schema's free-string fields, injection syntax
 * (spaces, quotes, semicolons, pipes — none are in the character class) must
 * be structurally unrepresentable rather than merely discouraged. This does
 * NOT apply to CSV/xlsx column names or cell values (data, not author-typed
 * identifiers) — those stay unrestricted and are quoted downstream by DuckDB.
 *
 * What this pattern alone cannot catch: SQL reserved words (`select`,
 * `from`, ...) — every letter of a keyword is itself a valid identifier
 * character, so no character-class regex can exclude keyword membership.
 * That check lives in validate.ts (`checkReservedWord`), scoped to
 * `Source.id` only, not `Query.source` — see that file for why (in short:
 * `Query.source` never introduces a *new* reserved-word risk beyond what
 * checking `Source.id` at declaration time already covers) and for why
 * quoting generated SQL, not this list, is the primary defense.
 */
export const SqlIdentifier = Type.String({
  pattern: "^[A-Za-z_][A-Za-z0-9_]*$",
  maxLength: 64,
});

/**
 * Additive-only within version 1: unknown fields must survive round-trips, so
 * nothing in this module sets `additionalProperties: false` (`ChartOptions`
 * below is the one deliberate exception — see its own comment). A future
 * major version bump is a distinct, non-additive event handled by version
 * rejection in validate.ts, not by this schema. `CURRENT_VERSION` is the one
 * source of truth for "1" — `Version` and validate.ts's rejection check both
 * derive from it instead of each hardcoding the literal separately.
 */
export const CURRENT_VERSION = 1 as const;
export const Version = Type.Literal(CURRENT_VERSION);

/**
 * Allowlists, not free strings (shape enumeration AA-3/AB-3): a free-string
 * token/palette value that ever gets resolved as a module specifier or file
 * path is an RCE vector. Extending either list is a pure additive change.
 */
export const TokenPackage = Type.Union([Type.Literal("@digital-go-jp/design-tokens@2.0.0")]);
export type TokenPackage = Static<typeof TokenPackage>;

export const Palette = Type.Union([
  Type.Literal("guidebook-blue"),
  Type.Literal("guidebook-green"),
  Type.Literal("guidebook-neutral"),
]);
export type Palette = Static<typeof Palette>;

export const Theme = SafeObject({
  tokens: TokenPackage,
  palette: Palette,
});
export type Theme = Static<typeof Theme>;

export const Grid = Type.Union([Type.Literal("guidebook-12col")]);
export type Grid = Static<typeof Grid>;

/**
 * One source of truth for grid width, keyed by `Grid`'s own literal values —
 * both `LayoutItem`'s schema bounds below and validate.ts's cross-field
 * `x + w <= width` check read from this, instead of each hardcoding `12`
 * independently (`/code-review` flagged 3 independent copies of the same
 * fact as a silent-failure risk: adding a second `Grid` literal wouldn't
 * error anywhere, it would just validate every document against the wrong
 * width). `satisfies Record<Grid["const"] extends never ? never : string,
 * number>`-style exhaustiveness isn't practical here since `Grid` is a
 * TypeBox union, not a plain TS union — this object is instead the thing
 * `Grid`'s own literals must be added to together, by convention and by
 * `validateLayoutReferences` throwing if a grid name isn't present.
 */
export const GRID_WIDTHS = { "guidebook-12col": 12 } as const;

/**
 * `x`'s own maximum (one less than the grid width) only rules out a single
 * item starting outside the grid; it cannot express `x + w <= width` — that
 * cross-field bound is checked in validate.ts's referential validator
 * (shape enumeration AA-8), alongside item-vs-item overlap, since JSON Schema
 * has no keyword for "the sum of two sibling fields."
 */
const GUIDEBOOK_12COL_WIDTH = GRID_WIDTHS["guidebook-12col"];
export const LayoutItem = SafeObject({
  chart: NonEmptyString,
  x: Type.Integer({ minimum: 0, maximum: GUIDEBOOK_12COL_WIDTH - 1 }),
  y: Type.Integer({ minimum: 0 }),
  w: Type.Integer({ minimum: 1, maximum: GUIDEBOOK_12COL_WIDTH }),
  h: Type.Integer({ minimum: 1 }),
});
export type LayoutItem = Static<typeof LayoutItem>;

export const Layout = SafeObject({
  grid: Grid,
  items: Type.Array(LayoutItem),
});
export type Layout = Static<typeof Layout>;

/**
 * No `maxLength`/pattern on `title`/`description`/`locale` (deliberate, not
 * an oversight — QA flagged this as worth stating explicitly, unlike the
 * other security-relevant fields in this file): unlike `ChartOptions`/
 * `theme.tokens`, plain display text is not an injection surface here — it's
 * rendered as text, sanitized at render time, and any pre-parse size cap
 * belongs at the byte-count level (M0 finding), not as a per-field character
 * limit that would need re-tuning per field.
 */
export const BaseMeta = SafeObject({
  title: NonEmptyString,
  description: Type.Optional(Type.String()),
  locale: Type.Optional(Type.String()),
});
export type BaseMeta = Static<typeof BaseMeta>;

/**
 * A declarative allowlist subset of ECharts option shape — deliberately NOT a
 * passthrough to ECharts. `tooltip.formatter` and `renderMode: 'html'` /
 * rich-text HTML interpret raw HTML at render time (shape enumeration
 * AA-4/AB-2, Apache ECharts security guidelines) — anything not enumerated
 * here cannot be expressed, by construction, so there is nowhere for a
 * formatter-style XSS payload to go. `additionalProperties: false` applies at
 * **every** nesting level here, not just the top level — a closed allowlist
 * with an open nested object (e.g. `legend`) is not closed at all.
 *
 * Unlike the rest of this schema, this object (and its nested objects) sets
 * `additionalProperties: false` deliberately — it is a closed security
 * allowlist, not a forward-compat surface. A denylist of dangerous key names
 * (`formatter`, `renderMode`, ...) would be weaker: it only blocks names we
 * thought of today. A future *safe* declarative option is still an additive
 * schema change; an older hyakkei rejecting a newer file that uses it is a
 * reasonable "please upgrade" edge, not a bug — unlike the rest of the
 * document, chart options affect rendering directly, so silently ignoring an
 * unrecognized one is not obviously safer than rejecting it.
 */
export const ChartOptions = Type.Object(
  {
    title: Type.Optional(Type.String()),
    legend: Type.Optional(
      Type.Object(
        {
          show: Type.Optional(Type.Boolean()),
          position: Type.Optional(
            Type.Union([
              Type.Literal("top"),
              Type.Literal("bottom"),
              Type.Literal("left"),
              Type.Literal("right"),
            ]),
          ),
        },
        { additionalProperties: false },
      ),
    ),
    xAxisLabelRotate: Type.Optional(Type.Integer({ minimum: -90, maximum: 90 })),
    showDataLabels: Type.Optional(Type.Boolean()),
    donut: Type.Optional(Type.Boolean()),
  },
  { additionalProperties: false },
);
export type ChartOptions = Static<typeof ChartOptions>;

/**
 * One encoding shape per chart type (shape enumeration AA-14: a chart whose
 * `type` and `encoding` disagree — e.g. `pie` with `{x, y}` — is structurally
 * rejectable via this discriminated union, not merely a convention.
 * PRD F3's 7 types: bar, line, area, pie/donut, scatter, table, stat tile.
 */
// Plain property records, not pre-built SafeObjects: chartVariant() below
// wraps `encoding` in SafeObject itself, the same way fileSource() (in
// dashboard.ts) wraps `ref` — so a future 8th chart type cannot forget the
// guard by passing an already-built (and possibly unsafe) object schema.
// TypeScript's structural typing can't catch a caller skipping the wrap if
// the parameter type were "already a TObject"; taking raw properties instead
// makes the wrap unconditional (caught by `/code-review`, mirroring the
// BakedMeta/Type.Composite regression Codex R2 found in the same file).
const XY = { x: NonEmptyString, y: NonEmptyString };
const XYSize = { x: NonEmptyString, y: NonEmptyString, size: Type.Optional(NonEmptyString) };
const CategoryValue = { category: NonEmptyString, value: NonEmptyString };
const Columns = { columns: Type.Array(NonEmptyString, { minItems: 1 }) };
const SingleValue = { value: NonEmptyString };

function chartVariant<ChartType extends string, Encoding extends TProperties>(
  type: ChartType,
  encoding: Encoding,
) {
  return SafeObject({ type: Type.Literal(type), encoding: SafeObject(encoding) });
}

export const ChartVariant = Type.Union([
  chartVariant("bar", XY),
  chartVariant("line", XY),
  chartVariant("area", XY),
  chartVariant("scatter", XYSize),
  chartVariant("pie", CategoryValue),
  chartVariant("table", Columns),
  chartVariant("stat", SingleValue),
]);
export type ChartVariant = Static<typeof ChartVariant>;

/** JSON-representable primitive — what a baked row's cell may hold (dates are strings, per JSON). */
export const JsonPrimitive = Type.Union([
  Type.String(),
  Type.Number(),
  Type.Boolean(),
  Type.Null(),
]);
export type JsonPrimitive = Static<typeof JsonPrimitive>;
