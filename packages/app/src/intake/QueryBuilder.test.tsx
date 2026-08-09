/** @vitest-environment jsdom */
import type { ColumnMeta } from "@hyakkei/core/datasource";
import type { BuilderState } from "@hyakkei/schema";
import { act, type ReactElement } from "react";
import { createRoot } from "react-dom/client";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { QueryBuilder, type QueryBuilderProps } from "./QueryBuilder.js";
import type { WorkspaceQuery } from "./types.js";

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

// React installs its own tracked-value bookkeeping on a controlled
// `<input>` DOM node; a plain `input.value = x` assignment doesn't reliably
// register as a "real" value change for React's synthetic `onChange` to
// fire from a subsequently dispatched `input` event (a well-known
// React+jsdom testing quirk). Setting through the native prototype's own
// setter, as the DOM itself would for a genuine keystroke, is what
// `@testing-library/user-event` does internally to work around this.
const nativeInputValueSetter = Object.getOwnPropertyDescriptor(
  window.HTMLInputElement.prototype,
  "value",
)?.set;

function typeIntoInput(input: HTMLInputElement, value: string) {
  nativeInputValueSetter?.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

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

const COLUMN_META: ColumnMeta[] = [
  { name: "部署", type: "Utf8", category: "text" },
  { name: "件数", type: "Int64", category: "number" },
  { name: "登録日", type: "Date32", category: "date" },
  { name: "tags", type: "List<Utf8>", category: "other" },
];

function emptyBuilderState(): BuilderState {
  return { filters: [], groupBy: [], measures: [] };
}

function query(overrides: Partial<WorkspaceQuery> = {}): WorkspaceQuery {
  return {
    id: "query_1",
    sourceTableId: "t1",
    builderState: emptyBuilderState(),
    sql: "",
    previewRows: null,
    previewColumns: [],
    diagnostics: null,
    previewPending: false,
    previewError: null,
    ...overrides,
  };
}

function baseProps(overrides: Partial<QueryBuilderProps> = {}): QueryBuilderProps {
  return {
    query: query(),
    sourceLabel: "06-shift_jis.csv",
    columnMeta: COLUMN_META,
    typeOverrides: [],
    onChange: vi.fn(),
    onDelete: vi.fn(),
    onAddChart: vi.fn(),
    ...overrides,
  };
}

describe("QueryBuilder", () => {
  it("renders both zones with no filter/groupBy/measure rows for an empty builderState", async () => {
    const { host } = await renderInJsdom(<QueryBuilder {...baseProps()} />);
    expect(host.querySelector("fieldset legend")?.textContent).toBe("絞り込み");
    expect(host.querySelectorAll("select[aria-label^='条件']")).toHaveLength(0);
    expect(host.querySelectorAll("select[aria-label^='集計の単位']")).toHaveLength(0);
    expect(host.querySelectorAll("select[aria-label^='集計する値']")).toHaveLength(0);
  });

  it("shows a safe memory-specific message when the query preview ran out of memory", async () => {
    const { host } = await renderInJsdom(
      <QueryBuilder {...baseProps({ query: query({ previewError: "oom" }) })} />,
    );

    expect(host.querySelector('[role="alert"]')).not.toBeNull();
    expect(host.textContent).toContain("メモリ不足で集計できませんでした");
    expect(host.textContent).not.toContain("Out of Memory Error");
  });

  it("excludes an 'other'-categoried column from the filter/group-by column list (issue 11c category gate)", async () => {
    const { host } = await renderInJsdom(
      <QueryBuilder
        {...baseProps({
          query: query({
            builderState: {
              filters: [{ column: "部署", operator: "eq", value: "" }],
              groupBy: [],
              measures: [],
            },
          }),
        })}
      />,
    );
    const columnSelect = host.querySelector('select[aria-label="条件1: 列"]') as HTMLSelectElement;
    const optionValues = [...columnSelect.options].map((o) => o.value);
    expect(optionValues).not.toContain("tags");
    expect(optionValues).toEqual(["部署", "件数", "登録日"]);
  });

  // Codex test-adversarial review finding: no test covered the degenerate
  // case where EVERY column is 'other'-categoried -- filterableColumns
  // becomes empty, and "＋ 条件を追加"/"＋ 単位を追加" must disable rather
  // than silently do nothing (or worse, add a row with no valid column to
  // select) when clicked.
  it("disables '＋ 条件を追加' and '＋ 単位を追加', and never calls onChange, when every column is 'other'-categoried", async () => {
    const onChange = vi.fn();
    const allOtherColumns: ColumnMeta[] = [
      { name: "tags", type: "List<Utf8>", category: "other" },
      { name: "blob", type: "Binary", category: "other" },
    ];
    const { host } = await renderInJsdom(
      <QueryBuilder {...baseProps({ onChange, columnMeta: allOtherColumns })} />,
    );
    const addFilterButton = [...host.querySelectorAll("button")].find(
      (b) => b.textContent === "＋ 条件を追加",
    ) as HTMLButtonElement;
    const addGroupByButton = [...host.querySelectorAll("button")].find(
      (b) => b.textContent === "＋ 単位を追加",
    ) as HTMLButtonElement;
    expect(addFilterButton.disabled).toBe(true);
    expect(addGroupByButton.disabled).toBe(true);
    await act(async () => {
      addFilterButton.click();
      addGroupByButton.click();
    });
    expect(onChange).not.toHaveBeenCalled();
  });

  it("offers only 5 operators (Hick's Law) for a text-category filter column, including is_null/is_not_null", async () => {
    const { host } = await renderInJsdom(
      <QueryBuilder
        {...baseProps({
          query: query({
            builderState: {
              filters: [{ column: "部署", operator: "eq", value: "" }],
              groupBy: [],
              measures: [],
            },
          }),
        })}
      />,
    );
    const operatorSelect = host.querySelector(
      'select[aria-label="条件1: 演算子"]',
    ) as HTMLSelectElement;
    const optionValues = [...operatorSelect.options].map((o) => o.value);
    expect(optionValues).toEqual(["eq", "contains", "not_contains", "is_null", "is_not_null"]);
  });

  it("offers 8 comparison operators (no contains/not_contains) for a number-category filter column", async () => {
    const { host } = await renderInJsdom(
      <QueryBuilder
        {...baseProps({
          query: query({
            builderState: {
              filters: [{ column: "件数", operator: "eq", value: "" }],
              groupBy: [],
              measures: [],
            },
          }),
        })}
      />,
    );
    const operatorSelect = host.querySelector(
      'select[aria-label="条件1: 演算子"]',
    ) as HTMLSelectElement;
    const optionValues = [...operatorSelect.options].map((o) => o.value);
    expect(optionValues).toEqual(["eq", "ne", "gt", "gte", "lt", "lte", "is_null", "is_not_null"]);
  });

  // Codex test-adversarial review finding: 登録日 (date) is in COLUMN_META
  // but no test exercised its own operator set -- a date-specific regression
  // (e.g. a swapped label or a dropped operator) could slip through while
  // the text/number cases stay green.
  it("offers the same 8 comparison operator VALUES for a date-category filter column, with date-specific labels", async () => {
    const { host } = await renderInJsdom(
      <QueryBuilder
        {...baseProps({
          query: query({
            builderState: {
              filters: [{ column: "登録日", operator: "eq", value: "" }],
              groupBy: [],
              measures: [],
            },
          }),
        })}
      />,
    );
    const operatorSelect = host.querySelector(
      'select[aria-label="条件1: 演算子"]',
    ) as HTMLSelectElement;
    const options = [...operatorSelect.options];
    expect(options.map((o) => o.value)).toEqual([
      "eq",
      "ne",
      "gt",
      "gte",
      "lt",
      "lte",
      "is_null",
      "is_not_null",
    ]);
    expect(options.map((o) => o.textContent)).toContain("より後");
    expect(options.map((o) => o.textContent)).toContain("以前");
  });

  it("hides the value input for is_null/is_not_null (no value needed)", async () => {
    const { host } = await renderInJsdom(
      <QueryBuilder
        {...baseProps({
          query: query({
            builderState: {
              filters: [{ column: "部署", operator: "is_null" }],
              groupBy: [],
              measures: [],
            },
          }),
        })}
      />,
    );
    expect(host.querySelector('input[aria-label="条件1: 値"]')).toBeNull();
  });

  // /simplify Efficiency finding, issue 11c: the plan's own explicit design
  // decision ("自由テキスト値入力はblur/Enter確定") was not actually
  // implemented until this point -- these tests pin the committed behavior
  // so a future regression back to on-every-keystroke commit is caught.
  it("does not call onChange while typing into the filter value input (commits on blur/Enter, not every keystroke)", async () => {
    const onChange = vi.fn();
    const { host } = await renderInJsdom(
      <QueryBuilder
        {...baseProps({
          onChange,
          query: query({
            builderState: {
              filters: [{ column: "部署", operator: "eq", value: "" }],
              groupBy: [],
              measures: [],
            },
          }),
        })}
      />,
    );
    const input = host.querySelector('input[aria-label="条件1: 値"]') as HTMLInputElement;
    await act(async () => {
      typeIntoInput(input, "住民課");
    });
    expect(onChange).not.toHaveBeenCalled();
    expect(input.value).toBe("住民課");
  });

  it("calls onChange with the typed value when the filter value input is blurred", async () => {
    const onChange = vi.fn();
    const { host } = await renderInJsdom(
      <QueryBuilder
        {...baseProps({
          onChange,
          query: query({
            builderState: {
              filters: [{ column: "部署", operator: "eq", value: "" }],
              groupBy: [],
              measures: [],
            },
          }),
        })}
      />,
    );
    const input = host.querySelector('input[aria-label="条件1: 値"]') as HTMLInputElement;
    // Two separate `act()` calls (not one): the "input" event's `setDraft`
    // must actually flush and re-render (producing a fresh `onBlur` closure
    // over the new `draft`) BEFORE "blur" fires, or `onBlur` reads the
    // PREVIOUS render's stale, not-yet-updated `draft` value.
    await act(async () => {
      typeIntoInput(input, "住民課");
    });
    await act(async () => {
      // React's `onBlur` is a delegated listener for the native "focusout"
      // event (which bubbles), not "blur" (which does not bubble at all,
      // regardless of the `bubbles` flag passed when constructing one).
      input.dispatchEvent(new FocusEvent("focusout", { bubbles: true }));
    });
    expect(onChange).toHaveBeenCalledWith("query_1", {
      filters: [{ column: "部署", operator: "eq", value: "住民課" }],
      groupBy: [],
      measures: [],
    });
  });

  it("calls onChange with the typed value when Enter is pressed in the filter value input", async () => {
    const onChange = vi.fn();
    const { host } = await renderInJsdom(
      <QueryBuilder
        {...baseProps({
          onChange,
          query: query({
            builderState: {
              filters: [{ column: "部署", operator: "eq", value: "" }],
              groupBy: [],
              measures: [],
            },
          }),
        })}
      />,
    );
    const input = host.querySelector('input[aria-label="条件1: 値"]') as HTMLInputElement;
    await act(async () => {
      typeIntoInput(input, "住民課");
    });
    await act(async () => {
      input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    });
    expect(onChange).toHaveBeenCalledWith("query_1", {
      filters: [{ column: "部署", operator: "eq", value: "住民課" }],
      groupBy: [],
      measures: [],
    });
  });

  it("offers only 'count' for a text-category measure column, and sum/count/avg for a number-category one", async () => {
    const { host } = await renderInJsdom(
      <QueryBuilder
        {...baseProps({
          query: query({
            builderState: {
              filters: [],
              groupBy: [],
              measures: [
                { column: "部署", aggregate: "count" },
                { column: "件数", aggregate: "count" },
              ],
            },
          }),
        })}
      />,
    );
    const aggregateSelects = host.querySelectorAll('select[aria-label$=": 集計方法"]');
    const textOptions = [...(aggregateSelects[0] as HTMLSelectElement).options].map((o) => o.value);
    const numberOptions = [...(aggregateSelects[1] as HTMLSelectElement).options].map(
      (o) => o.value,
    );
    expect(textOptions).toEqual(["count"]);
    expect(numberOptions).toEqual(["count", "sum", "avg"]);
  });

  it("offers 'count' (not sum/avg) for an 'other'-categoried measure column (Excel-parity: counting needs no type interpretation, issue 11c category gate)", async () => {
    const { host } = await renderInJsdom(
      <QueryBuilder
        {...baseProps({
          query: query({
            builderState: {
              filters: [],
              groupBy: [],
              measures: [{ column: "tags", aggregate: "count" }],
            },
          }),
        })}
      />,
    );
    const aggregateSelect = host.querySelector(
      'select[aria-label$=": 集計方法"]',
    ) as HTMLSelectElement;
    expect([...aggregateSelect.options].map((o) => o.value)).toEqual(["count"]);
  });

  it("respects an active type override's category over the auto-detected one when gating operators", async () => {
    const { host } = await renderInJsdom(
      <QueryBuilder
        {...baseProps({
          typeOverrides: [{ column: "部署", category: "number" }],
          query: query({
            builderState: {
              filters: [{ column: "部署", operator: "eq", value: "" }],
              groupBy: [],
              measures: [],
            },
          }),
        })}
      />,
    );
    const operatorSelect = host.querySelector(
      'select[aria-label="条件1: 演算子"]',
    ) as HTMLSelectElement;
    expect([...operatorSelect.options].map((o) => o.value)).toContain("gte");
  });

  it("calls onChange with a new filter row appended when '＋ 条件を追加' is clicked", async () => {
    const onChange = vi.fn();
    const { host } = await renderInJsdom(<QueryBuilder {...baseProps({ onChange })} />);
    const button = [...host.querySelectorAll("button")].find(
      (b) => b.textContent === "＋ 条件を追加",
    ) as HTMLButtonElement;
    await act(async () => {
      button.click();
    });
    expect(onChange).toHaveBeenCalledWith("query_1", {
      filters: [{ column: "部署", operator: "eq", value: "" }],
      groupBy: [],
      measures: [],
    });
  });

  it("calls onChange with the filter removed when its own delete button is clicked", async () => {
    const onChange = vi.fn();
    const { host } = await renderInJsdom(
      <QueryBuilder
        {...baseProps({
          onChange,
          query: query({
            builderState: {
              filters: [{ column: "部署", operator: "eq", value: "住民課" }],
              groupBy: [],
              measures: [],
            },
          }),
        })}
      />,
    );
    const button = host.querySelector('button[aria-label="条件1を削除"]') as HTMLButtonElement;
    await act(async () => {
      button.click();
    });
    expect(onChange).toHaveBeenCalledWith("query_1", { filters: [], groupBy: [], measures: [] });
  });

  it("calls onChange with a new group-by row appended when '＋ 単位を追加' is clicked", async () => {
    const onChange = vi.fn();
    const { host } = await renderInJsdom(<QueryBuilder {...baseProps({ onChange })} />);
    const button = [...host.querySelectorAll("button")].find(
      (b) => b.textContent === "＋ 単位を追加",
    ) as HTMLButtonElement;
    await act(async () => {
      button.click();
    });
    expect(onChange).toHaveBeenCalledWith("query_1", {
      filters: [],
      groupBy: ["部署"],
      measures: [],
    });
  });

  it("calls onChange with a new measure row appended when '＋ 値を追加' is clicked, defaulting to count", async () => {
    const onChange = vi.fn();
    const { host } = await renderInJsdom(<QueryBuilder {...baseProps({ onChange })} />);
    const button = [...host.querySelectorAll("button")].find(
      (b) => b.textContent === "＋ 値を追加",
    ) as HTMLButtonElement;
    await act(async () => {
      button.click();
    });
    expect(onChange).toHaveBeenCalledWith("query_1", {
      filters: [],
      groupBy: [],
      measures: [{ column: "部署", aggregate: "count" }],
    });
  });

  it("resets a measure's aggregate to 'count' when its column is changed away from a number category", async () => {
    const onChange = vi.fn();
    const { host } = await renderInJsdom(
      <QueryBuilder
        {...baseProps({
          onChange,
          query: query({
            builderState: {
              filters: [],
              groupBy: [],
              measures: [{ column: "件数", aggregate: "sum" }],
            },
          }),
        })}
      />,
    );
    const columnSelect = host.querySelector(
      'select[aria-label="集計する値1: 列"]',
    ) as HTMLSelectElement;
    await act(async () => {
      columnSelect.value = "部署";
      columnSelect.dispatchEvent(new Event("change", { bubbles: true }));
    });
    expect(onChange).toHaveBeenCalledWith("query_1", {
      filters: [],
      groupBy: [],
      measures: [{ column: "部署", aggregate: "count" }],
    });
  });

  // issue #15/F7, V-012: an unknown field on a measure (e.g. from a file
  // opened with a newer schema version) must survive a column change, not
  // just an aggregate change -- this was the one spread violation among
  // this file's 9 filter/measure edit handlers.
  it("preserves an unknown field on a measure when its column is changed", async () => {
    const onChange = vi.fn();
    const { host } = await renderInJsdom(
      <QueryBuilder
        {...baseProps({
          onChange,
          query: query({
            builderState: {
              filters: [],
              groupBy: [],
              measures: [{ column: "件数", aggregate: "sum", futureField: "kept" } as never],
            },
          }),
        })}
      />,
    );
    const columnSelect = host.querySelector(
      'select[aria-label="集計する値1: 列"]',
    ) as HTMLSelectElement;
    await act(async () => {
      columnSelect.value = "部署";
      columnSelect.dispatchEvent(new Event("change", { bubbles: true }));
    });
    expect(onChange).toHaveBeenCalledWith("query_1", {
      filters: [],
      groupBy: [],
      measures: [{ column: "部署", aggregate: "count", futureField: "kept" }],
    });
  });

  it("marks an invalid filter value with a warning glyph (diagnostics.invalidFilterIndices)", async () => {
    const { host } = await renderInJsdom(
      <QueryBuilder
        {...baseProps({
          query: query({
            builderState: {
              filters: [{ column: "件数", operator: "gt", value: "abc" }],
              groupBy: [],
              measures: [],
            },
            diagnostics: {
              totalCount: 2,
              matchedCount: 0,
              invalidFilterIndices: [0],
              measureExcludedCounts: new Map(),
            },
          }),
        })}
      />,
    );
    expect(host.textContent).toContain("⚠");
    expect(host.querySelector('[title="この値は列の種類として読み取れません"]')).not.toBeNull();
  });

  it("shows the excluded-count warning next to a measure whose column had cast failures", async () => {
    const { host } = await renderInJsdom(
      <QueryBuilder
        {...baseProps({
          query: query({
            builderState: {
              filters: [],
              groupBy: [],
              measures: [{ column: "件数", aggregate: "sum" }],
            },
            diagnostics: {
              totalCount: 5,
              matchedCount: 5,
              invalidFilterIndices: [],
              measureExcludedCounts: new Map([["件数", 2]]),
            },
          }),
        })}
      />,
    );
    expect(host.textContent).toContain("2件は数値として読み取れず除外");
  });

  // App.tsx's `handleOverrideChange` sweep re-runs the query but does not
  // rewrite `measure.aggregate` itself -- the resolver silently drops a
  // measure whose aggregate no longer fits its column's category (same rule
  // a dangling column reference gets), so this warning is what tells the
  // user WHY a measure they configured is missing from the result, instead
  // of it just silently vanishing.
  it("shows a mismatch warning (not the excluded-count one) when a measure's aggregate no longer fits its column's current category", async () => {
    const { host } = await renderInJsdom(
      <QueryBuilder
        {...baseProps({
          query: query({
            builderState: {
              filters: [],
              groupBy: [],
              measures: [{ column: "部署", aggregate: "sum" }],
            },
            diagnostics: {
              totalCount: 5,
              matchedCount: 5,
              invalidFilterIndices: [],
              measureExcludedCounts: new Map(),
            },
          }),
        })}
      />,
    );
    expect(host.textContent).toContain(
      "列の種類が変わったため、この集計は結果から除外されています",
    );
    expect(host.textContent).not.toContain("として読み取れず除外");
  });

  it("does not show the mismatch warning for a measure whose aggregate is still valid for its column's category", async () => {
    const { host } = await renderInJsdom(
      <QueryBuilder
        {...baseProps({
          query: query({
            builderState: {
              filters: [],
              groupBy: [],
              measures: [{ column: "件数", aggregate: "sum" }],
            },
          }),
        })}
      />,
    );
    expect(host.textContent).not.toContain("列の種類が変わったため");
  });

  it("shows '計算中…' while previewPending is true, and the trust-anchor copy once diagnostics resolve", async () => {
    const { host: pendingHost } = await renderInJsdom(
      <QueryBuilder {...baseProps({ query: query({ previewPending: true }) })} />,
    );
    expect(pendingHost.textContent).toContain("計算中…");

    const { host: resolvedHost } = await renderInJsdom(
      <QueryBuilder
        {...baseProps({
          query: query({
            diagnostics: {
              totalCount: 3,
              matchedCount: 2,
              invalidFilterIndices: [],
              measureExcludedCounts: new Map(),
            },
          }),
        })}
      />,
    );
    expect(resolvedHost.textContent).toContain("元のファイルは変更されません");
    expect(resolvedHost.textContent).toContain("該当");
    expect(resolvedHost.textContent).toContain("2");
    expect(resolvedHost.textContent).toContain("全 3 行中");
  });

  it("renders preview rows into the results table using query.previewColumns as headers, not columnMeta", async () => {
    const { host } = await renderInJsdom(
      <QueryBuilder
        {...baseProps({
          query: query({
            previewRows: [{ 部署: "住民課", sum_件数: 45 }],
            previewColumns: ["部署", "sum_件数"],
          }),
        })}
      />,
    );
    const headers = [...host.querySelectorAll("thead th")].map((th) => th.textContent);
    expect(headers).toEqual(["部署", "sum_件数"]);
    expect(host.querySelector("tbody td")?.textContent).toBe("住民課");
  });

  // Codex review R1 (P2): a grouped/aggregated query that legitimately
  // matches ZERO rows must still show ITS OWN output columns (group-by +
  // measure aliases), not the raw source table's -- `previewColumns` comes
  // from the Arrow result's own schema (present even with 0 rows), not
  // derived from `previewRows[0]`'s keys (which don't exist when there are
  // no rows at all).
  it("shows query.previewColumns as headers even when previewRows is empty (a real zero-row aggregate result)", async () => {
    const { host } = await renderInJsdom(
      <QueryBuilder
        {...baseProps({
          query: query({ previewRows: [], previewColumns: ["部署", "sum_件数"] }),
        })}
      />,
    );
    const headers = [...host.querySelectorAll("thead th")].map((th) => th.textContent);
    expect(headers).toEqual(["部署", "sum_件数"]);
  });

  it("falls back to columnMeta's own column names only before any refresh has ever resolved (previewColumns still empty)", async () => {
    const { host } = await renderInJsdom(
      <QueryBuilder {...baseProps({ query: query({ previewColumns: [] }) })} />,
    );
    const headers = [...host.querySelectorAll("thead th")].map((th) => th.textContent);
    expect(headers).toEqual(["部署", "件数", "登録日", "tags"]);
  });

  it("calls onDelete with the query's own id when its delete button is clicked", async () => {
    const onDelete = vi.fn();
    const { host } = await renderInJsdom(<QueryBuilder {...baseProps({ onDelete })} />);
    expect(host.querySelector(".hyakkei-query-card")?.getAttribute("tabindex")).toBe("-1");
    const button = host.querySelector(
      'button[aria-label="「06-shift_jis.csv」の集計を削除"]',
    ) as HTMLButtonElement;
    await act(async () => {
      button.click();
    });
    expect(onDelete).toHaveBeenCalledWith("query_1");
  });

  // issue #102: `queryOrdinal` disambiguates this card's "集計を削除"/
  // "集計をグラフ化" labels from a sibling query card's on the SAME source --
  // omitted/`null` (the baseProps default) keeps the label byte-identical
  // to pre-#102 (asserted above and in the グラフ化 describe block below).
  it("inserts an ordinal into both delete and グラフ化 labels when queryOrdinal is set (2+ siblings)", async () => {
    const { host } = await renderInJsdom(<QueryBuilder {...baseProps({ queryOrdinal: 2 })} />);
    expect(
      host.querySelector('button[aria-label="「06-shift_jis.csv」の集計2を削除"]'),
    ).not.toBeNull();
    expect(
      host.querySelector('button[aria-label="「06-shift_jis.csv」の集計2をグラフ化"]'),
    ).not.toBeNull();
    expect(host.querySelector('button[aria-label="「06-shift_jis.csv」の集計を削除"]')).toBeNull();
  });

  // issue #12: the "グラフ化" button is the sole entry point into chart
  // creation -- disabled until previewColumns resolves (shape enumeration
  // V-010), so a chart can never be created from a query with no columns
  // to build a valid encoding from.
  describe("グラフ化 button", () => {
    function graphButton(host: HTMLElement) {
      return host.querySelector(
        'button[aria-label="「06-shift_jis.csv」の集計をグラフ化"]',
      ) as HTMLButtonElement;
    }

    it("is disabled while previewColumns has not resolved yet", async () => {
      const { host } = await renderInJsdom(
        <QueryBuilder {...baseProps({ query: query({ previewColumns: [] }) })} />,
      );
      expect(graphButton(host).disabled).toBe(true);
    });

    // Code review (Angle Altitude/Cross-file, 2 independent convergent
    // findings): this button must gate on `usableColumns`, not raw
    // `previewColumns.length` -- otherwise it renders enabled for a query
    // whose only output column(s) are empty-string names, and clicking it
    // silently no-ops (handleAddChart's own guard) with zero feedback.
    it("is disabled when previewColumns contains only empty-string entries", async () => {
      const { host } = await renderInJsdom(
        <QueryBuilder {...baseProps({ query: query({ previewColumns: [""] }) })} />,
      );
      expect(graphButton(host).disabled).toBe(true);
    });

    it("is disabled while a refresh is pending, even if previewColumns is already populated", async () => {
      const { host } = await renderInJsdom(
        <QueryBuilder
          {...baseProps({
            query: query({ previewColumns: ["部署"], previewPending: true }),
          })}
        />,
      );
      expect(graphButton(host).disabled).toBe(true);
    });

    it("is enabled once previewColumns has resolved, and calls onAddChart with the query's own id", async () => {
      const onAddChart = vi.fn();
      const { host } = await renderInJsdom(
        <QueryBuilder {...baseProps({ query: query({ previewColumns: ["部署"] }), onAddChart })} />,
      );
      const button = graphButton(host);
      expect(button.disabled).toBe(false);
      await act(async () => {
        button.click();
      });
      expect(onAddChart).toHaveBeenCalledWith("query_1");
    });
  });
});
