import type { Dashboard, Source } from "@hyakkei/schema";
import type { WorkspaceSource } from "../App.js";
import type { ColumnOverride, IntakeSample, WorkspaceQuery } from "../intake/types.js";

export type DashboardEditorState = {
  meta: Dashboard["meta"];
  theme: Dashboard["theme"];
  sources: WorkspaceSource[];
  queries: WorkspaceQuery[];
  charts: Dashboard["charts"];
  layout: Dashboard["layout"];
};

function sourceLabel(source: Source): string {
  return source.kind === "url" ? source.ref.url : source.ref.name;
}

function referencedColumns(dashboard: Dashboard, sourceId: string): string[] {
  const names = new Set<string>();
  for (const query of dashboard.queries) {
    if (query.source !== sourceId || !query.builderState) continue;
    for (const filter of query.builderState.filters) names.add(filter.column);
    for (const groupBy of query.builderState.groupBy) names.add(groupBy);
    for (const measure of query.builderState.measures) names.add(measure.column);
  }
  return [...names];
}

function disconnectedSource(dashboard: Dashboard, source: Source): WorkspaceSource {
  const columns = referencedColumns(dashboard, source.id).map((name) => ({
    name,
    type: "VARCHAR",
    category: "text" as const,
  }));
  const sample: IntakeSample = {
    table: { id: source.id, columns, rowCount: 0 },
    rows: [],
    spec: source,
  };
  const typeOverrides: ColumnOverride[] = source.typeOverrides ? [...source.typeOverrides] : [];
  return {
    sourceLabel: sourceLabel(source),
    sample,
    typeOverrides,
    validation: new Map(),
    previewRows: null,
    previewPending: false,
    disconnected: true,
  };
}

function queryPreviewColumns(query: Dashboard["queries"][number]): string[] {
  if (!query.builderState) return [];
  return [
    ...query.builderState.groupBy,
    ...query.builderState.measures.map((measure) => `${measure.aggregate}_${measure.column}`),
  ];
}

export function fromDashboard(dashboard: Dashboard): DashboardEditorState {
  return {
    meta: dashboard.meta,
    theme: dashboard.theme,
    sources: dashboard.sources.map((source) => disconnectedSource(dashboard, source)),
    queries: dashboard.queries.map((query) => ({
      id: query.id,
      sourceTableId: query.source,
      builderState: query.builderState ?? { filters: [], groupBy: [], measures: [] },
      sql: query.sql,
      previewRows: null,
      previewColumns: queryPreviewColumns(query),
      diagnostics: null,
      previewPending: false,
      previewError: null,
    })),
    charts: dashboard.charts,
    layout: dashboard.layout,
  };
}
