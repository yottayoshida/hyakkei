import type {
  DataSource,
  EgressPolicy,
  NetworkBlockedReason,
  RegisterContext,
} from "@hyakkei/core/datasource";
import type { Source } from "@hyakkei/schema";
import { useCallback, useEffect, useReducer, useRef } from "react";
import {
  DATA_SIZE_CEILING_BYTES,
  getDuckDBHandle,
  getDuckDBHandleWithLayer,
  getResolvedDataLayer,
  loadDataLayer,
  scheduleIdleWarm,
  warmDuckDB,
} from "../data-layer.js";
import { BlockedPanel } from "./BlockedPanel.js";
import { DropZone } from "./DropZone.js";
import { ErrorPanel } from "./ErrorPanel.js";
import { generateSourceId } from "./identifier.js";
import { ReadingPanel } from "./ReadingPanel.js";
import { RegisteredSummary } from "./RegisteredSummary.js";
import { SheetPickPanel } from "./SheetPickPanel.js";
import { INITIAL_STATE, intakeReducer, type IntakeError, type IntakeSample } from "./types.js";
import { UrlPanel } from "./UrlPanel.js";

// `DataSource`/`EgressPolicy`/`NetworkBlockedReason`/`RegisterContext` above
// are `import type` only (erased at compile time, no bundle-graph edge) --
// the VALUE surface (createFileSource/createUrlSource/createEgressPolicy/
// DataSourceError/quoteIdentifier/rowToPlainObject/createDuckDB) now lives
// behind `../data-layer.js`'s dynamic-import boundary (issue #54): none of
// it may appear as a static top-level import in this file again, or the
// data layer (duckdb-wasm/exceljs/iconv-lite) re-enters intake's entry
// chunk (bundle-isolation.test.ts's Stage A assertion).

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

/**
 * Not a `DataSourceError` means an unexpected internal failure, not a
 * content problem this UI can name precisely — "corrupt" is the closest
 * honest approximation among the 10 kinds, not a claim about what actually
 * happened. This also correctly covers a `loadDataLayer()` rejection
 * itself (e.g. a chunk-fetch failure): `getResolvedDataLayer()` returns
 * `undefined` in that case (its promise never resolved), so the
 * `instanceof` check below is skipped and this falls through to the same
 * generic classification — fail-closed, never a blank error.
 *
 * Synchronous by design (`getResolvedDataLayer()`, not `await
 * loadDataLayer()`): every call site below only reaches its `catch` block
 * after an earlier `await loadDataLayer()`/`getDuckDBHandle()` in the SAME
 * call chain already settled, so re-awaiting here would either resolve
 * instantly (redundant) or, on the load-failure path, retry the import a
 * second time from inside error classification itself — surprising and
 * unnecessary.
 */
