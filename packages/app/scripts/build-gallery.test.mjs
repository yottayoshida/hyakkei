import { describe, expect, it } from "vitest";
import { GOLDEN_BAKE_META, GOLDEN_SAMPLES } from "@hyakkei/core/golden-fixtures";
import { createGalleryArtifacts } from "./build-gallery.mjs";

describe("createGalleryArtifacts", () => {
  it("bakes each fixed gallery sample into an offline, single-file HTML artifact", () => {
    const artifacts = createGalleryArtifacts(GOLDEN_SAMPLES, GOLDEN_BAKE_META);

    expect(artifacts.manifest.samples.map((sample) => sample.id)).toEqual([
      "applications",
      "budget",
      "regional",
    ]);
    expect(artifacts.manifest.samples.map((sample) => sample.href)).toEqual([
      "applications.html",
      "budget.html",
      "regional.html",
    ]);
    expect(artifacts.files.get("applications.html")).toContain("<!doctype html>");
    expect(artifacts.files.get("applications.html")).toContain("都道府県別人口");
    expect(artifacts.files.get("applications.html")).not.toMatch(/(?:src|href)="https?:\/\//);
  });
});
