import type {
  DataSourceErrorKind,
  NetworkBlockedReason,
  RegisteredTable,
} from "@hyakkei/core/datasource";

export type IntakeError = {
  kind: DataSourceErrorKind;
  reason: NetworkBlockedReason | undefined;
  message: string;
};

export type IntakeSample = {
  table: RegisteredTable;
  rows: Record<string, unknown>[];
};

/**
 * D10's 5 states (Empty/Reading/SheetPick/Preview+Registered統合/Error),
 * collapsed to the exact set the plan names — `inspect()` and `register()`
 * both render as "reading" (no separate "registering" phase: neither
 * `EgressPolicy.fetchBytes()` nor `DataSource.register()` exposes a
 * progress callback today, so a UI-visible distinction between the two
 * calls would be fabricated, not observed — plan's own "known follow-up"
 * scope boundary, same gap as the missing `AbortSignal`). "Preview" and
 * "Registered" are the same `registered` phase (D10's eager-register
 * decision: by the time this state exists, the table is already live and
 * queryable — there is nothing left to separately "confirm").
 */
export type IntakeState =
  | { phase: "empty"; note?: string }
  | {
      phase: "blocked";
      sourceLabel: string;
      reason: NetworkBlockedReason | undefined;
      message: string;
    }
  | { phase: "reading"; sourceLabel: string }
  | { phase: "sheet-pick"; sourceLabel: string; sheets: string[] }
  | { phase: "registered"; sourceLabel: string; sample: IntakeSample }
  | { phase: "error"; sourceLabel: string; error: IntakeError };

export type IntakeAction =
  | { type: "SUBMIT"; sourceLabel: string }
  | {
      type: "BLOCKED";
      sourceLabel: string;
      reason: NetworkBlockedReason | undefined;
      message: string;
    }
  | { type: "SHEETS_FOUND"; sheets: string[] }
  | { type: "SHEET_CHOSEN" }
  | { type: "REGISTERED"; sample: IntakeSample }
  | { type: "FAILED"; error: IntakeError }
  | { type: "CANCEL" }
  | { type: "RESET"; note?: string };

export const INITIAL_STATE: IntakeState = { phase: "empty" };

/**
 * Pure by construction (no DuckDB/network/timer access) — the caller
 * (`IntakeApp.tsx`) is solely responsible for deciding WHEN to dispatch
 * (including discarding a stale async result via its own generation
 * counter before ever calling `dispatch`); this function only decides
 * WHAT the next state is, given an action it trusts already happened.
 *
 * `BLOCKED`/`SHEETS_FOUND`/`SHEET_CHOSEN`/`REGISTERED`/`FAILED` all guard on
 * the current phase (return `state` unchanged otherwise) — the same
 * discard-stale-transition discipline the caller (`IntakeApp.tsx`'s
 * generation counter) applies to async results, applied here too as a
 * second line of defense (/code-review: `FAILED`/`BLOCKED` were the two
 * exceptions to this convention until now — an asymmetry independently
 * flagged from two different review angles). Every action here is only
 * ever meaningful arriving from ONE specific phase in `IntakeApp.tsx`'s
 * actual call sites (`BLOCKED` only from `UrlPanel`, itself only mounted
 * during "empty"; `FAILED` only from an async continuation started while
 * "reading"), so guarding all five is what makes the reducer's own
 * documentation of its stale-dispatch discipline actually match its code,
 * not a behavior change under correct operation.
 */
export function intakeReducer(state: IntakeState, action: IntakeAction): IntakeState {
  switch (action.type) {
    case "SUBMIT":
      return { phase: "reading", sourceLabel: action.sourceLabel };
    case "BLOCKED":
      if (state.phase !== "empty") return state;
      return {
        phase: "blocked",
        sourceLabel: action.sourceLabel,
        reason: action.reason,
        message: action.message,
      };
    case "SHEETS_FOUND":
      if (state.phase !== "reading") return state;
      return { phase: "sheet-pick", sourceLabel: state.sourceLabel, sheets: action.sheets };
    case "SHEET_CHOSEN":
      if (state.phase !== "sheet-pick") return state;
      return { phase: "reading", sourceLabel: state.sourceLabel };
    case "REGISTERED":
      if (state.phase !== "reading") return state;
      return { phase: "registered", sourceLabel: state.sourceLabel, sample: action.sample };
    case "FAILED":
      if (state.phase !== "reading") return state;
      return { phase: "error", sourceLabel: state.sourceLabel, error: action.error };
    case "CANCEL":
      return { phase: "empty", note: "読み込みを中止しました" };
    case "RESET":
      // `note` is optional and caller-supplied (UX review M-2): a plain
      // reset (error retry, blocked-URL back) carries none, but a
      // successful "確定" carries a completion note — without this, the
      // one moment a registration actually SUCCEEDED gave less feedback
      // than cancelling one, exactly the "登録できたが何も起きない"
      // dead-end D7 otherwise avoids.
      return { phase: "empty", note: action.note };
  }
}
