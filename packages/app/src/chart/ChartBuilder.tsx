import { memo, useMemo, useState, type ChangeEvent } from "react";
import type { Chart, ChartVariant } from "@hyakkei/schema";
import { DashboardErrorBoundary } from "../dashboard-error-boundary.js";
import { friendlyColumnLabel, type ChartRowState, type WorkspaceQuery } from "../intake/types.js";
import { ChartPreview } from "./ChartPreview.js";
import {
  CHART_ROW_LIMIT,
  CHART_TYPE_TILES,
  detectNumericMismatch,
  ENCODING_FIELDS,
  reconcileChartOptions,
  reconcileEncoding,
  tileToVariant,
  usableColumns,
  variantToTile,
  type ChartTypeTile,
} from "./chart-encoding.js";

export type ChartBuilderProps = {
  chart: Chart;
  query: WorkspaceQuery;
  sourceLabel: string;
  rowState: ChartRowState;
  onChange: (chartId: string, chart: Chart) => void;
  onDelete: (chartId: string) => void;
};

type EncodingValue = string | string[] | undefined;

function encodingRecord(encoding: ChartVariant["encoding"]): Record<string, EncodingValue> {
  return encoding as Record<string, EncodingValue>;
}

type ChartTitleInputProps = { value: string; onCommit: (value: string) => void };

/**
 * Local draft, committed on blur/Enter -- not on every keystroke (UX review,
 * Phase 8, Major finding D-3), mirroring `QueryBuilder.tsx`'s own
 * `FilterValueInput` for the identical reason: committing immediately makes
 * every keystroke produce a new `chart` object, which `ChartPreview`'s own
 * `useEffect` (keyed on `chart`) reads as "re-render," disposing and
 * rebuilding the ECharts instance once per character -- worse still under
 * Japanese IME composition, this app's primary input mode. A title never
 * needs live feedback the way a type/encoding change does (the preview
 * itself doesn't gate on title correctness), so deferring the commit to
 * blur/Enter costs nothing a user would notice.
 */
function ChartTitleInput({ value, onCommit }: ChartTitleInputProps) {
  const [draft, setDraft] = useState(value);
  return (
    <input
      type="text"
      aria-label="グラフのタイトル"
      value={draft}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={() => onCommit(draft)}
      onKeyDown={(event) => {
        if (event.key !== "Enter") return;
        event.preventDefault();
        onCommit(draft);
      }}
      style={{ marginLeft: 8, minHeight: 44 }}
    />
  );
}

/**
 * `CHART_TYPE_TILES` grouped by `group`, computed once at module load
 * (`/simplify` Simplification finding): this depended on nothing but that
 * static module-level constant, so a `useMemo(() => ..., [])` inside the
 * component recomputed it once per MOUNTED chart card instead of once per
 * whole session -- identical output every time, just wastefully re-derived.
 */
const CHART_TYPE_GROUPS: Array<[string, ChartTypeTile[]]> = (() => {
  const seen = new Map<string, ChartTypeTile[]>();
  for (const tile of CHART_TYPE_TILES) {
    const list = seen.get(tile.group) ?? [];
    list.push(tile.key);
    seen.set(tile.group, list);
  }
  return [...seen.entries()];
})();

/**
 * The light-shaping GUI's chart-creation card (issue #12), mirroring
 * `QueryBuilder.tsx`'s established idioms (3-zone layout, `memo`-wrapped
 * with stable callback props, 44px minimum tap targets). Unlike
 * `QueryBuilder`, encoding SHAPE varies per chart type -- Zone 2 renders
 * dynamically from `ENCODING_FIELDS[chart.type]` rather than a fixed set of
 * controls.
 *
 * Every discrete change (type tile, encoding `<select>`, title/option edit)
 * calls `onChange` with the FULL next `Chart` immediately -- same
 * on-change-auto-refresh discipline `QueryBuilder.tsx` already established.
 * A type change goes through `reconcileEncoding`/`reconcileChartOptions`
 * (complete rebuild, never a partial spread of the prior type's shape,
 * plan §type変更時のencoding再構築); an ordinary same-type field edit is a
 * normal partial update.
 */
