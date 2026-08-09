import { mkdir, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const result = await build({
  entryPoints: [resolve(root, "src/viewer-entry.ts")],
  bundle: true,
  format: "iife",
  platform: "browser",
  target: "es2022",
  minify: true,
  write: false,
});
const code = result.outputFiles[0].text;
const hash = createHash("sha256").update(code).digest("base64");
await mkdir(resolve(root, "src/generated"), { recursive: true });
await writeFile(
  resolve(root, "src/generated/renderer-code.ts"),
  `export const RENDERER_CODE = ${JSON.stringify(code)} as const;\nexport const RENDERER_HASH = ${JSON.stringify(`sha256-${hash}`)} as const;\n`,
);