function toIntakeError(err: unknown): IntakeError {
  const layer = getResolvedDataLayer();
  if (layer && err instanceof layer.datasource.DataSourceError) {
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

  // Data-layer warm hooks (issue #54): idle-time module-only prefetch so
  // the shell/drop-zone paint is never blocked on it, plus a full
  // (DuckDB-instantiating) warm the moment a drag gesture starts, since a
  // drop is imminent by the time `dragenter` fires. Both are silent,
  // best-effort — `warmDataLayerModule`/`warmDuckDB` never throw; the real
  // attempt (startFile/startUrl) retries and reports failure normally.
  useEffect(() => {
    scheduleIdleWarm();
  }, []);

  useEffect(() => {
    const handleDragEnter = () => warmDuckDB();
    // `once: true` (/simplify efficiency finding): `dragenter` rebubbles
    // from every element a drag gesture crosses, and `getDuckDBHandle()`
    // is already a singleton -- without this, one drag re-triggers this
    // listener (and allocates a fresh `.catch()` closure) repeatedly for
    // no benefit, since a second warm attempt can only replay whatever
    // the first one already resolved or permanently failed as (issue #91).
    window.addEventListener("dragenter", handleDragEnter, { once: true });
    return () => window.removeEventListener("dragenter", handleDragEnter);
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
        // Cache hit in every real call path (startFile/startUrl already
        // awaited `loadDataLayer()` before calling this function) — this
        // await resolves on the next microtask, not a second import.
        const layer = await loadDataLayer();
        if (generation !== generationRef.current) return;
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
          `SELECT * FROM ${layer.datasource.quoteIdentifier(id)} LIMIT 5`,
        );
        if (generation !== generationRef.current) return;
        const rows = result
          .toArray()
          .map((row) =>
            layer.datasource.rowToPlainObject(row as unknown as Iterable<[string, unknown]>),
          );
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
      // without ever fully buffering past the same limit. Checked against
      // the LOCAL `DATA_SIZE_CEILING_BYTES` mirror, not the real
      // `DEFAULT_MAX_BYTES` (issue #54): this gate must stay synchronous
      // and fire before paying for a data-layer fetch, not after.
      if (file.size > DATA_SIZE_CEILING_BYTES) {
        dispatch({
          type: "FAILED",
          error: {
            kind: "too-large",
            reason: undefined,
            message: `content is ${file.size} bytes, exceeding the ${DATA_SIZE_CEILING_BYTES}-byte limit`,
          },
        });
        return;
      }

      try {
        // Parallel, not sequential (issue #54): reading the file and
        // loading the data layer are independent, and a dragenter-warmed
        // load (`warmDuckDB()`) may already be in flight -- awaiting them
        // together lets both finish as fast as the slower of the two,
        // instead of paying their sum.
        const [bytes, layer, handle] = await Promise.all([
          file.arrayBuffer().then((buf) => new Uint8Array(buf)),
          loadDataLayer(),
          getDuckDBHandle(),
        ]);
        if (generation !== generationRef.current) return;
        const id = generateSourceId(file.name, usedIdsRef.current);
        const spec = buildFileSpec(id, format, file.name);
        const source = layer.datasource.createFileSource(spec, bytes);
        const { db, conn } = handle;
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
        // `UrlPanel` already awaited `loadDataLayer()` for its own
        // preflight before ever calling `onUrlAccepted` (which reaches
        // here) — this is a cache hit, not a second import.
        const { layer, handle } = await getDuckDBHandleWithLayer();
        if (generation !== generationRef.current) return;
        const spec = buildUrlSpec(id, format, url);
        const source = layer.datasource.createUrlSource(spec);
        const { db, conn } = handle;
        // The real policy (https-only/same-origin/size-capped/timeout),
        // not register-harness.html's deliberately loose test stub —
        // this is production UI, `UrlPanel`'s preflight is UX, this is
        // the actual security boundary.
        const egress = layer.datasource.createEgressPolicy({ selfOrigin: window.location.origin });
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

  // Codex R2 (fix-for-a-fix): while URL's `loadDataLayer()` preflight is
  // still pending, `IntakeApp.state.phase` is still "empty" — `submitting`
  // (Codex R1 P1/P2) only disables `UrlPanel`'s OWN input/button, not
  // `DropZone`, which stays interactive the whole time. A user can drop a
  // file (starting `startFile`'s own generation+SUBMIT) WHILE the URL
  // preflight is still in flight; if that preflight later rejects,
  // dispatching `SUBMIT`+`FAILED` unconditionally (the original R1 fix)
  // would silently clobber whatever the file attempt had already reached
  // — "reading", or even a completed "registered" — with an error screen
  // about a URL the user already abandoned. `SUBMIT` itself carries no
  // reducer-side phase guard (types.ts, it's the designed entry point for
  // a fresh attempt), so this generation check is the only thing that can
  // catch it.
  //
  // `beginUrlAttempt` lets `UrlPanel` capture ITS OWN generation the
  // moment it starts (mirroring `startFile`/`startUrl`'s `const
  // generation = ++generationRef.current`), before the async preflight —
  // relying on `IntakeApp`'s reactive `state.phase` instead would not
  // work here: `UrlPanel.handleSubmit`'s already-running call keeps
  // whatever `onLoadFailed`/`state` closure it captured when the attempt
  // STARTED, not whatever `IntakeApp` re-renders to while the preflight
  // is in flight, so a phase check evaluated inside that stale closure
  // would answer "was it empty when I started", the wrong question.
  const beginUrlAttempt = useCallback(() => ++generationRef.current, []);

  const handleUrlLoadFailed = useCallback((url: string, err: unknown, generation: number) => {
    if (generation !== generationRef.current) return;
    dispatch({ type: "SUBMIT", sourceLabel: url });
    dispatch({ type: "FAILED", error: toIntakeError(err) });
  }, []);

  const handleRedo = useCallback(async () => {
    if (state.phase !== "registered") return;
    const tableId = state.sample.table.id;
    try {
      // A cache hit — a redo is only reachable after a prior successful
      // registration, which already loaded the layer.
      const {
        layer,
        handle: { conn },
      } = await getDuckDBHandleWithLayer();
      // An abandoned registration's table is otherwise dead weight for the
      // rest of the session (M1 has no cross-session persistence to worry
      // about) — cleaning it up here is the plan's own risk-table item
      // ("eager registerで「やり直す」時の掃除漏れ").
      await conn.query(`DROP TABLE IF EXISTS ${layer.datasource.quoteIdentifier(tableId)}`);
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
            onLoadFailed={handleUrlLoadFailed}
            beginAttempt={beginUrlAttempt}
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
