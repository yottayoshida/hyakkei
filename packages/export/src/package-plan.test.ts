import { describe, expect, it } from "vitest";
import { planDashboardExport, SINGLE_FILE_EXPORT_MAX_BYTES } from "./package-plan.js";

const DASHBOARD = {
  version: 1 as const,
  meta: {
    title: "サイズ判定",
    generatedAt: "2026-08-09T00:00:00.000Z",
    sourceDataAsOf: "2026-08-09",
    hyakkeiVersion: "0.1.0",
  },
  theme: {
    tokens: "@digital-go-jp/design-tokens@2.0.1" as const,
    palette: "guidebook-blue" as const,
  },
  charts: [],
  layout: { grid: "guidebook-12col" as const, items: [] },
};

describe("planDashboardExport", () => {
  it("uses exact UTF-8 bytes and keeps a small export below 20 MiB", () => {
    const plan = planDashboardExport(DASHBOARD);
    expect(plan.bytes).toBe(new TextEncoder().encode(plan.html).byteLength);
    expect(plan.exceedsSingleFileLimit).toBe(false);
    expect(SINGLE_FILE_EXPORT_MAX_BYTES).toBe(20 * 1024 * 1024);
  });

  it("crosses an injected threshold deterministically", () => {
    const plan = planDashboardExport(DASHBOARD, 1);
    expect(plan.exceedsSingleFileLimit).toBe(true);
  });

  it("accepts the exact measured boundary and rejects one byte above it", () => {
    const measured = planDashboardExport(DASHBOARD);
    expect(planDashboardExport(DASHBOARD, measured.bytes).exceedsSingleFileLimit).toBe(false);
    expect(planDashboardExport(DASHBOARD, measured.bytes - 1).exceedsSingleFileLimit).toBe(true);
  });
});
