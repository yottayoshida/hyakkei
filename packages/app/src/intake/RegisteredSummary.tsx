import { memo, type ChangeEvent } from "react";
import type { ColumnCategory } from "@hyakkei/core/datasource";
import {
  categoryLabel,
  overrideMap,
  type ColumnOverride,
  type ColumnValidationAdvisory,
  type ColumnValidationState,
  type IntakeSample,
  type PreviewRow,
} from "./types.js";

export type RegisteredSummaryProps = {
  sourceLabel: string;
  sample: IntakeSample;
  typeOverrides: ColumnOverride[];
  validation: Map<string, ColumnValidationState>;
  previewRows: PreviewRow[] | null;
  /**
   * Source-scoped, not column-scoped (QA finding, 2026-07-22): true from
   * the moment ANY override on this source changes until the resulting
   * preview refresh commits (or is abandoned) -- see `WorkspaceSource`'s own
   * doc comment (App.tsx) for why this must span a WIDER window than any
   * single column's own `"pending"` validation status.
   */
  previewPending: boolean;
  disconnected?: boolean;
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
  /** 1-based ordinal only when another displayed source has the same label. */
  sourceDeleteOrdinal?: number | null;
  /** Same stable-reference discipline as `onDelete` (issue #11b). */
  onOverrideChange: (tableId: string, column: string, category: ColumnCategory) => void;
  /** Same stable-reference discipline as `onDelete` (issue 11c). Opens a new `QueryBuilder` for this source. */
  onAddQuery: (tableId: string) => void;
};

/** number -> right (matches spreadsheet convention, aids magnitude comparison); date/text -> left. */
function alignmentFor(category: ColumnCategory | "other"): "left" | "right" {
  return category === "number" ? "right" : "left";
}

/**
 * The workspace's persistent per-source data card (issue #11a, extended for
 * #11b). Previously this WAS the intake flow's terminal screen (D7's "eager
 * register" payoff, with "確定"/"やり直す" ending the session) — under the
 * single-SPA editor, registration success auto-enters the workspace
 * (App.tsx's `onComplete` effect) and this component becomes an ongoing
 * preview + delete affordance for each accumulated source instead of a
 * one-time completion dead end. "確定" is gone (there is nothing left to
 * separately confirm — the source is already live the moment this renders);
 * "やり直す" is now "削除" (Δ4: single-drop redo → per-source deletion,
 * owned by the shell).
 *
 * A column named `__proto__` is safe to read via `row[name]` here:
 * `rowToPlainObject` (register-path.ts, called by `IntakeApp`) builds rows
 * via `Object.fromEntries`, which creates a genuine own data property that
 * shadows the inherited accessor for both reads and writes — the same fix
 * that closed the `.toJSON()` `__proto__`-drop bug A2 found.
 *
 * Column type (issue #11b): each header shows the detected/overridden
 * semantic category via a native `<select>` (Fitts/Hick: always visible,
 * 3 options, no separate "edit mode" to discover). "その他" (Arrow
 * Binary/Time/Interval/List/Struct/...) is not one of the 3 override
 * options — `CAST_TARGET` (core) has no target for it, so overriding it
 * would either be a no-op or a silently-wrong cast; the control is disabled
 * for those columns instead of offering a choice that cannot do anything.
 */