export const ChartBuilder = memo(function ChartBuilder({
  chart,
  query,
  sourceLabel,
  rowState,
  onChange,
  onDelete,
}: ChartBuilderProps) {
  // Filtered through `usableColumns` (Codex Round 1 P1/P2), not
  // `query.previewColumns` directly: an empty-string Arrow field name must
  // never reach a `NonEmptyString` encoding value, and (more commonly) a
  // query that just errored clears `previewColumns` to `[]` while this
  // card's chart remains mounted -- both must disable type/encoding edits,
  // not silently build a broken `Chart`.
  const previewColumns = useMemo(() => usableColumns(query.previewColumns), [query.previewColumns]);
  const columnsAvailable = previewColumns.length > 0;
  const selectedTile = variantToTile(chart);
  const encoding = encodingRecord(chart.encoding);
  // Memoized against `chart.type`/`chart.encoding` specifically (code
  // review Round 3, Angle Efficiency), not the whole `chart` object: this
  // scans up to CHART_ROW_LIMIT rows, and a title keystroke or donut-
  // checkbox toggle produces a new `chart` object reference (via `{
  // ...chart, options: {...} }`) without touching `type`/`encoding` at
  // all -- depending on the whole object would rescan on every such edit,
  // defeating the memoization this exists for.
  const mismatchedChannels = useMemo(
    () => (rowState.status === "ready" ? detectNumericMismatch(chart.type, chart.encoding, rowState.rows) : []),
    [chart.type, chart.encoding, rowState],
  );

  function handleTypeSelect(tile: ChartTypeTile) {
    if (!columnsAvailable) return;
    const { type: nextType, donut } = tileToVariant(tile);
    const nextEncoding = reconcileEncoding(encoding, nextType, previewColumns);
    const baseOptions = reconcileChartOptions(chart.options, nextType);
    onChange(chart.id, {
      ...chart,
      type: nextType,
      encoding: nextEncoding,
      options: donut ? { ...baseOptions, donut: true } : baseOptions,
      // `as Chart`: `reconcileEncoding`'s exhaustive switch over `nextType`
      // guarantees `nextEncoding`'s shape matches `nextType`, a pairing
      // TypeScript's structural typing cannot itself verify across this
      // discriminated union without per-type generic overloads.
    } as Chart);
  }

  function updateEncodingField(key: string, value: EncodingValue) {
    if (!columnsAvailable) return;
    onChange(chart.id, { ...chart, encoding: { ...encoding, [key]: value } } as Chart);
  }

  function updateTitle(title: string) {
    onChange(chart.id, {
      ...chart,
      options: title ? { ...chart.options, title } : { ...chart.options, title: undefined },
    });
  }

  function toggleDonut(donut: boolean) {
    onChange(chart.id, { ...chart, options: { ...chart.options, donut } });
  }

  function toggleShowDataLabels(showDataLabels: boolean) {
    onChange(chart.id, { ...chart, options: { ...chart.options, showDataLabels } });
  }

  const showsDataLabelsOption =
    chart.type === "bar" || chart.type === "line" || chart.type === "area" || chart.type === "pie";

  return (
    <div
      className="hyakkei-chart-card"
      data-chart-id={chart.id}
      // UX review (Phase 8, Major finding C-6): focusable so `App.tsx` can
      // move focus here right after this card mounts from "グラフ化" --
      // otherwise a keyboard/screen-reader user has no way to reach a
      // newly-added card except tabbing past everything above it.
      tabIndex={-1}
      style={{ marginTop: 16, border: "1px solid #e5e7eb", borderRadius: 8, padding: 16 }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
        <p style={{ margin: 0 }}>「{sourceLabel}」のグラフ</p>
        <button
          type="button"
          onClick={() => onDelete(chart.id)}
          aria-label={`「${sourceLabel}」のグラフを削除`}
          style={{ minHeight: 44, padding: "0 12px", background: "transparent", flexShrink: 0 }}
        >
          削除
        </button>
      </div>

      <fieldset style={{ marginTop: 12, border: "1px solid #e5e7eb", borderRadius: 4, padding: 8 }}>
        <legend>グラフの種類</legend>
        {CHART_TYPE_GROUPS.map(([group, tiles]) => (
          <div key={group} style={{ marginTop: 4 }}>
            <p style={{ margin: "4px 0", fontSize: 12, color: "#6b7280" }}>{group}</p>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
              {tiles.map((tile) => {
                const def = CHART_TYPE_TILES.find((t) => t.key === tile)!;
                const selected = tile === selectedTile;
                return (
                  <button
                    key={tile}
                    type="button"
                    aria-pressed={selected}
                    disabled={!columnsAvailable}
                    onClick={() => handleTypeSelect(tile)}
                    style={{
                      minHeight: 44,
                      minWidth: 44,
                      padding: "0 12px",
                      border: selected ? "2px solid #1a56db" : "1px solid #d1d5db",
                      borderRadius: 4,
                      background: selected ? "#eff6ff" : "#fff",
                    }}
                  >
                    {def.label}
                  </button>
                );
              })}
            </div>
          </div>
        ))}
      </fieldset>

      <fieldset style={{ marginTop: 12, border: "1px solid #e5e7eb", borderRadius: 4, padding: 8 }}>
        <legend>表示する列</legend>
        {!columnsAvailable && (
          <p role="status" style={{ margin: "4px 0", fontSize: 13, color: "#6b7280" }}>
            列情報を取得できません。集計の内容を確認してください。
          </p>
        )}
        {ENCODING_FIELDS[chart.type].map((field) => {
          if (field.key === "columns") {
            const selected = new Set((encoding.columns as string[] | undefined) ?? []);
            return (
              <div key={field.key}>
                <p style={{ margin: "4px 0" }}>{field.label}</p>
                {previewColumns.map((column) => {
                  const isChecked = selected.has(column);
                  // Schema requires columns.length >= 1 (Codex Round 1 P1):
                  // unchecking the LAST remaining selection would produce an
                  // invalid empty array -- disabled, not silently reverted,
                  // so the "why can't I uncheck this" reason is visible.
                  const isLastChecked = isChecked && selected.size === 1;
                  // Scoped to `chart.id` (not a static string): several
                  // ChartBuilder cards render on the same page, and an
                  // `id` must be page-unique for `aria-describedby` to
                  // resolve to the right element in each card.
                  const lastColumnNoteId = `${chart.id}-last-column-note`;
                  return (
                    <label key={column} style={{ display: "block", minHeight: 44 }}>
                      <input
                        type="checkbox"
                        checked={isChecked}
                        disabled={!columnsAvailable || isLastChecked}
                        aria-describedby={isLastChecked ? lastColumnNoteId : undefined}
                        onChange={(event: ChangeEvent<HTMLInputElement>) => {
                          const next = event.target.checked
                            ? [...selected, column]
                            : [...selected].filter((c) => c !== column);
                          if (next.length === 0) return;
                          updateEncodingField("columns", next);
                        }}
                      />
                      {friendlyColumnLabel(column, query)}
                      {/* UX review (Phase 8, Minor): `disabled` alone reads as
                          a dead control -- the reason ("why can't I uncheck
                          this") must be visible, not just inferred from the
                          comment above. */}
                      {isLastChecked && (
                        <span id={lastColumnNoteId} style={{ marginLeft: 8, fontSize: 12, color: "#6b7280" }}>
                          （表には1列以上必要です）
                        </span>
                      )}
                    </label>
                  );
                })}
              </div>
            );
          }
          const currentValue = (encoding[field.key] as string | undefined) ?? "";
          return (
            <div key={field.key} style={{ marginTop: 4 }}>
              <label>
                {field.label}
                {field.optional && "（任意）"}
                <select
                  aria-label={field.label}
                  value={currentValue}
                  disabled={!columnsAvailable}
                  onChange={(event: ChangeEvent<HTMLSelectElement>) =>
                    updateEncodingField(field.key, event.target.value || undefined)
                  }
                  style={{ marginLeft: 8, minHeight: 44 }}
                >
                  {field.optional && <option value="">（設定しない）</option>}
                  {previewColumns.map((column) => (
                    <option key={column} value={column}>
                      {friendlyColumnLabel(column, query)}
                    </option>
                  ))}
                </select>
              </label>
            </div>
          );
        })}
      </fieldset>

      <fieldset style={{ marginTop: 12, border: "1px solid #e5e7eb", borderRadius: 4, padding: 8 }}>
        <legend>タイトル・表示オプション</legend>
        <div>
          <label>
            タイトル
            <ChartTitleInput value={chart.options.title ?? ""} onCommit={updateTitle} />
          </label>
        </div>
        {chart.type === "pie" && (
          <div style={{ marginTop: 4 }}>
            <label style={{ minHeight: 44, display: "inline-flex", alignItems: "center" }}>
              <input
                type="checkbox"
                checked={chart.options.donut ?? false}
                onChange={(event) => toggleDonut(event.target.checked)}
              />
              ドーナツ表示にする
            </label>
          </div>
        )}
        {showsDataLabelsOption && (
          <div style={{ marginTop: 4 }}>
            <label style={{ minHeight: 44, display: "inline-flex", alignItems: "center" }}>
              <input
                type="checkbox"
                checked={chart.options.showDataLabels ?? false}
                onChange={(event) => toggleShowDataLabels(event.target.checked)}
              />
              データの値を表示する
            </label>
          </div>
        )}
      </fieldset>

      {/* Non-blocking (plan §型不一致encodingの検知): rendered ABOVE the
          preview, not instead of it -- the renderer itself degrades
          gracefully (null-valued points/bars), so this is advisory, never a
          hard gate. `role="status"` (polite), not `"alert"` (assertive,
          UX review Phase 8 Minor: an assertive region interrupts the
          screen reader on every encoding edit, out of proportion for an
          advisory the comment above itself says is never a hard gate). */}
      {mismatchedChannels.length > 0 && (
        <p role="status" style={{ marginTop: 8, fontSize: 13, color: "#b45309" }}>
          「
          {mismatchedChannels
            .map((key) => ENCODING_FIELDS[chart.type].find((field) => field.key === key)?.label ?? key)
            .join("」「")}
          」に選択した列は数値として認識できませんでした。
        </p>
      )}

      {/* QA Phase 8 V-008: non-blocking, same role="status" reasoning as
          the type-mismatch advisory above -- the chart still renders with
          whatever rows it got, this only discloses that there may be more. */}
      {rowState.status === "ready" && rowState.truncated && (
        <p role="status" style={{ marginTop: 8, fontSize: 13, color: "#b45309" }}>
          データが多いため、先頭{CHART_ROW_LIMIT.toLocaleString("ja-JP")}件のみ表示しています。
        </p>
      )}

      <div style={{ marginTop: 12 }}>
        {/* `DashboardErrorBoundary`'s ONLY recovery mechanism is the parent
            reassigning its `key` (its own doc comment). Keyed on
            `type`+`encoding` specifically (UX review Phase 8, Major finding
            D-3), not the whole `chart` object (the prior key) -- those two
            fields are exactly what could make `ChartPreview`'s `mount()`
            throw for a bad type/encoding combination (SEC-5:
            `ChartOptions` is built field-by-field from typed controls, so a
            title string or a donut/showDataLabels toggle cannot itself
            cause a render-time throw). Keying on the whole chart meant
            EVERY title keystroke produced a new key, tearing down and
            rebuilding the entire ECharts instance on every character typed
            -- inconsistent with `QueryBuilder.tsx`'s own draft/commit-on-blur
            discipline for text inputs, and defeating the very memoization
            `mismatchedChannels` above depends on `chart.type`/`chart.encoding`
            for. */}
        <DashboardErrorBoundary key={`${chart.type}:${JSON.stringify(chart.encoding)}`}>
          <ChartPreview chart={chart} rowState={rowState} />
        </DashboardErrorBoundary>
      </div>
    </div>
  );
});
