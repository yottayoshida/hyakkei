const INVALID_CHARS = /[^A-Za-z0-9_]/g;
const LEADING_DIGIT = /^[0-9]/;
const MAX_LENGTH = 64; // packages/schema/src/common.ts's `SqlIdentifier`
const FALLBACK_BASE = "table";

/**
 * A Japanese (or otherwise non-ASCII) filename sanitizes to all
 * underscores and falls back to `FALLBACK_BASE` — this loses the original
 * name entirely, which is acceptable only because the *display* label
 * (`IntakeState.sourceLabel`, the untouched original filename/URL) is what
 * the user actually sees; this function's output is purely an internal
 * DuckDB table name never rendered on its own. Transliteration was
 * considered and deliberately left out of scope (not called for by plan
 * D7/D10, and this project's UX requirement is "no technical jargon
 * exposed", not "preserve authoring intent in generated identifiers").
 */
function sanitizeBase(label: string): string {
  const stem = label.replace(/\.[^./\\]+$/, ""); // drop a trailing file extension, if any
  let candidate = stem.replace(INVALID_CHARS, "_").slice(0, MAX_LENGTH);
  if (candidate.replace(/_/g, "") === "") candidate = FALLBACK_BASE;
  if (LEADING_DIGIT.test(candidate)) candidate = `_${candidate}`;
  return candidate.slice(0, MAX_LENGTH);
}

/**
 * `usedIds` must accumulate across the whole intake session (every id this
 * function has ever returned, not just the current attempt) — `register()`
 * generates a plain `CREATE TABLE`, not `CREATE OR REPLACE`
 * (csv-source.ts/xlsx-source.ts/parquet-source.ts), so reusing an id a
 * still-live table already owns throws a DuckDB "table already exists"
 * error that would otherwise surface to the user as an opaque `corrupt`
 * `DataSourceError` — indistinguishable from an actually-corrupt file.
 */
export function generateSourceId(label: string, usedIds: ReadonlySet<string>): string {
  const base = sanitizeBase(label);
  if (!usedIds.has(base)) return base;
  for (let suffix = 2; ; suffix++) {
    const suffixText = `_${suffix}`;
    const candidate = `${base.slice(0, MAX_LENGTH - suffixText.length)}${suffixText}`;
    if (!usedIds.has(candidate)) return candidate;
  }
}
