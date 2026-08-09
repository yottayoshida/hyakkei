import type { QueryErrorKind } from "./types.js";

export type QueryFailureClassifier = (cause: unknown) => string;

/**
 * Converts an opaque query failure into the two safe messages the editor can
 * show. The raw DuckDB message is deliberately never returned to the UI.
 */
export function classifyQueryError(
  cause: unknown,
  classifyDataSourceFailure?: QueryFailureClassifier,
): QueryErrorKind {
  try {
    if (classifyDataSourceFailure?.(cause) === "oom") return "oom";
  } catch {
    // Classification is best-effort; the stable DuckDB prefix below remains
    // a safe fallback if a dynamically loaded classifier itself fails.
  }
  if (cause instanceof Error && cause.message.startsWith("Out of Memory Error")) return "oom";
  return "query";
}
