import { describe, expect, it } from "vitest";
import { ARCHIVE_PATHS, buildExportFolderZip } from "./download-export-folder.js";

const DASHBOARD = {
  version: 1 as const,
  meta: {
    title: "ZIP検証",
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

describe("folder export archive layout", () => {
  it("has exactly the three portable viewer files at fixed paths", () => {
    expect(ARCHIVE_PATHS).toEqual(["index.html", "renderer.js", "dashboard.json"]);
  });

  it("writes exactly the three fixed paths into the ZIP archive", async () => {
    const blob = await buildExportFolderZip(DASHBOARD);
    const { default: JSZip } = await import("jszip");
    const zip = await JSZip.loadAsync(await blob.arrayBuffer());
    expect(Object.keys(zip.files)).toEqual(["index.html", "renderer.js", "dashboard.json"]);
  });
});
