/** @vitest-environment jsdom */
import { act, type ReactElement } from "react";
import { createRoot } from "react-dom/client";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { RegisteredSummary, type RegisteredSummaryProps } from "./RegisteredSummary.js";
import type { ColumnValidationState, IntakeSample } from "./types.js";

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

async function renderInJsdom(node: ReactElement) {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  await act(async () => {
    root.render(node);
  });
  return {
    host,
    rerender: async (next: ReactElement) => {
      await act(async () => {
        root.render(next);
      });
    },
  };
}

function sample(): IntakeSample {
  return {
    table: {
      id: "t1",
      rowCount: 2,
      columns: [
        { name: "郵便番号", type: "Int64", category: "number" },
        { name: "amount", type: "Utf8", category: "text" },
        { name: "tags", type: "List<Utf8>", category: "other" },
      ],
    },
    rows: [
      { 郵便番号: "1000001", amount: "1,200", tags: "" },
      { 郵便番号: "1000002", amount: "999", tags: "" },
    ],
    spec: { id: "t1", kind: "file", format: "csv", ref: { name: "t1.csv" } },
  };
}

function baseProps(overrides: Partial<RegisteredSummaryProps> = {}): RegisteredSummaryProps {
  return {
    sourceLabel: "住所一覧.csv",
    sample: sample(),
    typeOverrides: [],
    validation: new Map(),
    previewRows: null,
    previewPending: false,
    onDelete: vi.fn(),
    onOverrideChange: vi.fn(),
    onAddQuery: vi.fn(),
    ...overrides,
  };
}

