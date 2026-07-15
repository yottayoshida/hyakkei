import type { IntakeSample } from "./types.js";

export type RegisteredSummaryProps = {
  sourceLabel: string;
  sample: IntakeSample;
  onConfirm: () => void;
  onRedo: () => void;
};

/**
 * D7's payoff view: Preview and Registered are the same state (eager
 * register already ran by the time this renders — D10's "案ii"), so this
 * is both the sample preview AND the completion screen at once, with a
 * forward-looking completion line rather than a dead end ("登録できたが
 * 何も起きない" — D7's own framing of the failure mode this exists to
 * avoid). A column named `__proto__` is safe to read via `row[name]` here:
 * `rowToPlainObject` (register-path.ts, called by `IntakeApp`) builds rows
 * via `Object.fromEntries`, which creates a genuine own data property that
 * shadows the inherited accessor for both reads and writes — the same fix
 * that closed the `.toJSON()` `__proto__`-drop bug A2 found.
 */
export function RegisteredSummary({
  sourceLabel,
  sample,
  onConfirm,
  onRedo,
}: RegisteredSummaryProps) {
  const { table, rows } = sample;
  const columnNames = table.columns.map((column) => column.name);

  return (
    <div style={{ marginTop: 16 }}>
      <p role="status">
        取り込み完了。「{sourceLabel}」を {table.rowCount.toLocaleString("ja-JP")} 行、
        {table.columns.length} 列で取り込みました。グラフ作成機能は今後の更新で追加されます。
      </p>
      <div style={{ overflowX: "auto" }}>
        <table style={{ borderCollapse: "collapse", width: "100%" }}>
          <thead>
            <tr>
              {columnNames.map((name) => (
                <th
                  key={name}
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
      <div style={{ marginTop: 16, display: "flex", gap: 8 }}>
        {/* Primary/secondary visual weight (UX review m2, Von Restorff):
            both actions previously looked identical, despite one ending
            the session with data kept and the other discarding it. */}
        <button
          type="button"
          onClick={onConfirm}
          style={{
            minHeight: 44,
            padding: "0 16px",
            background: "#1a56db",
            color: "#fff",
            border: "none",
            borderRadius: 4,
          }}
        >
          確定
        </button>
        <button
          type="button"
          onClick={onRedo}
          style={{ minHeight: 44, padding: "0 16px", background: "transparent" }}
        >
          やり直す
        </button>
      </div>
    </div>
  );
}
