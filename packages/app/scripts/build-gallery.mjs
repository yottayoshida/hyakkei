import { mkdir, rm, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { bake } from "@hyakkei/core/bake";
import { GOLDEN_BAKE_META, GOLDEN_SAMPLES } from "@hyakkei/core/golden-fixtures";
import { buildSingleFileDashboardHtml } from "@hyakkei/export";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const DEFAULT_OUTPUT_DIR = resolve(SCRIPT_DIR, "..", "dist", "gallery");

/**
 * Produces the public gallery at build time. The browser only ever receives
 * static HTML and a same-origin manifest; golden fixtures never enter the
 * editor entry's module graph.
 */
export function createGalleryArtifacts(samples, bakeMeta) {
  const files = new Map();
  const manifest = {
    version: 1,
    samples: samples.map((sample) => {
      const dashboard = bake(sample.doc, sample.rowsByQuery, bakeMeta);
      const href = `${sample.id}.html`;
      files.set(href, buildSingleFileDashboardHtml(dashboard));
      return {
        id: sample.id,
        title: dashboard.meta.title,
        description: dashboard.meta.description,
        href,
      };
    }),
  };
  return { manifest, files };
}

export async function writeGalleryArtifacts(outputDir = DEFAULT_OUTPUT_DIR) {
  const artifacts = createGalleryArtifacts(GOLDEN_SAMPLES, GOLDEN_BAKE_META);
  await rm(outputDir, { recursive: true, force: true });
  await mkdir(outputDir, { recursive: true });
  await Promise.all([
    ...[...artifacts.files].map(([filename, html]) => writeFile(resolve(outputDir, filename), html)),
    writeFile(resolve(outputDir, "manifest.json"), `${JSON.stringify(artifacts.manifest, null, 2)}\n`),
  ]);
  return artifacts.manifest;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await writeGalleryArtifacts();
}