describe("RegisteredSummary", () => {
  it("renders each column's detected category in its <select>, and disables the control for an 'other'-category column (issue 11b)", async () => {
    const { host } = await renderInJsdom(<RegisteredSummary {...baseProps()} />);
    const selects = host.querySelectorAll("select");
    expect(selects).toHaveLength(3);
    expect((selects[0] as HTMLSelectElement).value).toBe("number");
    expect((selects[0] as HTMLSelectElement).disabled).toBe(false);
    expect((selects[1] as HTMLSelectElement).value).toBe("text");
    expect((selects[2] as HTMLSelectElement).disabled).toBe(true);
  });

  it("shows a reconnect warning for a source imported without its original data", async () => {
    const { host } = await renderInJsdom(
      <RegisteredSummary {...baseProps({ disconnected: true, sample: { ...sample(), rows: [] } })} />,
    );
    expect(host.querySelector('[role="alert"]')?.textContent).toContain("元データが未接続です");
  });

  it("calls onOverrideChange with (tableId, column, category) when a select changes", async () => {
    const onOverrideChange = vi.fn();
    const { host } = await renderInJsdom(
      <RegisteredSummary {...baseProps({ onOverrideChange })} />,
    );
    const postalSelect = host.querySelector(
      'select[aria-label="「郵便番号」の種類"]',
    ) as HTMLSelectElement;
    await act(async () => {
      postalSelect.value = "text";
      postalSelect.dispatchEvent(new Event("change", { bubbles: true }));
    });
    expect(onOverrideChange).toHaveBeenCalledWith("t1", "郵便番号", "text");
  });

  it("shows the current override's category (not the detected one) once an override is set", async () => {
    const { host } = await renderInJsdom(
      <RegisteredSummary
        {...baseProps({ typeOverrides: [{ column: "郵便番号", category: "text" }] })}
      />,
    );
    const postalSelect = host.querySelector(
      'select[aria-label="「郵便番号」の種類"]',
    ) as HTMLSelectElement;
    expect(postalSelect.value).toBe("text");
  });

  it("calls onDelete with (tableId, sourceLabel) when the delete button is clicked", async () => {
    const onDelete = vi.fn();
    const { host } = await renderInJsdom(<RegisteredSummary {...baseProps({ onDelete })} />);
    const button = host.querySelector(
      'button[aria-label="「住所一覧.csv」を削除"]',
    ) as HTMLButtonElement;
    await act(async () => {
      button.click();
    });
    expect(onDelete).toHaveBeenCalledWith("t1", "住所一覧.csv");
  });

  it("calls onAddQuery with the source's tableId when '集計' button is clicked (issue 11c)", async () => {
    const onAddQuery = vi.fn();
    const { host } = await renderInJsdom(<RegisteredSummary {...baseProps({ onAddQuery })} />);
    const button = host.querySelector(
      'button[aria-label="「住所一覧.csv」を集計"]',
    ) as HTMLButtonElement;
    expect(button).not.toBeNull();
    await act(async () => {
      button.click();
    });
    expect(onAddQuery).toHaveBeenCalledWith("t1");
  });

  it("renders a warning message with the uncastable count when a column's validation state is 'warning' (V-001/V-003)", async () => {
    const validation = new Map<string, ColumnValidationState>([
      [
        "郵便番号",
        {
          status: "warning",
          nonNullCount: 2,
          uncastableCount: 1,
          samples: [{ original: "abc", parsed: null }],
        },
      ],
    ]);
    const { host } = await renderInJsdom(
      <RegisteredSummary
        {...baseProps({
          typeOverrides: [{ column: "郵便番号", category: "text" }],
          validation,
        })}
      />,
    );
    const status = host.querySelector('[role="status"]');
    expect(status).not.toBeNull();
    expect(status?.textContent).toContain("1件");
    // Trust anchor copy (errorCopy.ts's own 2-layer discipline): must never
    // let a user believe their source file itself was modified.
    expect(status?.textContent).toContain("元のファイルは変更されません");
  });

  it("marks a cast-failed cell with the original raw value and a non-color-dependent '⚠' glyph, not a blank cell (WCAG 1.4.1)", async () => {
    const previewRows = [
      { values: { 郵便番号: "abc", amount: "1,200", tags: "" }, castFailed: new Set(["郵便番号"]) },
    ];
    const { host } = await renderInJsdom(
      <RegisteredSummary {...baseProps({ previewRows, sample: { ...sample(), rows: [] } })} />,
    );
    const cells = host.querySelectorAll("tbody td");
    expect(cells[0]?.textContent).toContain("⚠");
    expect(cells[0]?.textContent).toContain("abc");
    expect(cells[0]?.getAttribute("title")).not.toBeNull();
  });

  it("renders a distinct message when a column's validation query itself failed (/code-review Angle A/C/D, previously invisible)", async () => {
    const validation = new Map<string, ColumnValidationState>([["郵便番号", { status: "failed" }]]);
    const { host } = await renderInJsdom(
      <RegisteredSummary
        {...baseProps({ typeOverrides: [{ column: "郵便番号", category: "text" }], validation })}
      />,
    );
    const status = host.querySelector('[role="status"]');
    expect(status).not.toBeNull();
    expect(status?.textContent).toContain("検証に失敗しました");
    expect(status?.textContent).toContain("元のファイルは変更されません");
  });

  it("renders a precision-loss advisory even when the column's validation status is 'valid' (/code-review Angle D, previously invisible)", async () => {
    const validation = new Map<string, ColumnValidationState>([
      [
        "郵便番号",
        { status: "valid", samples: [], advisory: { kind: "precision-loss", count: 3 } },
      ],
    ]);
    const { host } = await renderInJsdom(
      <RegisteredSummary
        {...baseProps({
          typeOverrides: [{ column: "郵便番号", category: "number" }],
          validation,
        })}
      />,
    );
    const status = host.querySelector('[role="status"]');
    expect(status).not.toBeNull();
    expect(status?.textContent).toContain("3件");
    expect(status?.textContent).toContain("精度が失われる可能性があります");
  });

  it("renders a date-offset-discarded advisory alongside a 'warning' status for the same column", async () => {
    const validation = new Map<string, ColumnValidationState>([
      [
        "amount",
        {
          status: "warning",
          nonNullCount: 2,
          uncastableCount: 1,
          samples: [{ original: "abc", parsed: null }],
          advisory: { kind: "date-offset-discarded", count: 2 },
        },
      ],
    ]);
    const { host } = await renderInJsdom(
      <RegisteredSummary
        {...baseProps({ typeOverrides: [{ column: "amount", category: "date" }], validation })}
      />,
    );
    const status = host.querySelector('[role="status"]');
    expect(status?.textContent).toContain("1件");
    expect(status?.textContent).toContain("2件");
    expect(status?.textContent).toContain("タイムゾーン情報が含まれていました");
  });

  it("suppresses a stale cast-failure marker while the source's preview is pending (/code-review Angle A, confirmed)", async () => {
    const previewRows = [
      { values: { 郵便番号: "abc", amount: "1,200", tags: "" }, castFailed: new Set(["郵便番号"]) },
    ];
    const validation = new Map<string, ColumnValidationState>([
      ["郵便番号", { status: "pending" }],
    ]);
    const { host } = await renderInJsdom(
      <RegisteredSummary
        {...baseProps({
          previewRows,
          validation,
          previewPending: true,
          sample: { ...sample(), rows: [] },
        })}
      />,
    );
    const cells = host.querySelectorAll("tbody td");
    expect(cells[0]?.textContent).not.toContain("⚠");
  });

  // QA finding (2026-07-22, live DuckDB-WASM run): validation resolves
  // BEFORE the preview refresh does -- a column's own status can already be
  // "valid"/"warning" (no longer "pending") while `previewPending` is still
  // true for the whole source, and the marker must still stay suppressed
  // for that gap, not just for the narrower "pending" validation window.
  it("keeps suppressing a stale cast-failure marker even after validation resolves, as long as the source's preview is still pending", async () => {
    const previewRows = [
      { values: { 郵便番号: "abc", amount: "1,200", tags: "" }, castFailed: new Set(["郵便番号"]) },
    ];
    const validation = new Map<string, ColumnValidationState>([
      ["郵便番号", { status: "valid", samples: [] }],
    ]);
    const { host } = await renderInJsdom(
      <RegisteredSummary
        {...baseProps({
          previewRows,
          validation,
          previewPending: true,
          sample: { ...sample(), rows: [] },
        })}
      />,
    );
    const cells = host.querySelectorAll("tbody td");
    expect(cells[0]?.textContent).not.toContain("⚠");
  });

  it("does not mark a genuinely-empty cell as a cast failure", async () => {
    const previewRows = [
      { values: { 郵便番号: null, amount: "1,200", tags: "" }, castFailed: new Set<string>() },
    ];
    const { host } = await renderInJsdom(
      <RegisteredSummary {...baseProps({ previewRows, sample: { ...sample(), rows: [] } })} />,
    );
    const cells = host.querySelectorAll("tbody td");
    expect(cells[0]?.textContent).not.toContain("⚠");
  });

  it("right-aligns a number-category column and left-aligns text/date/other columns (Jakob's Law: spreadsheet convention)", async () => {
    const { host } = await renderInJsdom(<RegisteredSummary {...baseProps()} />);
    const cells = host.querySelectorAll("tbody tr:first-child td");
    expect((cells[0] as HTMLElement).style.textAlign).toBe("right");
    expect((cells[1] as HTMLElement).style.textAlign).toBe("left");
  });

  it("a column named __proto__ renders correctly and its cell value is actually reachable (register-path.ts's own __proto__-safety convention extended to this UI)", async () => {
    const protoSample: IntakeSample = {
      table: {
        id: "t2",
        rowCount: 1,
        columns: [{ name: "__proto__", type: "Utf8", category: "text" }],
      },
      // Codex review (Phase 6-B, test adversarial): a `{ __proto__: value }`
      // OBJECT LITERAL is special-cased by the JS spec to set the
      // prototype, not create an own property named "__proto__" -- the
      // exact mistake `rowToPlainObject` (register-path.ts) exists to
      // avoid on the production data path. `Object.fromEntries` (the same
      // construction `rowToPlainObject` itself uses) creates a genuine own
      // property, the realistic shape this test needs to actually exercise.
      rows: [Object.fromEntries([["__proto__", "not-a-real-prototype-value"]])],
      spec: { id: "t2", kind: "file", format: "csv", ref: { name: "t2.csv" } },
    };
    const { host } = await renderInJsdom(
      <RegisteredSummary {...baseProps({ sample: protoSample })} />,
    );
    expect(host.querySelector('select[aria-label="「__proto__」の種類"]')).not.toBeNull();
    // The select existing alone would pass even if the cell value itself
    // were unreachable -- assert the actual data cell too.
    const cell = host.querySelector("tbody td");
    expect(cell?.textContent).toBe("not-a-real-prototype-value");
  });

  it('retains caption + th scope="col" a11y structure (issue #11a precedent)', async () => {
    const { host } = await renderInJsdom(<RegisteredSummary {...baseProps()} />);
    expect(host.querySelector("caption")).not.toBeNull();
    const ths = host.querySelectorAll("th");
    for (const th of ths) expect(th.getAttribute("scope")).toBe("col");
  });

  it("keeps data-table-id on the card root (e2e identity check precedent)", async () => {
    const { host } = await renderInJsdom(<RegisteredSummary {...baseProps()} />);
    expect(host.querySelector(".hyakkei-source-card")?.getAttribute("data-table-id")).toBe("t1");
  });
});
