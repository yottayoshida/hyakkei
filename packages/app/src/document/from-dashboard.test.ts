import { describe, expect, it } from "vitest";
import { fromDashboard } from "./from-dashboard.js";
import { toDashboard } from "./to-dashboard.js";

const DOC = {
  version: 1 as const,
  meta: { title: "再接続テスト" },
  theme: {
    tokens: "@digital-go-jp/design-tokens@2.0.1" as const,
    palette: "guidebook-blue" as const,
  },
  sources: [
    { id: "s1", kind: "file" as const, format: "csv" as const, ref: { name: "sales.csv" } },
  ],
  queries: [
    {
      id: "q1",
      source: "s1",
      sql: 'SELECT "部署" FROM "s1"',
      builderState: { filters: [], groupBy: ["部署"], measures: [] },
    },
  ],
  charts: [
    {
      id: "c1",
      type: "bar" as const,
      query: "q1",
      encoding: { x: "部署", y: "部署" },
      options: {},
    },
  ],
  layout: { grid: "guidebook-12col" as const, items: [{ chart: "c1", x: 0, y: 0, w: 6, h: 4 }] },
};

describe("fromDashboard", () => {
  it("projects persisted state and marks sources disconnected without inventing rows", () => {
    const state = fromDashboard(DOC);
    expect(state.meta).toEqual(DOC.meta);
    expect(state.queries[0]?.previewPending).toBe(false);
    expect(state.queries[0]?.previewError).toBeNull();
    expect(state.sources[0]?.disconnected).toBe(true);
    expect(state.sources[0]?.sample.rows).toEqual([]);
    expect(state.sources[0]?.sample.spec).toEqual(DOC.sources[0]);
    expect(state.charts).toEqual(DOC.charts);
    expect(state.layout).toEqual(DOC.layout);
  });

  it("extracts additive root and query fields for an editor round-trip", () => {
    const withFutureFields = {
      ...DOC,
      futureRoot: { enabled: true },
      queries: [{ ...DOC.queries[0]!, futureQuery: { mode: "v2" } }],
    } as unknown as Parameters<typeof fromDashboard>[0];

    const state = fromDashboard(withFutureFields);

    expect(state.documentExtras).toEqual({ futureRoot: { enabled: true } });
    expect(state.queryExtras).toEqual(new Map([["q1", { futureQuery: { mode: "v2" } }]]));
  });

  it("keeps additive fields through the complete open-to-save projection", () => {
    const withFutureFields = {
      ...DOC,
      futureRoot: { enabled: true },
      queries: [{ ...DOC.queries[0]!, futureQuery: { mode: "v2" } }],
    } as unknown as Parameters<typeof fromDashboard>[0];

    const saved = toDashboard(fromDashboard(withFutureFields));

    expect(saved).toHaveProperty("futureRoot", { enabled: true });
    expect(saved.queries[0]).toHaveProperty("futureQuery", { mode: "v2" });
  });
});
