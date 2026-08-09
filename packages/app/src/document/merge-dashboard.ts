import type { IntakeSample } from "../intake/types.js";
import type { WorkspaceSource } from "../App.js";

/** Reconnects one source without changing query/chart/layout references. */
export function mergeDashboardSource(
  sources: WorkspaceSource[],
  sourceLabel: string,
  sample: IntakeSample,
): WorkspaceSource[] {
  const sameIdIndex = sources.findIndex((source) => source.sample.table.id === sample.table.id);
  if (sameIdIndex !== -1) {
    // A duplicate registration callback must not create a second card. A
    // disconnected placeholder with the same id can safely be replaced.
    const current = sources[sameIdIndex]!;
    if (!current.disconnected) return sources;
    const next = [...sources];
    next[sameIdIndex] = {
      ...current,
      sourceLabel,
      sample,
      validation: new Map(),
      previewRows: null,
      previewPending: false,
      disconnected: false,
    };
    return next;
  }

  // When source-id allocation correctly avoids the placeholder's reserved
  // id, keep both cards for one render. App's reattach effect then migrates
  // query foreign keys and removes the placeholder atomically.
  if (sources.some((source) => source.disconnected && source.sourceLabel === sourceLabel)) {
    return [
      ...sources,
      {
        sourceLabel,
        sample,
        typeOverrides: [],
        validation: new Map(),
        previewRows: null,
        previewPending: false,
      },
    ];
  }

  return [
    ...sources,
    {
      sourceLabel,
      sample,
      typeOverrides: [],
      validation: new Map(),
      previewRows: null,
      previewPending: false,
    },
  ];
}
