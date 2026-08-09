import {
  formatParseFailure,
  parseDashboard,
  validateDashboardReferences,
  type Dashboard,
} from "@hyakkei/schema";

// Import is a replacement operation. Any referential warning that could make
// the editor render two entities into one slot (or compile a source name
// ambiguously) is therefore fatal here rather than deferred to an advisory
// badge after the state has already been installed.
const FATAL_REFERENCE_KINDS = new Set([
  "dangling",
  "duplicate",
  "overlap",
  "out-of-bounds",
  "missing-column",
  "reserved-word",
]);

export class DashboardReadError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DashboardReadError";
  }
}

/** Parses and validates an imported dashboard before any editor state changes. */
export function readDashboardText(text: string): Dashboard {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw new DashboardReadError(
      "ダッシュボードファイルを読み込めませんでした。JSON形式を確認してください。",
    );
  }

  const parsed = parseDashboard(value);
  if (!parsed.ok) {
    throw new DashboardReadError(
      `ダッシュボードファイルを読み込めませんでした。${formatParseFailure(parsed)}`,
    );
  }
  const referenceIssues = validateDashboardReferences(parsed.value).filter((issue) =>
    FATAL_REFERENCE_KINDS.has(issue.kind),
  );
  if (referenceIssues.length > 0) {
    throw new DashboardReadError(
      "ダッシュボードファイルを読み込めませんでした。参照関係が壊れています。",
    );
  }
  return parsed.value;
}

export async function readDashboardFile(file: File): Promise<Dashboard> {
  if (file.size > 10 * 1024 * 1024) {
    throw new DashboardReadError("ダッシュボードファイルが大きすぎます（上限10MB）。");
  }
  try {
    return readDashboardText(await file.text());
  } catch (error) {
    if (error instanceof DashboardReadError) throw error;
    throw new DashboardReadError("ダッシュボードファイルを読み込めませんでした。");
  }
}
