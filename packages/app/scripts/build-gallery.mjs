import { mkdir, rm, writeFile } from "node:fs/promises";
import { argv } from "node:process";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { bake } from "@hyakkei/core/bake";
import { GALLERY_BAKE_META, GALLERY_SAMPLES } from "@hyakkei/core/gallery-samples";
import { buildSingleFileDashboardHtml } from "@hyakkei/export";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const DEFAULT_OUTPUT_DIR = resolve(SCRIPT_DIR, "..", "dist", "gallery");

/**
 * Produces the public gallery at build time. The browser only ever receives
 * static HTML and a same-origin manifest; gallery samples never enter the
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
        source: sourceLabel(sample.doc),
        href,
      };
    }),
  };
  return { manifest, files };
}

function sourceLabel(document) {
  const source = document.sources?.[0];
  const ref = source?.ref;
  const tableId = typeof ref?.tableId === "string" ? ref.tableId : "不明";
  const url = typeof ref?.url === "string" ? ref.url : "";
  return { publisher: "e-Stat", tableId, url };
}

export async function writeGalleryArtifacts(outputDir = DEFAULT_OUTPUT_DIR) {
  const artifacts = createGalleryArtifacts(GALLERY_SAMPLES, GALLERY_BAKE_META);
  await rm(outputDir, { recursive: true, force: true });
  await mkdir(outputDir, { recursive: true });
  await Promise.all([
    ...[...artifacts.files].map(([filename, html]) =>
      writeFile(resolve(outputDir, filename), html),
    ),
    writeFile(
      resolve(outputDir, "manifest.json"),
      `${JSON.stringify(artifacts.manifest, null, 2)}\n`,
    ),
  ]);
  return artifacts.manifest;
}

if (argv[1] && import.meta.url === pathToFileURL(argv[1]).href) {
  await writeGalleryArtifacts();
}