export const RegisteredSummary = memo(function RegisteredSummary({
  sourceLabel,
  sample,
  typeOverrides,
  validation,
  previewRows,
  previewPending,
  disconnected = false,
  onDelete,
  sourceDeleteOrdinal = null,
  onOverrideChange,
  onAddQuery,
}: RegisteredSummaryProps) {
  const { table } = sample;
  const columnNames = table.columns.map((column) => column.name);
  const overrideByColumn = overrideMap(typeOverrides);
  // Falls back to the raw registration sample, wrapped in the same shape as
  // a typed preview row (no column overridden yet, so nothing can have
  // failed to cast) -- `RegisteredSummary` always renders `PreviewRow[]`,
  // never branches its cell-rendering logic on whether an override exists.
  const displayRows: PreviewRow[] =
    previewRows ?? sample.rows.map((values) => ({ values, castFailed: new Set<string>() }));

  // One column can contribute more than one line (issue #11b follow-up,
  // /code-review Angle D + A, confirmed): a "warning"/"valid" outcome and an
  // orthogonal precision/timezone `advisory` are independent axes (a cast
  // can succeed AND still silently lose information), and a "failed" query
  // needs its own distinct message -- previously only "warning" rendered
  // anything at all, so both "failed" (query itself threw) and "valid"'s
  // own `samples`/`advisory` were silently invisible to the user regardless
  // of how meaningful the underlying result was.
  type StatusMessage =
    | {
        kind: "warning";
        name: string;
        state: Extract<ColumnValidationState, { status: "warning" }>;
      }
    | { kind: "failed"; name: string }
    | { kind: "advisory"; name: string; advisory: ColumnValidationAdvisory };

  const statusMessages: StatusMessage[] = columnNames.flatMap((name): StatusMessage[] => {
    const state = validation.get(name);
    if (!state) return [];
    const messages: StatusMessage[] = [];
    if (state.status === "warning") messages.push({ kind: "warning", name, state });
    if (state.status === "failed") messages.push({ kind: "failed", name });
    if ((state.status === "warning" || state.status === "valid") && state.advisory) {
      messages.push({ kind: "advisory", name, advisory: state.advisory });
    }
    return messages;
  });

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
      {disconnected && (
        <p role="alert" style={{ margin: "4px 0", color: "#92400e" }}>
          元データが未接続です。「データを追加」から元ファイルを再度取り込んでください。
        </p>
      )}
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
        <div style={{ display: "flex", gap: 8, flexShrink: 0 }}>
          <button
            type="button"
            onClick={() => onAddQuery(table.id)}
            aria-label={`「${sourceLabel}」を集計`}
            data-add-query-for={table.id}
            style={{ minHeight: 44, padding: "0 12px" }}
          >
            このデータを集計
          </button>
          <button
            type="button"
            onClick={() => onDelete(table.id, sourceLabel)}
            // code review P2 #4: with 2+ sources, every card's button was
            // identically named "削除" -- indistinguishable by a screen
            // reader's control list. Tied to this card's own source.
            aria-label={`「${sourceLabel}」${sourceDeleteOrdinal == null ? "" : `（${sourceDeleteOrdinal}件目）`}を削除`}
            data-delete-source-for={table.id}
            style={{ minHeight: 44, padding: "0 12px", background: "transparent" }}
          >
            削除
          </button>
        </div>
      </div>
      <div style={{ overflowX: "auto", marginTop: 8 }}>
        <table style={{ borderCollapse: "collapse", width: "100%" }}>
          {/* a11y (WCAG 1.3.1, デジ庁DS AA要件): names the table's purpose
              for assistive tech, which a bare grid of cells does not convey
              on its own. */}
          <caption
            style={{ textAlign: "left", fontSize: 12, color: "#6b7280", padding: "0 0 4px" }}
          >
            「{sourceLabel}」の先頭{displayRows.length}行プレビュー
          </caption>
          <thead>
            <tr>
              {table.columns.map((column) => {
                const currentCategory = overrideByColumn.get(column.name) ?? column.category;
                const isOverridable = column.category !== "other";
                return (
                  <th
                    key={column.name}
                    scope="col"
                    style={{ textAlign: "left", borderBottom: "1px solid #d1d5db", padding: 4 }}
                  >
                    <div>{column.name}</div>
                    <select
                      aria-label={`「${column.name}」の種類`}
                      value={isOverridable ? currentCategory : "other"}
                      disabled={!isOverridable}
                      onChange={(event: ChangeEvent<HTMLSelectElement>) =>
                        onOverrideChange(
                          table.id,
                          column.name,
                          event.target.value as ColumnCategory,
                        )
                      }
                      style={{ marginTop: 2, fontWeight: "normal", fontSize: 12 }}
                    >
                      {isOverridable ? (
                        <>
                          <option value="text">文字</option>
                          <option value="number">数値</option>
                          <option value="date">日付</option>
                        </>
                      ) : (
                        <option value="other">その他</option>
                      )}
                    </select>
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {displayRows.map((row, rowIndex) => (
              // A registered table has no natural row key; the sample is
              // read-only and never reordered, so index-as-key is safe here.
              <tr key={rowIndex}>
                {table.columns.map((column) => {
                  const category = overrideByColumn.get(column.name) ?? column.category;
                  // Suppressed while a preview refresh for THIS SOURCE is
                  // in flight (`previewPending`, source-scoped -- issue
                  // #11b follow-up, /code-review Angle A + QA finding):
                  // `previewRows`/`castFailed` reflect the PRIOR override's
                  // cast outcome until the resulting preview query actually
                  // resolves -- without this, switching an override could
                  // briefly show a stale "⚠" glyph labeled with the NEW
                  // category (the label already updates synchronously via
                  // `overrideByColumn`) even though whether the NEW cast
                  // actually fails on this cell is not yet known. Gating on
                  // `previewPending` alone (not also this column's own
                  // `"pending"` validation status) is deliberate: a QA
                  // finding (2026-07-22, live DuckDB-WASM run) showed
                  // validation resolves BEFORE the preview refresh does --
                  // `previewPending` stays true for that entire gap,
                  // strictly a superset of the validation-only window a
                  // narrower check would have covered.
                  const failed = row.castFailed.has(column.name) && !previewPending;
                  return (
                    <td
                      key={column.name}
                      style={{
                        borderBottom: "1px solid #f3f4f6",
                        padding: 4,
                        textAlign: alignmentFor(category),
                        // Non-color-dependent marker (WCAG 1.4.1): the "⚠"
                        // glyph + a text `title` carry the failure, not a
                        // background color alone.
                        color: failed ? "#92400e" : undefined,
                      }}
                      title={
                        failed
                          ? `「${categoryLabel(category)}」として読み取れませんでした`
                          : undefined
                      }
                    >
                      {failed ? "⚠ " : ""}
                      {String(row.values[column.name] ?? "")}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {statusMessages.length > 0 && (
        <div role="status" style={{ marginTop: 8, fontSize: 13 }}>
          {statusMessages.map((msg) => {
            if (msg.kind === "warning") {
              const { name, state } = msg;
              return (
                <p key={`${name}-warning`} style={{ margin: "4px 0", color: "#92400e" }}>
                  「{name}」を{categoryLabel(overrideByColumn.get(name))}
                  として読み込みました。<strong>{state.uncastableCount}件</strong>
                  の値が空欄になります
                  {state.samples.some((s) => s.parsed === null) &&
                    `（例:「${state.samples.find((s) => s.parsed === null)?.original}」）`}
                  。<strong>元のファイルは変更されません。</strong>
                  「文字」に戻すとすべての値が表示されます。
                </p>
              );
            }
            if (msg.kind === "failed") {
              return (
                <p key={`${msg.name}-failed`} style={{ margin: "4px 0", color: "#b91c1c" }}>
                  「{msg.name}
                  」の検証に失敗しました。列の内容を確認するか、別の種類を選び直してください。
                  <strong>元のファイルは変更されません。</strong>
                </p>
              );
            }
            const { name, advisory } = msg;
            return (
              <p key={`${name}-advisory`} style={{ margin: "4px 0", color: "#374151" }}>
                {advisory.kind === "precision-loss"
                  ? `「${name}」を数値として読み込みましたが、${advisory.count}件の値は桁数が多く、数値としての精度が失われる可能性があります。`
                  : `「${name}」を日付として読み込みましたが、${advisory.count}件の値に時刻・タイムゾーン情報が含まれていました。日付部分のみを使用しています。`}
                <strong>元のファイルは変更されません。</strong>
              </p>
            );
          })}
        </div>
      )}
    </div>
  );
});
