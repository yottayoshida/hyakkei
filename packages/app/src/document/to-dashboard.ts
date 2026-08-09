import {
  CURRENT_VERSION,
  type BaseMeta,
  type Chart,
  type Dashboard,
  type Layout,
  type Query,
  type Source,
  type Theme,
} from "@hyakkei/schema";
import type { WorkspaceSource } from "../App.js";
import type { WorkspaceQuery } from "../intake/types.js";
import { assertNoRuntimeKeys } from "./assert-no-runtime-keys.js";
import {
  assertSerializableAdditiveFields,
  assertSerializableQueryAdditiveFields,
} from "./additive-fields.js";

export type ToDashboardInput = {
  meta: BaseMeta;
  theme: Theme;
  sources: WorkspaceSource[];
  queries: WorkspaceQuery[];
  charts: Chart[];
  layout: Layout;
  documentExtras?: Record<string, unknown>;
  queryExtras?: ReadonlyMap<string, Record<string, unknown>>;
};

/**
 * `WorkspaceSource` -> `Source` (issue #15/F7). `source.sample.spec`
 * already IS the exact schema shape (`IntakeSample.spec`, `intake/
 * types.ts`) -- the only assembly needed is folding the editor's own
 * `typeOverrides` array back onto it. `typeOverrides` is omitted (not
 * emitted as `[]`) when empty (yotta decision, shape enumeration R2):
 * `dashboard.test.ts` pins absent and `[]` as distinct states, and
 * `buildFileSpec`/`buildUrlSpec` never put an empty array there
 * themselves, so the projection doesn't invent a key they didn't.
 *
 * Named field assignment throughout this module -- never `{...source}` /
 * `{...query}` -- is the primary defense `assertNoRuntimeKeys` (called once
 * on the whole assembled document, not per-field) backs up: T1's leak path
 * requires spreading a `WorkspaceSource`/`WorkspaceQuery` object whole, and
 * this module never does that.
 */
function projectSource(source: WorkspaceSource): Source {
  const { spec } = source.sample;
  const { typeOverrides } = source;
  if (typeOverrides.length === 0) return spec;
  return { ...spec, typeOverrides } as Source;
}

/** `WorkspaceQuery` -> `Query` (issue #15/F7). Named assignment of the 4 schema-known fields only -- every other `WorkspaceQuery` field is runtime-only preview/diagnostics state `assertNoRuntimeKeys`'s deny list also covers. */
function projectQuery(query: WorkspaceQuery, additiveFields?: Record<string, unknown>): Query {
  return {
    ...additiveFields,
    id: query.id,
    source: query.sourceTableId,
    sql: query.sql,
    builderState: query.builderState,
  };
}

/**
 * Projects the editor's persisted-shape state slices into a `Dashboard`
 * (issue #15/F7). Pure -- no React, no DuckDB, no I/O -- so it is directly
 * property-testable (`to-dashboard.test.ts`).
 *
 * `charts`/`layout` are emitted VERBATIM, not rebuilt: both are already
 * held in editor state in their exact schema shape (App.tsx's `charts`/
 * `layout` `useState` slices ARE `Chart[]`/`Layout`), so re-literal-ing them
 * here would be the exact spread-avoidance this module exists to enforce,
 * pointed at the wrong target -- these two don't need it, they need to be
 * passed through untouched. This also satisfies shape enumeration A7:
 * `layout` must never be re-packed here, because PR-2b's unedited-layout
 * verbatim-save shortcut depends on `layout`'s object identity surviving
 * unchanged from whatever `fromDashboard` last installed.
 *
 * Callers are responsible for pre-save validation (an empty `meta.title`,
 * an empty `Query.sql`) -- this function does not reject either; both are
 * schema-invalid (`NonEmptyString`), so `parseDashboard(toDashboard(...))`
 * fails on them the same way it would on any other malformed document
 * (V-020's own self-check), rather than this function duplicating that
 * validation with a second, divergent rule set.
 */
export function toDashboard(input: ToDashboardInput): Dashboard {
  assertSerializableAdditiveFields(input.documentExtras ?? {}, "$.documentExtras");
  assertSerializableQueryAdditiveFields(input.queryExtras);
  const knownDocument: Dashboard = {
    version: CURRENT_VERSION,
    meta: input.meta,
    theme: input.theme,
    sources: input.sources.map(projectSource),
    queries: input.queries.map((query) => projectQuery(query, input.queryExtras?.get(query.id))),
    charts: input.charts,
    layout: input.layout,
  };
  assertNoRuntimeKeys(knownDocument);
  const document = { ...input.documentExtras, ...knownDocument } as Dashboard;
  return document;
}
