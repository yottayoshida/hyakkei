import type { IntakeSample } from "../intake/types.js";
import type { WorkspaceSource } from "../App.js";

/** Reconnects one source without changing query/chart/layout references. */
export function mergeDashboardSource(
  sources: WorkspaceSource[],
  sourceLabel: string,
  sample: IntakeSample,
): WorkspaceSource[] {
  const index = sources.findIndex((source) => source.sample.table.id === sample.table.id);
  if (index === -1) {
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
  const next = [...sources];
  const current = next[index]!;
  next[index] = {
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
