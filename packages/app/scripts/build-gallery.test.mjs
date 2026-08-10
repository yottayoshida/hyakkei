import { describe, expect, it } from "vitest";
import { GALLERY_BAKE_META, GALLERY_SAMPLES } from "@hyakkei/core/gallery-samples";
import { createGalleryArtifacts } from "./build-gallery.mjs";

describe("createGalleryArtifacts", () => {
  it("bakes each fixed gallery sample into an offline, single-file HTML artifact", () => {
    const artifacts = createGalleryArtifacts(GALLERY_SAMPLES, GALLERY_BAKE_META);

    expect(artifacts.manifest.samples.map((sample) => sample.id)).toEqual([
      "population",
      "economy",
      "administration",
    ]);
    expect(artifacts.manifest.samples.map((sample) => sample.href)).toEqual([
      "population.html",
      "economy.html",
      "administration.html",
    ]);
    expect(artifacts.files.get("population.html")).toContain("<!doctype html>");
    expect(artifacts.files.get("population.html")).toContain("都道府県別人口");
    expect(artifacts.files.get("population.html")).not.toMatch(/(?:src|href)="https?:\/\//);
  });

  it("publishes the survey year inside every artifact a reader opens", () => {
    // The gallery's whole claim is that a third party can check the numbers.
    // A table id with no year does not let them: the same e-Stat table serves
    // 50 survey years at the same URL.
    const artifacts = createGalleryArtifacts(GALLERY_SAMPLES, GALLERY_BAKE_META);
    for (const sample of artifacts.manifest.samples) {
      expect(artifacts.files.get(sample.href), `${sample.id} artifact`).toContain("1975年度");
    }
  });
});
