/**
 * issue #15/F7, Security review T7: "データは含まれません" alone is
 * accurate but incomplete -- `dashboard.json` still carries the title,
 * source file/sheet/column names, and the SQL/filter conditions the user
 * configured, which are themselves potentially sensitive in a Japanese
 * municipal context (a column named "生活保護受給世帯_世帯主氏名", a
 * filename like "R7_滞納整理リスト_最終版.xlsx"). Saying only what's
 * ABSENT risks the user reading "含まれません" as "何も機微は無い" and
 * over-trusting the file's shareability.
 *
 * `SAVE_NARRATIVE_COVERED_KEYS` lists every `Dashboard` top-level key this
 * copy accounts for -- `save-narrative.test.ts` asserts it matches
 * `Dashboard.properties` exactly, so a future schema field that isn't
 * reflected in the narrative text fails CI instead of silently going
 * stale.
 */
export const SAVE_NARRATIVE_COVERED_KEYS: readonly string[] = [
  "version",
  "meta",
  "theme",
  "sources",
  "queries",
  "charts",
  "layout",
];

export const SAVE_NARRATIVE_INCLUDED =
  "ダッシュボードのタイトル／元データのファイル名・シート名・列名／集計の条件（SQL）とグラフ・レイアウトの設定";

export const SAVE_NARRATIVE_EXCLUDED = "取り込んだデータそのもの（表の中身）";
