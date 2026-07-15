import { describe, expect, it } from "vitest";
import { INITIAL_STATE, intakeReducer, type IntakeState } from "./types.js";

const sample = { table: { id: "t1", columns: [], rowCount: 0 }, rows: [] };
const error = { kind: "corrupt" as const, reason: undefined, message: "bad" };

describe("intakeReducer", () => {
  it("INITIAL_STATE is empty with no note", () => {
    expect(INITIAL_STATE).toEqual({ phase: "empty" });
  });

  it("SUBMIT moves to reading with the source label, from any prior state", () => {
    const from: IntakeState = { phase: "registered", sourceLabel: "old.csv", sample };
    expect(intakeReducer(from, { type: "SUBMIT", sourceLabel: "new.csv" })).toEqual({
      phase: "reading",
      sourceLabel: "new.csv",
    });
  });

  it("BLOCKED moves to blocked from 'empty' (UrlPanel's preflight runs before SUBMIT, while still in 'empty')", () => {
    expect(
      intakeReducer(INITIAL_STATE, {
        type: "BLOCKED",
        sourceLabel: "https://evil.example/x.csv",
        reason: "third-party",
        message: "blocked",
      }),
    ).toEqual({
      phase: "blocked",
      sourceLabel: "https://evil.example/x.csv",
      reason: "third-party",
      message: "blocked",
    });
  });

  it("BLOCKED is a no-op outside 'empty' (/code-review: matches the reducer's other stale-transition guards)", () => {
    const reading: IntakeState = { phase: "reading", sourceLabel: "x.csv" };
    expect(
      intakeReducer(reading, {
        type: "BLOCKED",
        sourceLabel: "https://evil.example/x.csv",
        reason: "third-party",
        message: "blocked",
      }),
    ).toBe(reading);
  });

  it("SHEETS_FOUND transitions reading -> sheet-pick, carrying the source label forward", () => {
    const reading: IntakeState = { phase: "reading", sourceLabel: "book.xlsx" };
    expect(intakeReducer(reading, { type: "SHEETS_FOUND", sheets: ["Sheet1", "Sheet2"] })).toEqual({
      phase: "sheet-pick",
      sourceLabel: "book.xlsx",
      sheets: ["Sheet1", "Sheet2"],
    });
  });

  it("SHEETS_FOUND is a no-op outside 'reading' (stale async result discarded)", () => {
    expect(intakeReducer(INITIAL_STATE, { type: "SHEETS_FOUND", sheets: ["Sheet1"] })).toBe(
      INITIAL_STATE,
    );
  });

  it("SHEET_CHOSEN transitions sheet-pick -> reading, carrying the source label forward", () => {
    const sheetPick: IntakeState = {
      phase: "sheet-pick",
      sourceLabel: "book.xlsx",
      sheets: ["Sheet1", "Sheet2"],
    };
    expect(intakeReducer(sheetPick, { type: "SHEET_CHOSEN" })).toEqual({
      phase: "reading",
      sourceLabel: "book.xlsx",
    });
  });

  it("SHEET_CHOSEN is a no-op outside 'sheet-pick'", () => {
    const reading: IntakeState = { phase: "reading", sourceLabel: "x.csv" };
    expect(intakeReducer(reading, { type: "SHEET_CHOSEN" })).toBe(reading);
  });

  it("REGISTERED from reading carries the source label into the registered state", () => {
    const reading: IntakeState = { phase: "reading", sourceLabel: "x.csv" };
    expect(intakeReducer(reading, { type: "REGISTERED", sample })).toEqual({
      phase: "registered",
      sourceLabel: "x.csv",
      sample,
    });
  });

  it("REGISTERED is a no-op outside 'reading' (Codex R1 P2: matches SHEETS_FOUND/SHEET_CHOSEN's stale-transition discipline)", () => {
    expect(intakeReducer(INITIAL_STATE, { type: "REGISTERED", sample })).toBe(INITIAL_STATE);
  });

  it("FAILED transitions reading -> error, carrying the source label forward", () => {
    const reading: IntakeState = { phase: "reading", sourceLabel: "book.xlsx" };
    expect(intakeReducer(reading, { type: "FAILED", error })).toEqual({
      phase: "error",
      sourceLabel: "book.xlsx",
      error,
    });
  });

  it("FAILED is a no-op outside 'reading' (/code-review: every real call site only ever dispatches FAILED while 'reading' — sheet-pick pauses all async work until SHEET_CHOSEN returns to 'reading' first)", () => {
    const sheetPick: IntakeState = { phase: "sheet-pick", sourceLabel: "book.xlsx", sheets: [] };
    expect(intakeReducer(sheetPick, { type: "FAILED", error })).toBe(sheetPick);
    expect(intakeReducer(INITIAL_STATE, { type: "FAILED", error })).toBe(INITIAL_STATE);
  });

  it("CANCEL returns to empty with a distinct note from a plain RESET", () => {
    const reading: IntakeState = { phase: "reading", sourceLabel: "x.csv" };
    expect(intakeReducer(reading, { type: "CANCEL" })).toEqual({
      phase: "empty",
      note: "読み込みを中止しました",
    });
  });

  it("RESET returns to empty with no note when the caller supplies none", () => {
    const registered: IntakeState = { phase: "registered", sourceLabel: "x.csv", sample };
    expect(intakeReducer(registered, { type: "RESET" })).toEqual({ phase: "empty" });
  });

  it("RESET carries a caller-supplied note (UX review M-2: 確定 leaves a completion note, distinct from a plain reset)", () => {
    const registered: IntakeState = { phase: "registered", sourceLabel: "x.csv", sample };
    expect(
      intakeReducer(registered, { type: "RESET", note: "「x.csv」を取り込みました。" }),
    ).toEqual({
      phase: "empty",
      note: "「x.csv」を取り込みました。",
    });
  });
});
