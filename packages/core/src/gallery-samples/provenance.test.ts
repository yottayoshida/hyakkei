import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import provenance from "./data/provenance.json" with { type: "json" };
import { GALLERY_SAMPLES } from "./gallery-samples.js";

describe("gallery sample provenance", () => {
  it("pins the official source table and exact normalized snapshot bytes", () => {
    // Guards the loop below against passing because there was nothing to check.
    expect(provenance.sources.length).toBe(GALLERY_SAMPLES.length);

    for (const source of provenance.sources) {
      const csv = readFileSync(
        new URL(`./data/${source.snapshot.split("/").at(-1)}`, import.meta.url),
      );
      const digest = createHash("sha256").update(csv).digest("hex");
      expect(digest, `${source.sampleId} normalized snapshot hash`).toBe(
        source.normalizedCsvSha256,
      );
      expect(source.url).toMatch(/^https:\/\/www\.e-stat\.go\.jp\/dbview\?sid=000001020[134]$/);
      expect(source.tableId).toMatch(/^000001020[134]$/);
    }
  });

  it("records a real survey year for every snapshot, not a placeholder", () => {
    // The gallery shipped with `surveyYear: "画面表示値"` on two of three
    // snapshots -- the field existed but said only "whatever the screen showed",
    // so the published dashboards cited an e-Stat table without being able to
    // say which year's column they had taken. Reading the pages settled it
    // (all three default to 1975年度); this keeps the answer from being lost
    // again, and keeps a future re-acquisition from landing without one.
    for (const source of provenance.sources) {
      expect(source.surveyYear, `${source.sampleId} survey year`).toMatch(/^\d{4}年度?$/);
    }
  });

  it("covers exactly the samples the gallery publishes", () => {
    // A snapshot whose sampleId matches no sample is dead provenance; a sample
    // with no snapshot is an uncited public dashboard. Both are silent today
    // because nothing joins the two lists.
    expect([...provenance.sources].map((s) => s.sampleId).sort()).toEqual(
      [...GALLERY_SAMPLES].map((s) => s.id).sort(),
    );
  });

  it("cites its source table inside each dashboard, not only in this file", () => {
    // `provenance.json` never reaches a reader; `meta.sourceNote` and the
    // source ref do. Issue #124's provenance work is only honoured if the
    // table id travels with the document a third party opens.
    for (const sample of GALLERY_SAMPLES) {
      const recorded = provenance.sources.find((s) => s.sampleId === sample.id);
      expect(recorded, `${sample.id} has a provenance entry`).toBeDefined();
      expect(sample.doc.meta.sourceNote, `${sample.id} sourceNote`).toContain(recorded!.tableId);
      expect(sample.doc.meta.sourceNote, `${sample.id} sourceNote`).toContain(recorded!.surveyYear);
    }
  });
});
