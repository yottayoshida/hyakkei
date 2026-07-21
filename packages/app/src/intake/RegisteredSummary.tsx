import { memo } from "react";
import type { IntakeSample } from "./types.js";

export type RegisteredSummaryProps = {
  sourceLabel: string;
  sample: IntakeSample;
  /**
   * Takes `(tableId, sourceLabel)` rather than being pre-bound to one
   * source (/simplify Efficiency finding): the shell (App.tsx) passes its
   * single, `useCallback`-stabilized `handleSourceDelete` reference
   * directly, unchanged across every card and every render, instead of
   * `sources.map(...)` allocating a fresh closure per source on every
   * unrelated re-render. Combined with `memo` below, a source card whose
   * own props haven't changed skips re-rendering entirely when some OTHER
   * source is added/removed/renders its own announcement.
   */
  onDelete: (tableId: string, sourceLabel: string) => void;
};

/**
 * The workspace's persistent per-source data card (issue #11a). Previously
 * this WAS the intake flow's terminal screen (D7's "eager register" payoff,
 * with "確定"/"やり直す" ending the session) — under the single-SPA editor,
 * registration success auto-enters the workspace (App.tsx's `onComplete`
 * effect) and this component becomes an ongoing preview + delete affordance
 * for each accumulated source instead of a one-time completion dead end.
 * "確定" is gone (there is nothing left to separately confirm — the source
 * is already live the moment this renders); "やり直す" is now "削除"
 * (Δ4: single-drop redo → per-source deletion, owned by the shell).
 *
 * A column named `__proto__` is safe to read via `row[name]` here:
 * `rowToPlainObject` (register-path.ts, called by `IntakeApp`) builds rows
 * via `Object.fromEntries`, which creates a genuine own data property that
 * shadows the inherited accessor for both reads and writes — the same fix
 * that closed the `.toJSON()` `__proto__`-drop bug A2 found.
 */
export const RegisteredSummary = memo(function RegisteredSummary({
  sourceLabel,
  sample,
  onDelete,
}: RegisteredSummaryProps) {
  const { table, rows } = sample;
  const columnNames = table.columns.map((column) => column.name);

  return (
    <div
      className="hyakkei-source-card"
      // `data-table-id` (code review Mirror-Check finding): the only way an
      // e2e test can tell "the underlying DuckDB table was genuinely
      // dropped and its id reused" apart from "the id was silently
      // suffixed instead" (`identifier.ts`'s own collision-avoidance) --
      // neither `sourceLabel` nor the visible row/column counts change
      // between those two outcomes for a same-named re-registration.
      data-table-id={table.id}
      style={{ marginTop: 16, border: "1px solid #e5e7eb", borderRadius: 8, padding: 16 }}
    >
      {/* Scoped for e2e (distinguishes this card's own preview table from
          DashboardPreview's accessible-fallback table, which is also a
          plain `<table>` in the same workspace DOM) and consistent with
          this codebase's `.hyakkei-*` structural class convention
          (mount.ts's `.hyakkei-tile`/`.hyakkei-chart-canvas`). */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
        <p style={{ margin: 0 }}>
          「{sourceLabel}」（{table.rowCount.toLocaleString("ja-JP")}行 / {table.columns.length}
          列）
        </p>
        <button
          type="button"
          onClick={() => onDelete(table.id, sourceLabel)}
          // code review P2 #4: with 2+ sources, every card's button was
          // identically named "削除" -- indistinguishable by a screen
          // reader's control list. Tied to this card's own source.
          aria-label={`「${sourceLabel}」を削除`}
          style={{ minHeight: 44, padding: "0 12px", background: "transparent", flexShrink: 0 }}
        >
          削除
        </button>
      </div>
      <div style={{ overflowX: "auto", marginTop: 8 }}>
        <table style={{ borderCollapse: "collapse", width: "100%" }}>
          {/* a11y (WCAG 1.3.1, デジ庁DS AA要件): names the table's purpose
              for assistive tech, which a bare grid of cells does not convey
              on its own. */}
          <caption
            style={{ textAlign: "left", fontSize: 12, color: "#6b7280", padding: "0 0 4px" }}
          >
            「{sourceLabel}」の先頭{rows.length}行プレビュー
          </caption>
          <thead>
            <tr>
              {columnNames.map((name) => (
                <th
                  key={name}
                  scope="col"
                  style={{ textAlign: "left", borderBottom: "1px solid #d1d5db", padding: 4 }}
                >
                  {name}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, rowIndex) => (
              // A registered table has no natural row key; the sample is
              // read-only and never reordered, so index-as-key is safe here.
              <tr key={rowIndex}>
                {columnNames.map((name) => (
                  <td key={name} style={{ borderBottom: "1px solid #f3f4f6", padding: 4 }}>
                    {String(row[name] ?? "")}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
});
