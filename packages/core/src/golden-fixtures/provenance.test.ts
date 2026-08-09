import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import provenance from "./data/provenance.json" with { type: "json" };

describe("golden fixture provenance", () => {
  it("pins the official source table and exact normalized snapshot bytes", () => {
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
});
