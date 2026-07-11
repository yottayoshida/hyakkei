import { readFileSync, readdirSync } from "node:fs";
import { dirname, extname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SRC_ROOT = join(__dirname, ".."); // this file is src/theme/*.test.ts -> src/

const HEX_COLOR = /#[0-9a-fA-F]{6}\b/g;

/** palette.ts is the one file allowed to name chart-color hex literals directly
 * (its own contrast-derivation constants and comments cite measured hex
 * values) -- everywhere else must resolve colors through it, not duplicate a
 * hex value inline (the exact duplication `echarts-theme.ts` had before this
 * test was added: a hardcoded `#1A1A1A`/`#F8F8FB` that happened to already
 * exist as `palette.ts`'s own `BACKGROUND` export). Test files are excluded:
 * fixtures legitimately assert against expected hex values by name.
 */
const ALLOWED_FILES = new Set(["theme/palette.ts"]);

function collectTsFiles(dir: string, relativeTo: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const abs = join(dir, entry.name);
    const rel = join(relativeTo, entry.name).replaceAll("\\", "/");
    if (entry.isDirectory()) {
      files.push(...collectTsFiles(abs, rel));
    } else if (extname(entry.name) === ".ts" && !entry.name.endsWith(".test.ts")) {
      files.push(rel);
    }
  }
  return files;
}

describe("no hardcoded hex colors outside palette.ts (plan §PR-A CI assert)", () => {
  // Walked once for both assertions below (/simplify: the two `it` blocks
  // previously each ran their own full recursive readdirSync walk).
  const scanned = collectTsFiles(SRC_ROOT, "");

  it("scanned at least the known theme/ and datasource/ source files (sentinel -- a path-computation bug that scans zero files must not silently pass)", () => {
    for (const expected of ["theme/palette.ts", "theme/echarts-theme.ts", "datasource/types.ts", "index.ts"]) {
      expect(scanned, `expected ${expected} among scanned files`).toContain(expected);
    }
    expect(scanned.length).toBeGreaterThan(5);
  });

  it("every .ts source file (excluding tests) has zero #hex literals, except palette.ts", () => {
    const offenders: { file: string; matches: string[] }[] = [];

    for (const relPath of scanned) {
      if (ALLOWED_FILES.has(relPath)) continue;
      const content = readFileSync(join(SRC_ROOT, relPath), "utf-8");
      const matches = content.match(HEX_COLOR);
      if (matches) offenders.push({ file: relPath, matches });
    }

    expect(
      offenders,
      offenders
        .map((o) => `${o.file}: ${o.matches.join(", ")} -- resolve via palette.ts instead`)
        .join("\n"),
    ).toEqual([]);
  });
});
