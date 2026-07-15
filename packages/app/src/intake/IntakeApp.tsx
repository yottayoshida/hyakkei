import {
  createEgressPolicy,
  createFileSource,
  createUrlSource,
  DataSourceError,
  DEFAULT_MAX_BYTES,
  quoteIdentifier,
  rowToPlainObject,
  type DataSource,
  type EgressPolicy,
  type NetworkBlockedReason,
  type RegisterContext,
} from "@hyakkei/core/datasource";
import type { Source } from "@hyakkei/schema";
import { useCallback, useEffect, useReducer, useRef } from "react";
import { createDuckDB, type DuckDBHandle } from "../duckdb/factory.js";
import { BlockedPanel } from "./BlockedPanel.js";
import { DropZone } from "./DropZone.js";
import { ErrorPanel } from "./ErrorPanel.js";
import { generateSourceId } from "./identifier.js";
import { ReadingPanel } from "./ReadingPanel.js";
import { RegisteredSummary } from "./RegisteredSummary.js";
import { SheetPickPanel } from "./SheetPickPanel.js";
import { INITIAL_STATE, intakeReducer, type IntakeError, type IntakeSample } from "./types.js";
import { UrlPanel } from "./UrlPanel.js";

// Module-level singleton, same pattern as register-harness-main.ts: a
// single intake.html document only ever needs one DuckDB instance, and
// `createDuckDB()` is itself lazy (only called on first use).
//
// On rejection, `handlePromise` is cleared so the NEXT call retries from
// scratch (/code-review, 3 independent finder angles): `??=` alone only
// reassigns when nullish, and a rejected promise is not nullish — without
// this, one transient init failure (a slow vendor-file fetch tripping
// factory.ts's 15s timeout, a flaky Worker bootstrap) would wedge the
// intake page for the rest of the session, with every subsequent
// registration attempt awaiting the same stale rejection regardless of
// whether the underlying condition had already cleared.
let handlePromise: Promise<DuckDBHandle> | undefined;
function getHandle(): Promise<DuckDBHandle> {
  handlePromise ??= createDuckDB().catch((err: unknown) => {
    handlePromise = undefined;
    throw err;
  });
  return handlePromise;
}

/** `FileSource` must never reach the network (mirror-seam asymmetry, same guard register-harness-main.ts uses for the same reason). */
const forbiddenEgress: EgressPolicy = {
  fetchBytes(): Promise<Uint8Array> {
    throw new Error("intake: FileSource must not call egress.fetchBytes");
  },
};

function fileFormatFromName(name: string): "csv" | "xlsx" | "parquet" | undefined {
  const ext = name.toLowerCase().split(".").pop();
  if (ext === "csv") return "csv";
  if (ext === "xlsx") return "xlsx";
  if (ext === "parquet") return "parquet";
  return undefined;
}

/** `UrlSource.format` is `csv | parquet` only (schema) — an unrecognized extension defaults to csv, the overwhelmingly common open-data format; a wrong guess still fails safely via the shared register path's own sniff/parse (`unsupported-format`/`non-csv-response`), not silently. */
function urlFormatFromPath(url: string): "csv" | "parquet" {
  try {
    return new URL(url).pathname.toLowerCase().endsWith(".parquet") ? "parquet" : "csv";
  } catch {
    return "csv";
  }
}

type FileSourceSpec = Extract<Source, { kind: "file" }>;
type UrlSourceSpec = Extract<Source, { kind: "url" }>;

// Return type is the narrow `FileSourceSpec`/`UrlSourceSpec` (not the full
// `Source` union `createFileSource`/`createUrlSource` themselves don't
// accept) -- annotating the wider `Source` here would erase the very
// discrimination each `case` branch encodes, and fail exactly where the
// caller needs it narrow.
function buildFileSpec(
  id: string,
  format: "csv" | "xlsx" | "parquet",
  name: string,
): FileSourceSpec {
  switch (format) {
    case "csv":
      return { id, kind: "file", format: "csv", ref: { name } };
    case "xlsx":
      return { id, kind: "file", format: "xlsx", ref: { name } };
    case "parquet":
      return { id, kind: "file", format: "parquet", ref: { name } };
  }
}

function buildUrlSpec(id: string, format: "csv" | "parquet", url: string): UrlSourceSpec {
  return { id, kind: "url", format, ref: { url } };
}

