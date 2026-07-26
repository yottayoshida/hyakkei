import type {
  DataSource,
  EgressPolicy,
  NetworkBlockedReason,
  RegisterContext,
} from "@hyakkei/core/datasource";
import type { Source } from "@hyakkei/schema";
import { useCallback, useEffect, useReducer, useRef, type Ref } from "react";
import {
  DATA_SIZE_CEILING_BYTES,
  DataLayerLoadError,
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

/**
 * issue #42: a legacy .xls (BIFF) file is genuinely common in this
 * project's own target data (old government-distributed spreadsheets) --
 * checked BEFORE `fileFormatFromName`'s generic `undefined` fallback so it
 * gets its own actionable copy ("re-save as .xlsx") instead of the
 * one-size-fits-all "対応していない形式です". v0.1 decision: reject with
 * specific guidance (issue #42 option ①) -- a converter/BIFF reader (②/③)
 * would add a new dependency for a format ExcelJS itself cannot read.
 */
function isLegacyXls(name: string): boolean {
  return name.toLowerCase().split(".").pop() === "xls";
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
  // Checked FIRST, before the DataSourceError check (issue #91): this is
  // the one failure mode `getResolvedDataLayer()` returning `undefined`
  // does NOT distinguish from a genuine data-layer-load failure (both fall
  // through to the same "corrupt" misattribution otherwise) -- a rejected
  // `loadDataLayer()` is the app's own code failing to load, never a
  // property of the user's file/URL.
  if (err instanceof DataLayerLoadError) {
    return { kind: "data-layer-load", reason: undefined, message: err.message };
  }
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

/**
 * `onboard` = the full-screen first-run state (App.tsx renders this alone,
 * before any source exists); `panel` = the contained "add another source"
 * affordance shown inside the workspace (App.tsx renders this over/beside
 * the existing sources). Only chrome (heading level, trust copy) differs
 * between modes -- the state machine and every child panel below are
 * identical either way (issue #11a Δ3).
 */
export type IntakeAppMode = "onboard" | "panel";

export type IntakeAppProps = {
  mode: IntakeAppMode;
  /**
   * Shell-owned (App.tsx), not this component's own ref (issue #11a,
   * mirror-review Major 3): every id this component has ever reserved must
   * outlive ITS OWN mount/unmount, since "add another source" mounts a
   * fresh `IntakeApp` per attempt while the shell's registered sources (and
   * the live DuckDB tables backing them) persist across that. Mutated
   * directly (`.add`/`.delete`) the same way the former internal ref was --
   * only its OWNERSHIP moved, not its usage.
   */
  usedIds: Set<string>;
  /**
   * Fires once, the instant a source is registered (via an effect watching
   * `state.phase === "registered"` -- issue #11a Δ6, chosen over an
   * imperative call from inside `runRegistration` specifically because an
   * effect naturally never fires if this component unmounts while still
   * "reading" (closing the "add source" panel mid-load correctly acts as a
   * cancel, with no extra guard needed). Must be referentially stable
   * (`useCallback` at the call site) -- an unstable callback would refire
   * this effect on unrelated re-renders while still in the "registered"
   * phase. The shell is responsible for deduping by `sample.table.id`
   * (`mergeWorkspaceSource`, App.tsx) as a defensive, cheap idempotency
   * guarantee against any future duplicate call -- see that function's own
   * doc for why this is NOT actually reachable via React 18 StrictMode's
   * dev double-invoke, contrary to what an earlier version of this comment
   * claimed.
   */
  onComplete: (sourceLabel: string, sample: IntakeSample) => void;
  /**
   * Attached to this component's onboard-mode heading only (/simplify
   * Altitude): the shell (App.tsx) focuses this when deleting the last
   * remaining source returns here, since this component remounts fresh in
   * that case and none of the shell's OWN refs survive it. Optional --
   * `mode: "panel"` never renders that heading, so a panel-mode caller has
   * nothing to attach it to.
   */
  onboardHeadingRef?: Ref<HTMLHeadingElement>;
};

export function IntakeApp({ mode, usedIds, onComplete, onboardHeadingRef }: IntakeAppProps) {
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
  // registration) a real table by that name might exist. Lifted to the
  // shell (`usedIds` prop) as of issue #11a -- see IntakeAppProps' doc.
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
      // `usedIds`, so a later identical source could regenerate the
      // exact same id and collide with it (`CREATE TABLE` on an
      // already-existing name), surfacing as a misleading "corrupt" error
      // for what is actually an id-reuse bug, not a content problem.
      usedIds.add(id);
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
        // issue #15/F7: burn the resolved sheet into `spec.ref` before it
        // reaches `IntakeSample` -- `source.spec` (readonly) never itself
        // carries `sheet` (chosen separately, after `inspect()`, see
        // `startFile`/`handleSheetChosen` below). `sheet !== undefined`
        // (not truthy) for the same reason `register()`'s own call above
        // uses it -- `""` is a schema-legal sheet name. A single-sheet
        // workbook still gets its sheet name burned in explicitly, not left
        // absent, so a later re-open resolves the exact same sheet rather
        // than "whichever is first" if the source file gains sheets later.
        const spec: Source =
          sheet !== undefined && source.spec.kind === "file" && source.spec.format === "xlsx"
            ? { ...source.spec, ref: { ...source.spec.ref, sheet } }
            : source.spec;
        const sample: IntakeSample = { table, rows, spec };
        dispatch({ type: "REGISTERED", sample });
      } catch (err) {
        if (generation !== generationRef.current) return;
        dispatch({ type: "FAILED", error: toIntakeError(err) });
      }
    },
    [usedIds],
  );

  const startFile = useCallback(
    async (file: File) => {
      const generation = ++generationRef.current;
      dispatch({ type: "SUBMIT", sourceLabel: file.name });

      // Checked before the generic unsupported-format fallback (issue #42):
      // a plain "対応していない形式です" would tell a .xls user only that
      // something's wrong, not what -- they genuinely do have "an Excel
      // file", just not one this app can read.
      if (isLegacyXls(file.name)) {
        dispatch({
          type: "FAILED",
          error: {
            kind: "legacy-xls",
            reason: undefined,
            message: `legacy .xls format: ${file.name}`,
          },
        });
        return;
      }

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
        const id = generateSourceId(file.name, usedIds);
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
    [runRegistration, usedIds],
  );

  const startUrl = useCallback(
    async (url: string) => {
      const generation = ++generationRef.current;
      dispatch({ type: "SUBMIT", sourceLabel: url });
      try {
        const format = urlFormatFromPath(url);
        const id = generateSourceId(url, usedIds);
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
    [runRegistration, usedIds],
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

  // issue #11a: registration success no longer waits on a "確定" click
  // (Δ2/裁定2 — the former 2-choice "確定"/"やり直す" screen looked
  // identical either way, a Hick's Law violation UX review M-2 flagged;
  // the workspace now shows the persisted preview continuously, so there
  // is nothing left to separately confirm). This effect is the ONLY
  // trigger for `onComplete` -- deliberately not an imperative call inside
  // `runRegistration`, so that closing the "add source" panel while still
  // "reading" (unmounting this component before the effect ever runs with
  // phase "registered") naturally acts as a cancel, with no extra guard
  // (issue #11a Δ6, mirror-review shape enumeration finding A1). `state`
  // itself (not `state.phase`) is the dep: the reducer returns the exact
  // same `state` reference on every guarded no-op transition, so this only
  // re-runs on a REAL transition, and never twice for the same "registered"
  // arrival -- `onComplete`'s caller still dedupes by `table.id` as a
  // defensive backstop (see that prop's own doc for why this is cheap
  // insurance, not a fix for a reachable double-fire).
  useEffect(() => {
    if (state.phase === "registered") {
      onComplete(state.sourceLabel, state.sample);
    }
  }, [state, onComplete]);

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

  const isEmptyPhase = state.phase === "empty";

  return (
    <div style={{ maxWidth: 720, margin: "0 auto", padding: 24, fontFamily: "sans-serif" }}>
      {mode === "onboard" ? (
        <>
          {/* `ref`/`tabIndex` (code review P2 #2): the shell (App.tsx) focuses
              this heading when deleting the last remaining source returns
              here -- this component remounts fresh in that case, so no ref
              the shell already holds survives to target directly; this prop
              is threaded down fresh on each such mount instead. */}
          <h1 ref={onboardHeadingRef} tabIndex={-1} style={{ fontSize: 20 }}>
            データ取り込み
          </h1>
          <p style={{ color: "#6b7280", fontSize: 14 }}>
            ファイルはお使いのブラウザ内で処理されます。サーバーへ送信されません。
            URLは同じサイト内のデータのみ読み込めます。
          </p>
        </>
      ) : (
        // panel mode: no second <h1> (a11y -- one per page, the workspace's
        // own heading already exists) and no repeated trust copy (already
        // shown once during onboarding).
        <h2 style={{ fontSize: 16 }}>データを追加</h2>
      )}

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

      {/* "registered" renders nothing of its own -- the effect above fires
          `onComplete` the instant this phase is reached, and the shell
          takes over all visible follow-up (workspace entry or panel close
          + `RegisteredSummary` reused as the persistent data card). This
          phase is transient by design. */}

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