/** Not a `DataSourceError` means an unexpected internal failure, not a content problem this UI can name precisely — "corrupt" is the closest honest approximation among the 10 kinds, not a claim about what actually happened. */
function toIntakeError(err: unknown): IntakeError {
  if (err instanceof DataSourceError) {
    return { kind: err.kind, reason: err.reason, message: err.message };
  }
  return {
    kind: "corrupt",
    reason: undefined,
    message: err instanceof Error ? err.message : String(err),
  };
}

type PendingSheetPick = {
  source: DataSource;
  ctx: RegisterContext;
  id: string;
  generation: number;
};

export function IntakeApp() {
  // Without this, dropping a file OUTSIDE `DropZone`'s own bounds (its
  // `onDrop` only covers its own element) falls through to the browser's
  // native default: navigating the tab to open the dropped file, which
  // tears down this entire page -- discarding every table already
  // registered into DuckDB-WASM's in-memory, session-scoped database
  // (QA review: reproducible by dragging a 2nd file anywhere onto the
  // already-registered payoff screen, since `DropZone` itself is unmounted
  // outside "empty" and can't intercept it there either). A native `drop`
  // handler only suppresses the browser default if the ALSO-native
  // `dragover` for that drop was itself prevented -- both are required.
  useEffect(() => {
    const preventDefault = (event: DragEvent) => event.preventDefault();
    window.addEventListener("dragover", preventDefault);
    window.addEventListener("drop", preventDefault);
    return () => {
      window.removeEventListener("dragover", preventDefault);
      window.removeEventListener("drop", preventDefault);
    };
  }, []);

  const [state, dispatch] = useReducer(intakeReducer, INITIAL_STATE);
  // Every id currently backed by a LIVE table in this session — `register()`
  // is a plain `CREATE TABLE`, never `CREATE OR REPLACE`, so reusing an id a
  // still-live table owns throws a DuckDB error that would otherwise
  // surface as a misleading "content is corrupt" message (identifier.ts's
  // own doc comment explains why this matters). Reserved eagerly (before
  // `register()` even runs, see `runRegistration`) and reclaimed only after
  // a confirmed `DROP TABLE` (see `handleRedo`) — an id sits in this set for
  // exactly as long as (or longer than, for an unabortable cancelled
  // registration) a real table by that name might exist.
  const usedIdsRef = useRef<Set<string>>(new Set());
  // Bumped on every SUBMIT/CANCEL/RESET — an in-flight async step checks
  // its own captured generation against this before ever calling
  // `dispatch`, so a result that arrives after the user cancelled or
  // started a different source is silently discarded instead of
  // resurrecting stale state (this IS the "cancel" this UI can actually
  // offer: `DataSource.register()`/`inspect()` expose no `AbortSignal` to
  // truly abort the underlying work — plan's own tracked follow-up).
  const generationRef = useRef(0);
  const pendingSheetPickRef = useRef<PendingSheetPick | null>(null);

  const runRegistration = useCallback(
    async (
      source: DataSource,
      ctx: RegisterContext,
      id: string,
      generation: number,
      sheet: string | undefined,
    ) => {
      // Reserved BEFORE `register()` runs, not after it resolves (Codex
      // R1 P1): `register()`'s `CREATE TABLE` is a real side effect that
      // this UI cannot truly abort (no `AbortSignal` on the core API) — it
      // can commit even after the user has already cancelled and this
      // call's `generation` has gone stale. Reserving late left a window
      // where that committed-but-abandoned table's id stayed absent from
      // `usedIdsRef`, so a later identical source could regenerate the
      // exact same id and collide with it (`CREATE TABLE` on an
      // already-existing name), surfacing as a misleading "corrupt" error
      // for what is actually an id-reuse bug, not a content problem.
      usedIdsRef.current.add(id);
      try {
        // `sheet !== undefined`, not a truthy check (/code-review): a
        // truthy check would silently fall back to the workbook's first
        // sheet if the user-chosen sheet's name happened to be the empty
        // string (ExcelJS does not itself reject `""` as a sheet name,
        // even though normal Excel usage never produces one) — registering
        // the wrong sheet's data while the UI still claims the chosen one
        // was registered.
        const table = await source.register(ctx, sheet !== undefined ? { sheet } : undefined);
        if (generation !== generationRef.current) return;
        const result = await ctx.registrar.conn.query(
          `SELECT * FROM ${quoteIdentifier(id)} LIMIT 5`,
        );
        if (generation !== generationRef.current) return;
        const rows = result
          .toArray()
          .map((row) => rowToPlainObject(row as unknown as Iterable<[string, unknown]>));
        const sample: IntakeSample = { table, rows };
        dispatch({ type: "REGISTERED", sample });
      } catch (err) {
        if (generation !== generationRef.current) return;
        dispatch({ type: "FAILED", error: toIntakeError(err) });
      }
    },
    [],
  );

  const startFile = useCallback(
    async (file: File) => {
      const generation = ++generationRef.current;
      dispatch({ type: "SUBMIT", sourceLabel: file.name });

      const format = fileFormatFromName(file.name);
      if (!format) {
        dispatch({
          type: "FAILED",
          error: {
            kind: "unsupported-format",
            reason: undefined,
            message: `unrecognized file extension: ${file.name}`,
          },
        });
        return;
      }

      // Checked against `file.size` (cheap metadata) BEFORE
      // `file.arrayBuffer()` fully materializes the file in memory
      // (Security review F-1): without this, a multi-GB local file
      // selection can OOM-crash the tab before `assertByteCeiling`
      // (byte-gate.ts, deep inside `inspect()`/`register()`) ever gets a
      // chance to reject it as `too-large` -- unlike the URL path, where
      // `readBodyCapped` (egress-policy.ts) streams and counts bytes
      // without ever fully buffering past the same limit.
      if (file.size > DEFAULT_MAX_BYTES) {
        dispatch({
          type: "FAILED",
          error: {
            kind: "too-large",
            reason: undefined,
            message: `content is ${file.size} bytes, exceeding the ${DEFAULT_MAX_BYTES}-byte limit`,
          },
        });
        return;
      }

      try {
        const bytes = new Uint8Array(await file.arrayBuffer());
        if (generation !== generationRef.current) return;
        const id = generateSourceId(file.name, usedIdsRef.current);
        const spec = buildFileSpec(id, format, file.name);
        const source = createFileSource(spec, bytes);
        const { db, conn } = await getHandle();
        if (generation !== generationRef.current) return;
        const ctx: RegisterContext = { registrar: { db, conn }, egress: forbiddenEgress };
        const shape = await source.inspect(ctx);
        if (generation !== generationRef.current) return;

        if (shape.kind === "sheets" && shape.sheets.length > 1) {
          pendingSheetPickRef.current = { source, ctx, id, generation };
          dispatch({ type: "SHEETS_FOUND", sheets: shape.sheets });
          return;
        }
        const sheet = shape.kind === "sheets" ? shape.sheets[0] : undefined;
        await runRegistration(source, ctx, id, generation, sheet);
      } catch (err) {
        if (generation !== generationRef.current) return;
        dispatch({ type: "FAILED", error: toIntakeError(err) });
      }
    },
    [runRegistration],
  );

  const startUrl = useCallback(
    async (url: string) => {
      const generation = ++generationRef.current;
      dispatch({ type: "SUBMIT", sourceLabel: url });
      try {
        const format = urlFormatFromPath(url);
        const id = generateSourceId(url, usedIdsRef.current);
        const spec = buildUrlSpec(id, format, url);
        const source = createUrlSource(spec);
        const { db, conn } = await getHandle();
        if (generation !== generationRef.current) return;
        // The real policy (https-only/same-origin/size-capped/timeout),
        // not register-harness.html's deliberately loose test stub —
        // this is production UI, `UrlPanel`'s preflight is UX, this is
        // the actual security boundary.
        const egress = createEgressPolicy({ selfOrigin: window.location.origin });
        const ctx: RegisterContext = { registrar: { db, conn }, egress };
        await source.inspect(ctx);
        if (generation !== generationRef.current) return;
        // `UrlSource.spec.format` is `csv | parquet` only (schema) — its
        // `inspect()` can never return `{kind:"sheets"}`, so no sheet-pick
        // branch is needed on this path.
        await runRegistration(source, ctx, id, generation, undefined);
      } catch (err) {
        if (generation !== generationRef.current) return;
        dispatch({ type: "FAILED", error: toIntakeError(err) });
      }
    },
    [runRegistration],
  );

  const handleSheetChosen = useCallback(
    (sheet: string) => {
      const pending = pendingSheetPickRef.current;
      if (!pending || pending.generation !== generationRef.current) return;
      pendingSheetPickRef.current = null;
      dispatch({ type: "SHEET_CHOSEN" });
      void runRegistration(pending.source, pending.ctx, pending.id, pending.generation, sheet);
    },
    [runRegistration],
  );

  const handleCancel = useCallback(() => {
    generationRef.current++;
    pendingSheetPickRef.current = null;
    dispatch({ type: "CANCEL" });
  }, []);

  const handleReset = useCallback((note?: string) => {
    generationRef.current++;
    pendingSheetPickRef.current = null;
    dispatch({ type: "RESET", note });
  }, []);

  const handleConfirm = useCallback(() => {
    if (state.phase !== "registered") return;
    // Confirm and redo both return to "empty", but previously looked
    // IDENTICAL to the user (UX review M-2, Hick's Law: a 2-choice screen
    // whose choices produce the same visible outcome). A completion note
    // (asymmetric with the plain, note-less reset every other path uses)
    // is what makes "確定" actually confirm something happened, rather
    // than just closing the screen the way "やり直す"/cancel do.
    handleReset(`「${state.sourceLabel}」を取り込みました。`);
  }, [state, handleReset]);

  const handleUrlBlocked = useCallback(
    (url: string, reason: NetworkBlockedReason | undefined, message: string) => {
      dispatch({ type: "BLOCKED", sourceLabel: url, reason, message });
    },
    [],
  );

  const handleRedo = useCallback(async () => {
    if (state.phase !== "registered") return;
    const tableId = state.sample.table.id;
    try {
      const { conn } = await getHandle();
      // An abandoned registration's table is otherwise dead weight for the
      // rest of the session (M1 has no cross-session persistence to worry
      // about) — cleaning it up here is the plan's own risk-table item
      // ("eager registerで「やり直す」時の掃除漏れ").
      await conn.query(`DROP TABLE IF EXISTS ${quoteIdentifier(tableId)}`);
      // Reclaimed ONLY after a confirmed drop (/code-review, 4 independent
      // finder angles): without this, `usedIdsRef` kept every redone id
      // reserved forever even once its table no longer existed, silently
      // making `e2e/intake-harness.spec.ts`'s redo test pass for the wrong
      // reason (a freshly-suffixed id never collides with anything
      // regardless of whether the drop above ever ran) instead of the
      // reason its own docstring claims (the SAME id being safely reused
      // because the old table is genuinely gone).
      usedIdsRef.current.delete(tableId);
    } catch {
      // Best-effort cleanup: a failure here leaves one abandoned table in
      // DuckDB's in-memory, session-scoped catalog — not worth blocking the
      // user's "start over" action to report, unlike every other async
      // path in this file where failure IS the primary outcome to surface.
      // The `catch` itself (previously absent) is what matters: without
      // it, `handleRedo`'s rejection propagated unhandled past the
      // `void handleRedo()` call site (/code-review, 3 independent finder
      // angles) while `finally` below made the UI look like it had
      // succeeded regardless.
    } finally {
      handleReset();
    }
  }, [state, handleReset]);

  const isEmptyPhase = state.phase === "empty";

  return (
    <div style={{ maxWidth: 720, margin: "0 auto", padding: 24, fontFamily: "sans-serif" }}>
      <h1 style={{ fontSize: 20 }}>データ取り込み</h1>
      <p style={{ color: "#6b7280", fontSize: 14 }}>
        ファイルはお使いのブラウザ内で処理されます。サーバーへ送信されません。
        URLは同じサイト内のデータのみ読み込めます。
      </p>

      {isEmptyPhase && (
        <>
          {state.note && <p role="status">{state.note}</p>}
          <DropZone disabled={false} onFileSelected={(file) => void startFile(file)} />
          <UrlPanel
            disabled={false}
            onUrlAccepted={(url) => void startUrl(url)}
            onUrlBlocked={handleUrlBlocked}
          />
        </>
      )}

      {state.phase === "blocked" && (
        <BlockedPanel
          sourceLabel={state.sourceLabel}
          reason={state.reason}
          onBack={() => handleReset()}
        />
      )}

      {state.phase === "reading" && (
        <ReadingPanel sourceLabel={state.sourceLabel} onCancel={handleCancel} />
      )}

      {state.phase === "sheet-pick" && (
        <SheetPickPanel
          sourceLabel={state.sourceLabel}
          sheets={state.sheets}
          onChoose={handleSheetChosen}
          onCancel={handleCancel}
        />
      )}

      {state.phase === "registered" && (
        <RegisteredSummary
          sourceLabel={state.sourceLabel}
          sample={state.sample}
          onConfirm={handleConfirm}
          onRedo={() => void handleRedo()}
        />
      )}

      {state.phase === "error" && (
        <ErrorPanel
          sourceLabel={state.sourceLabel}
          error={state.error}
          onRetry={() => handleReset()}
        />
      )}
    </div>
  );
}
