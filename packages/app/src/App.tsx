// Single-SPA editor shell (ADR-0010, issue #11a). `index.html` is now the
// product's sole entry -- the former separate intake.html/IntakeApp entry is
// embedded here directly, since DuckDB-WASM is in-memory and session-scoped
// (a page navigation would discard every registered table). Chart
// building/grid layout/guideline nudges still land in later M2 PRs
// (#11b/#11c/#12-16); this shell owns onboarding->workspace transition,
// accumulated `sources[]`, and the sample dashboard preview.
import { mount, normalizeBaked, unmount } from "@hyakkei/core/renderer";
// `import type` only (issue #54/#11a bundle isolation): a value import from
// `@hyakkei/core/datasource` would statically pull duckdb/exceljs/iconv into
// this entry chunk. Every runtime call to a column-types builder goes
// through `layer.datasource.*` (the lazy `loadDataLayer()` boundary) instead
// — see `handleOverrideChange` below.
import type { ColumnCategory } from "@hyakkei/core/datasource";
import type { BakedDashboard, BuilderState } from "@hyakkei/schema";
import { Component, useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { getDuckDBHandleWithLayer } from "./data-layer.js";
import { IntakeApp } from "./intake/IntakeApp.js";
import { QueryBuilder } from "./intake/QueryBuilder.js";
import { RegisteredSummary } from "./intake/RegisteredSummary.js";
import {
  overrideMap,
  type ColumnOverride,
  type ColumnValidationAdvisory,
  type ColumnValidationState,
  type IntakeSample,
  type PreviewRow,
  type QueryDiagnostics,
  type WorkspaceQuery,
} from "./intake/types.js";

/**
 * Last line of defense around `DashboardPreview`'s `mount()` call (issue
 * #69): `mount.ts`'s own `renderTileSafely`/`resizeAllCanvases` already
 * isolate any single chart's throw to that chart's own tile -- this
 * boundary exists for whatever's OUTSIDE that per-tile scope
 * (`normalizeBaked`/`normalizeAuthoring` on an unexpected shape,
 * `buildOptions`, `gridStyle` itself) so a genuinely unexpected error still
 * degrades to a message instead of blanking the whole app (React unmounts
 * the entire tree past an uncaught render/effect-phase error).
 *
 * Catches: synchronous throws during render and inside `useEffect`
 * callbacks (React's error-boundary contract explicitly covers effects,
 * unlike event handlers/`setTimeout`/`requestAnimationFrame`). Does NOT
 * catch: errors from event handlers, or ECharts' own internal async
 * scheduling (zrender timers/rAF) -- those run outside any React-managed
 * callback entirely, a residual risk this PR records rather than closes.
 *
 * The fallback render is deliberately static text only (no dynamic value
 * interpolation) -- this IS the "double-failure" containment plan calls
 * for: a fallback that can itself throw would need a second, nested
 * boundary to catch that, but a fallback with nothing to fail on doesn't.
 *
 * Recovery from `hasError` is a `key` prop the PARENT assigns, not a method
 * on this class (issue #11a): React remounts (and re-initializes state for)
 * any component whose `key` changes, which is the standard, zero-extra-code
 * way to make an error boundary recoverable. No dashboard-swap feature
 * exists yet in this PR's scope (#11c) to exercise this organically -- this
 * PR's job is exporting the class (so it's directly unit-testable) and
 * wiring a `key` in `App()` below, so #11c's dashboard swap "just works"
 * without touching this class again.
 */
export class DashboardErrorBoundary extends Component<
  { children: ReactNode },
  { hasError: boolean }
> {
  state = { hasError: false };

  static getDerivedStateFromError(): { hasError: boolean } {
    return { hasError: true };
  }

  componentDidCatch(error: unknown): void {
    console.error("hyakkei: dashboard preview crashed", error);
  }

  render(): ReactNode {
    if (this.state.hasError) {
      // UX review (Phase 8): errorCopy.ts's own discipline elsewhere in this
      // repo is two-layer (what happened + what to do next) -- this fallback
      // had only the first layer. A second, still-static sentence (no
      // interpolation, so the "double-failure containment" comment above
      // still holds) closes that gap without adding a new failure surface.
      return (
        <div role="alert">
          ダッシュボードを表示できませんでした。お手数ですが、ページを再読み込みしてください。
        </div>
      );
    }
    return this.props.children;
  }
}

export type DashboardPreviewProps = { dashboard: BakedDashboard };

export function DashboardPreview({ dashboard }: DashboardPreviewProps) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // The cleanup closes over the element, never re-reads the ref: React
    // detaches host refs (sets `.current` to null) during the commit
    // mutation phase BEFORE passive-effect cleanups run on unmount, so a
    // `containerRef.current` read inside the cleanup skips disposal in
    // exactly the case it exists for -- this component unmounting
    // (tab/dashboard switch in a future M2 editor). The dep-change path
    // happens to keep refs attached, which masked that gap (issue #55).
    // `mount()`'s own internal cleanup only covers *remounting the same
    // container* (a new `dashboard` prop) -- without this cleanup, every
    // unmount leaks the ECharts instance's event listeners and zrender
    // scheduling (/simplify Efficiency finding).
    const container = containerRef.current;
    if (!container) return;
    mount(container, normalizeBaked(dashboard));
    return () => unmount(container);
  }, [dashboard]);

  return <div ref={containerRef} />;
}

const SAMPLE_DASHBOARD: BakedDashboard = {
  version: 1,
  meta: {
    title: "サンプルダッシュボード",
    generatedAt: "2026-07-11T00:00:00Z",
    sourceDataAsOf: "2026-07-10",
    hyakkeiVersion: "0.1.0",
  },
  theme: {
    tokens: "@digital-go-jp/design-tokens@2.0.1",
    palette: "guidebook-blue",
    appearance: "light",
  },
  charts: [
    {
      id: "c1",
      type: "bar",
      encoding: { x: "category", y: "total" },
      options: { title: "区分別申請額" },
      rows: [
        { category: "建築", total: 120 },
        { category: "農地", total: 90 },
        { category: "その他", total: 45 },
      ],
    },
  ],
  layout: { grid: "guidebook-12col", items: [{ chart: "c1", x: 0, y: 0, w: 6, h: 6 }] },
};

/**
 * `RegisteredTable` (core) carries no display label (`{id, columns,
 * rowCount}` only, by design -- `identifier.ts`'s own doc: the sanitized
 * `id` is an internal DuckDB name, never shown on its own) -- the label the
 * user actually typed/dropped is tracked separately here, alongside the
 * sample, since `IntakeApp`'s `onComplete` callback hands both over
 * distinctly.
 *
 * `typeOverrides` (issue #11b) is kept in the exact array shape
 * `Source.typeOverrides` persists (plan: runtime/schema shape sync) so a
 * future save path (F7) can project this field verbatim, no conversion
 * layer to keep in sync separately. `validation`/`previewRows`/
 * `previewPending` are transient, session-only UI state -- never part of
 * what would be persisted, recomputed from `typeOverrides` + the live
 * table whenever needed.
 *
 * `previewPending` (QA finding, 2026-07-22, via a live DuckDB-WASM run):
 * source-scoped, not column-scoped, and deliberately spans a WIDER window
 * than any single column's own `"pending"` validation status --
 * true from the moment ANY override on this source changes, false only
 * once the resulting whole-row preview refresh actually commits (or is
 * skipped/abandoned). Exists because validation and preview resolve at
 * DIFFERENT times (`handleOverrideChange` commits the validation status
 * first, then separately awaits and commits the preview) -- without this,
 * a stale `castFailed` marker from the PRIOR override could flash back
 * with the NEW category's label for the one query round-trip between
 * those two commits, since the column's own validation status has already
 * left `"pending"` by then but its displayed `previewRows` has not yet
 * caught up.
 */
type WorkspaceSource = {
  sourceLabel: string;
  sample: IntakeSample;
  typeOverrides: ColumnOverride[];
  validation: Map<string, ColumnValidationState>;
  previewRows: PreviewRow[] | null;
  previewPending: boolean;
};

/**
 * Pure and exported so the one correctness property review couldn't verify
 * through `App()`'s rendered behavior alone -- deduping by `table.id` -- is
 * directly unit-testable without needing to reproduce a genuine duplicate
 * `onComplete` call through React (independent review, DeepWiki-verified:
 * React 18 StrictMode's dev-only effect double-invoke applies only at a
 * component's initial mount, and `IntakeApp`'s "registered" transition
 * always happens well after mount, via async file/DuckDB work -- so
 * StrictMode cannot actually double-fire THIS specific effect the way an
 * earlier version of this comment claimed). Kept as a defensive, cheap
 * idempotency guarantee regardless of how a duplicate call could arise
 * (a future `onComplete` caller bug, React internals, Fast Refresh) --
 * there is no legitimate case where the same `table.id` should ever
 * produce two workspace cards.
 */
export function mergeWorkspaceSource(
  prev: WorkspaceSource[],
  sourceLabel: string,
  sample: IntakeSample,
): WorkspaceSource[] {
  return prev.some((existing) => existing.sample.table.id === sample.table.id)
    ? prev
    : [
        ...prev,
        {
          sourceLabel,
          sample,
          typeOverrides: [],
          validation: new Map(),
          previewRows: null,
          previewPending: false,
        },
      ];
}

/**
 * column→category, replacing an existing entry for the same column
 * (last-wins, ADR-0011) rather than appending a duplicate. Exported for the
 * same reason `mergeWorkspaceSource` is (issue #11a precedent): the one
 * correctness property worth pinning directly -- a UI-driven override
 * change never accumulates duplicate entries for the same column -- isn't
 * otherwise reachable through `App()`'s rendered behavior without
 * reproducing a real `handleOverrideChange` call through React.
 */
export function upsertOverride(
  overrides: ColumnOverride[],
  column: string,
  category: ColumnCategory,
): ColumnOverride[] {
  const next = overrides.filter((entry) => entry.column !== column);
  next.push({ column, category });
  return next;
}

/** A freshly added query's starting state: no filters/groupBy/measures configured yet -- compiles to `SELECT * FROM <table>` (issue #11c). */
export function emptyBuilderState(): BuilderState {
  return { filters: [], groupBy: [], measures: [] };
}

export function App() {
  const [sources, setSources] = useState<WorkspaceSource[]>([]);
  const [panelOpen, setPanelOpen] = useState(false);
  const [announcement, setAnnouncement] = useState<string | null>(null);
  // Shell-owned (mirror-review Major 3): every id this session has ever
  // reserved must outlive each individual `IntakeApp` mount ("add source"
  // mounts a fresh instance per attempt), so it lives here, not inside
  // IntakeApp. Injected into IntakeApp as a mutable `Set` -- the same
  // `.add()`/`.delete()` mutation style the prior internal ref used, only
  // its ownership moved. `useState`'s lazy initializer, not `useRef`
  // (react-hooks/refs): the `Set` instance is only ever read for its
  // stable IDENTITY (never for a "current value" that render logic
  // branches on), but `ref.current` is disallowed during render regardless
  // -- `useState`'s returned value carries the same one-time-created,
  // referentially-stable object without that restriction.
  const [usedIds] = useState<Set<string>>(() => new Set());

  const workspaceHeadingRef = useRef<HTMLHeadingElement>(null);
  // /simplify (Altitude): a real ref, not a DOM `id` string matched across
  // files -- the previous version relied on `IntakeApp.tsx` keeping a
  // literal `id="hyakkei-onboard-heading"` attribute in sync with this
  // file's own copy of the same string, a link TypeScript cannot verify.
  // Threaded down as a prop the same way `usedIds`/`onComplete` already are.
  const onboardHeadingRef = useRef<HTMLHeadingElement>(null);
  const addSourceButtonRef = useRef<HTMLButtonElement>(null);
  const panelContainerRef = useRef<HTMLDivElement>(null);
  const prevSourcesCountRef = useRef(0);
  const wasPanelOpenRef = useRef(false);

  // Without this, dropping a file OUTSIDE the intake UI's own bounds (its
  // `onDrop` only covers its own element) falls through to the browser's
  // native default: navigating the tab to open the dropped file, which
  // tears down this entire page -- discarding every table already
  // registered into DuckDB-WASM's in-memory, session-scoped database. Lives
  // at the shell level (moved from IntakeApp, issue #11a) so it protects the
  // whole workspace, not just the onboarding/panel intake surface. A native
  // `drop` handler only suppresses the browser default if the ALSO-native
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

  // Focus management across the transitions this shell drives (UX review,
  // SheetPickPanel's own focus-on-mount precedent): onboarding's FIRST
  // successful registration moves focus to the workspace's own heading
  // (0 -> >0); a source deletion that leaves others behind returns focus to
  // "データを追加" (a decreasing, still-positive count); deleting the LAST
  // remaining source returns to onboarding, whose heading a fresh
  // `IntakeApp` mount renders -- `onboardHeadingRef` (threaded down as a
  // prop) is what makes that heading reachable even though this component
  // remounts. All three keyed off the same previous-count ref so exactly
  // one branch fires per change.
  //
  // `!panelOpen` guards the "still others left" branch (code review P2 #3):
  // without it, deleting a source card while mid-interaction with the "add
  // source" panel would yank focus away from whatever the user was doing in
  // that panel, onto a button behind it.
  useEffect(() => {
    const prev = prevSourcesCountRef.current;
    const curr = sources.length;
    if (prev === 0 && curr > 0) {
      workspaceHeadingRef.current?.focus();
    } else if (curr === 0 && prev > 0) {
      onboardHeadingRef.current?.focus();
    } else if (curr < prev && curr > 0 && !panelOpen) {
      addSourceButtonRef.current?.focus();
    }
    prevSourcesCountRef.current = curr;
  }, [sources.length, panelOpen]);

  useEffect(() => {
    if (panelOpen) {
      panelContainerRef.current?.focus();
    } else if (wasPanelOpenRef.current) {
      addSourceButtonRef.current?.focus();
    }
    wasPanelOpenRef.current = panelOpen;
  }, [panelOpen]);

  // A monotonic "which registration instance is this" tag (issue #11b,
  // Codex review R1 P1 -- ABA hazard): `identifier.ts` can reuse the exact
  // same table id after a delete + re-register of an identically-named
  // file. Without this, an in-flight validation/preview query from the
  // OLD (now-deleted) registration could resolve after the NEW
  // registration's own first override call happens to reset a shared
  // per-(tableId, column) counter back to the same value the old query
  // captured, making a stale result look "current" again. Assigning a
  // fresh, never-reused sequence number per registration and folding it
  // into every generation key below closes this regardless of what any
  // individual counter's value happens to be.
  const registrationSeqRef = useRef(0);
  const registrationSeqByTableId = useRef<Map<string, number>>(new Map());

  // The authoritative "current sources" value for `handleOverrideChange`'s
  // async continuation to read after its own `await`s (a DuckDB round-trip
  // is many renders later) without adding `sources` to that callback's
  // dependency array -- which would recreate it on every add/remove and
  // defeat `RegisteredSummary`'s memo (the same efficiency concern
  // `onDelete`/`handleSourceDelete` already resolved this way is equally
  // real here).
  //
  // Three approaches were tried and rejected before this one, each caught
  // by actual testing or review rather than assumed correct from reasoning
  // alone:
  // 1. A `setSources` "peek" (assign to an outer `let` from inside the
  //    updater, then read that variable once the call returns) -- broken
  //    by e2e: reads a stale snapshot.
  // 2. This ref, kept in sync via `useEffect` -- Codex review (R2) flagged
  //    that a passive effect is not *guaranteed* to run before an async
  //    continuation resumes.
  // 3. Mutating the ref from INSIDE a `setSources` functional updater --
  //    Codex review (R3) flagged that React does not guarantee the
  //    updater function itself runs synchronously at the call site either
  //    (only on a conditional "eager state" fast path); it can be deferred
  //    to the actual render pass, same class of problem as #2 one level
  //    down.
  //
  // `updateSources` (below) sidesteps the question entirely rather than
  // finding a 4th place to hope React runs something synchronously: it
  // computes `next` from `sourcesRef.current` (this ref is the single
  // source of truth this component maintains for itself) in a PLAIN,
  // ordinary JS statement -- no React scheduling involved at all -- then
  // passes the already-computed VALUE to `setSources` (not a function),
  // which needs no updater and has no timing ambiguity to have an opinion
  // about, only "eventually re-render with this value."
  const sourcesRef = useRef(sources);

  const updateSources = useCallback((updater: (prev: WorkspaceSource[]) => WorkspaceSource[]) => {
    const next = updater(sourcesRef.current);
    sourcesRef.current = next;
    setSources(next);
  }, []);

  const handleSourceComplete = useCallback(
    (sourceLabel: string, sample: IntakeSample) => {
      registrationSeqByTableId.current.set(sample.table.id, ++registrationSeqRef.current);
      updateSources((prev) => mergeWorkspaceSource(prev, sourceLabel, sample));
      setAnnouncement(
        `「${sourceLabel}」を${sample.table.rowCount.toLocaleString("ja-JP")}行取り込みました。`,
      );
      setPanelOpen(false);
    },
    [updateSources],
  );

  // Per-(tableId, registrationSeq, column) stale-result guard for override
  // VALIDATION queries (Codex review: rapid override switching can
  // otherwise let an earlier query's result overwrite a later one's), same
  // discipline as `IntakeApp.tsx`'s own `generationRef` -- a `Map`, not a
  // plain `{}` keyed by a data-derived string (column names may be
  // `__proto__` etc., `types.ts`'s own "never key a plain object by
  // spec.id" note applies equally to column names).
  const validationGenerationRef = useRef<Map<string, number>>(new Map());
  // Per-(tableId, registrationSeq) stale-result guard for the PREVIEW query
  // specifically (Codex review R1 P1): preview re-selects the WHOLE row
  // using every currently-active override, so its freshness cannot be
  // tracked by a single column's own generation counter -- two different
  // columns' override changes each kick off their own preview refresh, and
  // whichever one is issued LAST is not necessarily the one that resolves
  // last. A counter scoped to the source (not the column) makes "is this
  // preview result still the most recently requested one" a single,
  // unambiguous check.
  const previewGenerationRef = useRef<Map<string, number>>(new Map());

  // Sibling state to `sources[]` (issue 11c): a query references its
  // source by table id rather than nesting inside `WorkspaceSource` -- one
  // source can have several queries, and #12's chart tiles will reference a
  // query by id independently of its source. Declared here, before
  // `handleOverrideChange`, so that handler's own cross-query refresh sweep
  // (below) and `handleSourceDelete`'s orphan cleanup can both reference
  // `updateQueries`/`queryGenerationRef`/`refreshQueryPreview` directly.
  const [queries, setQueries] = useState<WorkspaceQuery[]>([]);
  const queriesRef = useRef(queries);
  const updateQueries = useCallback((updater: (prev: WorkspaceQuery[]) => WorkspaceQuery[]) => {
    const next = updater(queriesRef.current);
    queriesRef.current = next;
    setQueries(next);
  }, []);

  // Query ids are opaque (`Query.id` is `NonEmptyString`; schema's own doc:
  // "never embedded in generated or user-authored SQL text") -- a plain
  // monotonic counter is sufficient. No ABA hazard to guard against the way
  // `registrationSeqByTableId` protects a REUSED DuckDB table id: a query
  // id is minted once here and never reused after delete.
  const queryIdSeqRef = useRef(0);
  // Per-query stale-result guard for the combined preview+diagnostics
  // round-trip (same discipline as issue #11b's generation refs, collapsed
  // to one counter since a query's preview and diagnostics always resolve
  // together in a single `Promise.all`, not two separately-timed steps
  // needing independent freshness tracking the way validation/preview did).
  const queryGenerationRef = useRef<Map<string, number>>(new Map());

  // Shared by both trigger paths a query's preview/diagnostics can refresh
  // from (issue 11c): the user editing the query itself
  // (`handleQueryBuilderChange`), and a type-override changing on the
  // query's OWN source elsewhere (`handleOverrideChange`'s sweep below) --
  // the latter previously left an existing query's preview silently stale
  // (still showing the PRIOR override's cast result) until the user
  // happened to touch that query again, missing the plan's own success
  // metric ("category<->operator不整合をruntimeで検出し警告、silent failゼロ")
  // for the "editing this session" scope (live PoC, 2026-07-22, confirmed
  // via `register-harness.html`-style dry run: a stale `sum` measure kept
  // showing its pre-override numeric result even after the referenced
  // column was overridden away from `number`).
  const refreshQueryPreview = useCallback(
    async (queryId: string) => {
      const generation = (queryGenerationRef.current.get(queryId) ?? 0) + 1;
      queryGenerationRef.current.set(queryId, generation);
      const isCurrent = () => queryGenerationRef.current.get(queryId) === generation;

      updateQueries((prev) =>
        prev.map((q) => (q.id === queryId ? { ...q, previewPending: true } : q)),
      );

      // Read via the refs (same reasoning as `handleOverrideChange`'s own
      // `sourcesRef` use): both are kept synchronously current by their
      // respective `update*` functions, unconditionally reflecting the
      // pending-state commit above by the time this line runs. `builderState`
      // is read off this SAME lookup (/simplify Simplification finding,
      // issue 11c), not passed as a separate parameter -- every caller
      // already commits the exact builderState it wants resolved to
      // `queriesRef.current` immediately before calling this function, so a
      // second parameter would be a second source of truth for the same
      // value, not a genuinely independent input.
      const query = queriesRef.current.find((q) => q.id === queryId);
      if (!query) return;
      const { builderState } = query;
      const source = sourcesRef.current.find((s) => s.sample.table.id === query.sourceTableId);
      if (!source) return;

      try {
        const { layer, handle } = await getDuckDBHandleWithLayer();
        if (!isCurrent()) return;

        const columnMeta = source.sample.table.columns;
        const overridesMap = overrideMap(source.typeOverrides);
        // The self-contained, LIMIT-free form -- mirrors what a persisted
        // `Query.sql` would hold for this exact `builderState` (Codex review
        // R1 P0). `previewSql` reuses this string directly (`+ LIMIT`)
        // rather than a second `buildQueryPreviewSql` call (/simplify
        // Efficiency finding, issue 11c: that call re-runs the SAME
        // resolver walk over `builderState`/`columnMeta` a second time to
        // produce byte-identical SQL up to the LIMIT clause).
        const sql = layer.datasource.buildQuerySql(
          query.sourceTableId,
          builderState,
          columnMeta,
          overridesMap,
        );
        const previewSql = `${sql} LIMIT 50`;
        const diagnosticsSql = layer.datasource.buildQueryDiagnosticsSql(
          query.sourceTableId,
          builderState,
          columnMeta,
          overridesMap,
        );
        const [previewResult, diagnosticsResult] = await Promise.all([
          handle.conn.query(previewSql),
          handle.conn.query(diagnosticsSql),
        ]);
        if (!isCurrent()) return;

        // `rowToPlainObject`, not direct property access (issue #11b's own
        // `__proto__` lesson): a groupBy/measure column can legally be
        // named `__proto__`, and this row's keys are REAL column/alias
        // names, unlike the diagnostics row below (whose keys are always
        // synthetically prefixed/suffixed, so can never collide with the
        // bare literal `"__proto__"`).
        const previewRows = previewResult
          .toArray()
          .map((row) =>
            layer.datasource.rowToPlainObject(row as unknown as Iterable<[string, unknown]>),
          );
        // Read from the Arrow result's OWN schema (Codex review R1 P2), not
        // derived from `previewRows[0]`'s keys -- a real Arrow result
        // carries field names even with zero rows, so a grouped/filtered
        // query that legitimately matches nothing still reports its own
        // group-by/measure-alias output columns, not the source table's.
        const previewColumns = previewResult.schema.fields.map((field) => field.name);

        // Direct property access (same established pattern as
        // `handleOverrideChange`'s `validationRow?.uncastable_count`) --
        // safe here specifically because every key is synthetically
        // prefixed/suffixed (`filter_<i>_value_invalid`,
        // `<column>_excluded_count`), so it can never equal the bare
        // literal `"__proto__"` even if `measure.column` itself is that.
        const diagnosticsRow = diagnosticsResult.toArray()[0];
        const totalCount = Number(diagnosticsRow?.total_count ?? 0);
        const matchedCount = Number(diagnosticsRow?.matched_count ?? 0);
        const invalidFilterIndices = builderState.filters
          .map((_, i) => i)
          .filter((i) => diagnosticsRow?.[`filter_${i}_value_invalid`] === true);
        // A `Map`, not a column-name-keyed plain object (Codex review R1
        // P1): `measureExcludedCounts[measure.column] = n` would silently
        // no-op for a column literally named `__proto__` instead of storing
        // its count, the same prototype-accessor pitfall this codebase's
        // `rowToPlainObject` already exists to avoid on the read side.
        const measureExcludedCounts = new Map<string, number>();
        for (const measure of builderState.measures) {
          const key = `${measure.column}_excluded_count`;
          const value = diagnosticsRow?.[key];
          if (value !== undefined) measureExcludedCounts.set(measure.column, Number(value));
        }
        const diagnostics: QueryDiagnostics = {
          totalCount,
          matchedCount,
          invalidFilterIndices,
          measureExcludedCounts,
        };

        updateQueries((prev) =>
          prev.map((q) =>
            q.id === queryId
              ? { ...q, sql, previewRows, previewColumns, diagnostics, previewPending: false }
              : q,
          ),
        );
      } catch (error) {
        // `operatorSqlFor`/`aggregateFnFor`'s defensive throws (same class
        // as `castTargetFor`'s -- an out-of-union value never reachable
        // through this component's own `<select>`s) must not be folded
        // into the same "just clear pending" outcome a routine DuckDB-side
        // failure produces.
        if (error instanceof RangeError) throw error;
        // Clears the STALE result rather than leaving it displayed (QA
        // Phase 8 finding): this previously only cleared `previewPending`,
        // so a query that threw (e.g. the BOOLEAN/NULL-as-"text" filter bug
        // this same Phase found and fixed, or any other unexpected DuckDB
        // error) kept showing its LAST SUCCESSFUL result -- indistinguishable
        // from "the filter/aggregate genuinely produced this," directly
        // contradicting this PR's own "silent fail = zero" success metric.
        if (isCurrent()) {
          updateQueries((prev) =>
            prev.map((q) =>
              q.id === queryId
                ? {
                    ...q,
                    previewRows: null,
                    previewColumns: [],
                    diagnostics: null,
                    previewPending: false,
                  }
                : q,
            ),
          );
        }
      }
    },
    [updateQueries],
  );

  const handleOverrideChange = useCallback(
    async (tableId: string, column: string, category: ColumnCategory) => {
      const seq = registrationSeqByTableId.current.get(tableId);
      // A literal space safely separates the 3 parts of this key even
      // though `column` is unrestricted data (may itself contain spaces):
      // `tableId` is always `Source.id` (schema's `SqlIdentifier`, no space
      // is a valid character in that pattern) and `seq` is always a plain
      // integer, so the first two spaces are unambiguous boundaries.
      const key = `${tableId} ${seq} ${column}`;
      const previewKey = `${tableId} ${seq}`;
      const generation = (validationGenerationRef.current.get(key) ?? 0) + 1;
      validationGenerationRef.current.set(key, generation);
      const previewGeneration = (previewGenerationRef.current.get(previewKey) ?? 0) + 1;
      previewGenerationRef.current.set(previewKey, previewGeneration);

      updateSources((prev) =>
        prev.map((source) => {
          if (source.sample.table.id !== tableId) return source;
          const nextValidation = new Map(source.validation);
          nextValidation.set(column, { status: "pending" });
          return {
            ...source,
            typeOverrides: upsertOverride(source.typeOverrides, column, category),
            validation: nextValidation,
            previewPending: true,
          };
        }),
      );

      // Re-resolve every EXISTING query on this source against the new
      // override (issue 11c, live PoC finding, 2026-07-22): without this, a
      // query's preview/diagnostics kept showing the PRIOR override's cast
      // result until the user happened to touch that query's own controls
      // again -- a category<->operator mismatch (e.g. a `sum` measure whose
      // column was just overridden away from `number`) went undetected
      // rather than warned, missing this PR's own success metric. Each
      // query's OWN `builderState` is passed unchanged -- `refreshQueryPreview`
      // reads the fresh override via `sourcesRef` itself, and the resolver
      // (`query-sql.ts`) already silently excludes a measure/filter that no
      // longer fits its column's category (same rule a dangling column
      // reference gets), so no separate `builderState` sanitization step is
      // needed here.
      for (const query of queriesRef.current) {
        if (query.sourceTableId === tableId) void refreshQueryPreview(query.id);
      }

      const isCurrent = () => validationGenerationRef.current.get(key) === generation;
      const isPreviewCurrent = () =>
        previewGenerationRef.current.get(previewKey) === previewGeneration;

      // Validation and preview are two INDEPENDENT failure domains
      // (/code-review Phase 6-C: CONFIRMED by 3 independent finder angles).
      // A single try/catch here previously let a preview-refresh-only
      // failure silently overwrite a validation outcome the user had
      // already seen -- e.g. a correct "1件変換不可" warning, computed and
      // committed successfully, replaced by a blanket "failed" purely
      // because the SEPARATE preview re-query afterward happened to throw.
      // Each domain now runs its own try/catch and commits its own outcome.
      let layer: Awaited<ReturnType<typeof getDuckDBHandleWithLayer>>["layer"];
      let handle: Awaited<ReturnType<typeof getDuckDBHandleWithLayer>>["handle"];
      try {
        ({ layer, handle } = await getDuckDBHandleWithLayer());
        if (!isCurrent()) return;

        // The 3rd diagnostic query is category-specific (a "number" override
        // risks DOUBLE precision loss, a "date" override risks discarding a
        // UTC offset -- /code-review Angle D, confirmed) and simply `null`
        // for "text", where neither risk applies. `Promise.all` resolves a
        // plain (non-promise) array element immediately, so this stays one
        // round-trip regardless of category.
        const advisoryQuery =
          category === "number"
            ? handle.conn.query(layer.datasource.buildNumberPrecisionCheckSql(tableId, column))
            : category === "date"
              ? handle.conn.query(layer.datasource.buildDateOffsetCheckSql(tableId, column))
              : null;
        const [validationResult, sampleResult, advisoryResult] = await Promise.all([
          handle.conn.query(layer.datasource.buildCastValidationSql(tableId, column, category)),
          handle.conn.query(layer.datasource.buildCastSampleSql(tableId, column, category, 5)),
          advisoryQuery,
        ]);
        if (!isCurrent()) return;

        const validationRow = validationResult.toArray()[0];
        const nonNullCount = Number(validationRow?.non_null_count ?? 0);
        const uncastableCount = Number(validationRow?.uncastable_count ?? 0);
        const samples = sampleResult.toArray().map((row) => ({
          original: String(row.original ?? ""),
          parsed: row.parsed === null ? null : String(row.parsed),
        }));

        let advisory: ColumnValidationAdvisory | undefined;
        if (category === "number" && advisoryResult) {
          const count = Number(advisoryResult.toArray()[0]?.precision_lossy_count ?? 0);
          if (count > 0) advisory = { kind: "precision-loss", count };
        } else if (category === "date" && advisoryResult) {
          const count = Number(advisoryResult.toArray()[0]?.offset_discarded_count ?? 0);
          if (count > 0) advisory = { kind: "date-offset-discarded", count };
        }

        updateSources((prev) =>
          prev.map((source) => {
            if (source.sample.table.id !== tableId) return source;
            const nextValidation = new Map(source.validation);
            nextValidation.set(
              column,
              uncastableCount > 0
                ? { status: "warning", nonNullCount, uncastableCount, samples, advisory }
                : { status: "valid", samples, advisory },
            );
            return { ...source, validation: nextValidation };
          }),
        );
      } catch (error) {
        // `castTargetFor`'s defensive throw (an out-of-union category --
        // never reachable through this component's own <select>, only via a
        // future dashboard.json-driven override or a corrupted `as` cast) is
        // an invariant violation, not a routine per-user-data cast failure
        // (/code-review Altitude finding, confirmed) -- folding it into the
        // same "failed" UI state a user's own messy data produces would
        // mask a real programmer bug as an ordinary data-quality warning.
        if (error instanceof RangeError) throw error;
        if (!isCurrent()) return;
        // DuckDB-side failure (SEC-8): classify as a per-column state, not a
        // raw exception -- e.g. an override on an "other"-category column
        // (list/struct/binary) hand-edited into a shared dashboard.json.
        updateSources((prev) =>
          prev.map((source) => {
            if (source.sample.table.id !== tableId) return source;
            const nextValidation = new Map(source.validation);
            nextValidation.set(column, { status: "failed" });
            // No preview attempt follows (see below) -- clear the flag here
            // so it doesn't stay stuck suppressing markers indefinitely.
            return { ...source, validation: nextValidation, previewPending: false };
          }),
        );
        // Validation itself failed -- the preview re-cast below would fail
        // for the identical reason, so don't attempt it.
        return;
      }

      // Refresh the preview using ALL currently-active overrides for this
      // source (not just the one that just changed), so a second override
      // on the same card doesn't clobber the first's cast. Gated on
      // `isPreviewCurrent()` (source-scoped), not `isCurrent()`
      // (column-scoped): a DIFFERENT column's override changing after
      // this preview was requested, but before it resolves, must still
      // be able to supersede it.
      //
      // Read via `sourcesRef` (see its own comment above: kept in sync
      // synchronously by `updateSources`, unconditionally reflecting the
      // pending-state `updateSources` call above by the time this line
      // runs), not the `sources` variable this closure captured at
      // creation time -- `sources` here would still be the value from
      // whenever this specific `handleOverrideChange` call started.
      //
      // Its own try/catch, independent of validation's above: a failure
      // here must never overwrite the validation status just committed
      // (/code-review, confirmed conflation bug) -- on failure this
      // silently leaves the previous previewRows in place, the same
      // "abandon, don't corrupt" discipline `handleSourceDelete`'s own
      // best-effort DROP TABLE already uses.
      try {
        if (!isPreviewCurrent()) return;
        const source = sourcesRef.current.find((s) => s.sample.table.id === tableId);
        if (!source) return;
        const overridesMap = overrideMap(source.typeOverrides);
        const columnNames = source.sample.table.columns.map((c) => c.name);
        const { sql, rawAliasFor } = layer.datasource.buildTypedPreviewSql(
          tableId,
          columnNames,
          overridesMap,
          5,
        );
        const previewResult = await handle.conn.query(sql);
        if (!isPreviewCurrent()) return;
        const previewRows: PreviewRow[] = previewResult.toArray().map((row) => {
          const plain = layer.datasource.rowToPlainObject(
            row as unknown as Iterable<[string, unknown]>,
          );
          const castFailed = new Set<string>();
          // `Object.fromEntries`, not bracket assignment onto a plain `{}`
          // (code review, Phase 6-B: found by an independent finder angle
          // during this same review, CONFIRMED via repro): a column
          // literally named `__proto__` is exactly the case
          // `rowToPlainObject` (register-path.ts) exists to make safe on
          // the READ side (`plain` above already reads it correctly) --
          // but `values[name] = plain[name]` on the WRITE side goes
          // through the inherited `Object.prototype.__proto__` accessor
          // setter instead of creating a real own property: a non-object
          // value silently no-ops (the cell then renders
          // `String(Object.prototype)` = "[object Object]"), and a `null`
          // value actually reassigns this row object's own prototype.
          // `Object.fromEntries` uses `CreateDataPropertyOrThrow`
          // internally (the same mechanism `rowToPlainObject` itself
          // relies on), which never triggers that setter.
          const values = Object.fromEntries(
            columnNames.map((name) => {
              const rawAlias = rawAliasFor.get(name);
              if (!rawAlias) return [name, plain[name]];
              if (plain[name] === null && plain[rawAlias] !== null) {
                castFailed.add(name);
                return [name, plain[rawAlias]];
              }
              return [name, plain[name]];
            }),
          );
          return { values, castFailed };
        });
        updateSources((current) =>
          current.map((s) =>
            s.sample.table.id === tableId ? { ...s, previewRows, previewPending: false } : s,
          ),
        );
      } catch (error) {
        if (error instanceof RangeError) throw error;
        // best-effort -- see the comment above this try block. Only clears
        // the flag if THIS attempt is still the current one: a newer
        // override (which already reset `previewPending: true` for its own
        // attempt) must not have its own in-flight suppression cut short by
        // an older, now-stale attempt's failure.
        if (isPreviewCurrent()) {
          updateSources((current) =>
            current.map((s) =>
              s.sample.table.id === tableId ? { ...s, previewPending: false } : s,
            ),
          );
        }
      }
    },
    [updateSources, refreshQueryPreview],
  );

  const handleSourceDelete = useCallback(
    async (tableId: string, sourceLabel: string) => {
      try {
        const {
          layer,
          handle: { conn },
        } = await getDuckDBHandleWithLayer();
        // Best-effort, same discipline as the former IntakeApp `handleRedo`
        // (/code-review precedent): a failure here leaves one abandoned table
        // in DuckDB's in-memory catalog, not worth blocking the user's delete
        // action to report.
        await conn.query(`DROP TABLE IF EXISTS ${layer.datasource.quoteIdentifier(tableId)}`);
        usedIds.delete(tableId);
      } catch {
        // best-effort cleanup
      } finally {
        updateSources((prev) => prev.filter((s) => s.sample.table.id !== tableId));
        setAnnouncement(`「${sourceLabel}」を削除しました。`);
        // 4th point (issue #11b, V-004): generation-tracking entries for
        // this table live outside `sources[]` (refs, not state). This sweep
        // IS load-bearing for correctness, not just hygiene (/code-review,
        // confirmed -- a prior version of this comment claimed otherwise):
        // `registrationSeq` namespacing keeps two DIFFERENT registrations'
        // generation KEYS from colliding, but the state-commit callbacks in
        // `handleOverrideChange` still match `updateSources`'s target
        // source by `tableId` ALONE. If this table id is later reused (a
        // same-named file re-registered after this delete), an old,
        // never-superseded generation entry for THIS deleted registration
        // would still read back as "current" (nothing incremented that
        // specific stale key) -- and its late-resolving query would then
        // patch its stale result onto the NEW registration's state, purely
        // because they share the same table id. Deleting every entry whose
        // key starts with this table id closes that window: a stale key can
        // never be found "current" again once it no longer exists at all.
        const prefix = `${tableId} `;
        for (const key of validationGenerationRef.current.keys()) {
          if (key.startsWith(prefix)) validationGenerationRef.current.delete(key);
        }
        for (const key of previewGenerationRef.current.keys()) {
          if (key.startsWith(prefix)) previewGenerationRef.current.delete(key);
        }
        // Not load-bearing for correctness the way the two sweeps above are
        // (a fresh registration overwrites this map's entry for the same
        // table id unconditionally, via `handleSourceComplete`, before
        // anything could read a stale value) -- pruned anyway purely so this
        // map doesn't grow by one entry per distinct table id ever used in
        // a long session (/code-review Efficiency/Simplification, confirmed).
        registrationSeqByTableId.current.delete(tableId);
        // Deleting a source orphans any query that references it (issue
        // #11c): `Query.source` would become a dangling FK exactly like
        // `validateDashboardReferences` already flags for a hand-edited
        // dashboard.json, so this source's own queries are removed too
        // rather than left showing a table that no longer exists.
        const orphanedQueryIds = queriesRef.current
          .filter((q) => q.sourceTableId === tableId)
          .map((q) => q.id);
        if (orphanedQueryIds.length > 0) {
          updateQueries((prev) => prev.filter((q) => q.sourceTableId !== tableId));
          for (const queryId of orphanedQueryIds) queryGenerationRef.current.delete(queryId);
        }
      }
    },
    [usedIds, updateSources, updateQueries],
  );

  const handleAddQuery = useCallback(
    (sourceTableId: string) => {
      const id = `query_${++queryIdSeqRef.current}`;
      const builderState = emptyBuilderState();
      updateQueries((prev) => [
        ...prev,
        {
          id,
          sourceTableId,
          builderState,
          sql: "",
          previewRows: null,
          previewColumns: [],
          diagnostics: null,
          previewPending: false,
        },
      ]);
      // A fresh query's "all empty" builderState still resolves to a real
      // query (`SELECT * FROM <table>`, shape enumeration R1/G1) -- without
      // this, a newly added card showed no preview at all until the user
      // touched some control (Codex review R1 P2), even though the shape
      // document's own claim is that this state compiles to something
      // immediately.
      void refreshQueryPreview(id);
    },
    [updateQueries, refreshQueryPreview],
  );

  const handleQueryDelete = useCallback(
    (queryId: string) => {
      updateQueries((prev) => prev.filter((q) => q.id !== queryId));
      queryGenerationRef.current.delete(queryId);
    },
    [updateQueries],
  );

  const handleQueryBuilderChange = useCallback(
    (queryId: string, builderState: BuilderState) => {
      updateQueries((prev) => prev.map((q) => (q.id === queryId ? { ...q, builderState } : q)));
      void refreshQueryPreview(queryId);
    },
    [updateQueries, refreshQueryPreview],
  );

  const hasSources = sources.length > 0;

  // Rendered OUTSIDE either branch below (code review finding): deleting
  // the last remaining source flips `hasSources` back to `false` in the
  // SAME commit `setAnnouncement` fires in -- an announcement rendered only
  // inside the workspace branch would vanish the instant it would otherwise
  // appear, since that branch is exactly what stops existing at that
  // moment.
  const announcementRegion = announcement ? <p role="status">{announcement}</p> : null;

  if (!hasSources) {
    return (
      <>
        {announcementRegion}
        <IntakeApp
          mode="onboard"
          usedIds={usedIds}
          onComplete={handleSourceComplete}
          onboardHeadingRef={onboardHeadingRef}
        />
      </>
    );
  }

  return (
    <div style={{ maxWidth: 960, margin: "0 auto", padding: 24, fontFamily: "sans-serif" }}>
      <h1 ref={workspaceHeadingRef} tabIndex={-1} style={{ fontSize: 20 }}>
        データワークスペース
      </h1>
      {announcementRegion}

      {/* UX review (post-implementation, H-1): before #11a, index.html
          showed ONLY this sample -- no real user data ever shared the page
          with it, so there was nothing to mistake it FOR. #11a's own
          integration creates the confusing juxtaposition (a first-time,
          non-technical user's real data card sitting right next to a
          chart that looks equally authoritative but has nothing to do
          with it) -- a new risk this PR introduces, not one it merely
          inherits. The label goes ABOVE the chart (not a de-emphasized
          note below it, the prior placement) so it's read before the
          chart itself, and states plainly that this is not the user's
          own data -- directly protects the #16 five-minute-test's
          success criterion. */}
      <p style={{ color: "#6b7280", fontSize: 14, marginBottom: 4 }}>
        サンプル表示です。取り込んだデータではありません。グラフ作成機能は今後の更新で追加されます。
      </p>
      <div style={{ border: "1px dashed #d1d5db", borderRadius: 8, padding: 8 }}>
        <DashboardErrorBoundary key={SAMPLE_DASHBOARD.meta.title}>
          <DashboardPreview dashboard={SAMPLE_DASHBOARD} />
        </DashboardErrorBoundary>
      </div>

      {sources.map(
        ({ sourceLabel, sample, typeOverrides, validation, previewRows, previewPending }) => (
          <div key={sample.table.id}>
            <RegisteredSummary
              sourceLabel={sourceLabel}
              sample={sample}
              typeOverrides={typeOverrides}
              validation={validation}
              previewRows={previewRows}
              previewPending={previewPending}
              // The SAME stable callback reference passed to every card,
              // unchanged across renders (/simplify Efficiency finding --
              // `sources.map(...)` previously allocated a fresh closure per
              // card on every render, defeating memoization entirely).
              // `RegisteredSummary` is `memo`-wrapped, so a card whose own
              // props haven't changed now skips re-rendering when some OTHER
              // source is added/removed or `announcement` updates.
              onDelete={handleSourceDelete}
              onOverrideChange={handleOverrideChange}
              onAddQuery={handleAddQuery}
            />
            {/* Sibling to the source card, not nested inside it (issue 11c
                UX design: a query is a first-class entity #12's chart tiles
                reference by id, not a sub-feature of its source card). */}
            {queries
              .filter((q) => q.sourceTableId === sample.table.id)
              .map((query) => (
                <QueryBuilder
                  key={query.id}
                  query={query}
                  sourceLabel={sourceLabel}
                  columnMeta={sample.table.columns}
                  typeOverrides={typeOverrides}
                  onChange={handleQueryBuilderChange}
                  onDelete={handleQueryDelete}
                />
              ))}
          </div>
        ),
      )}

      <div style={{ marginTop: 16 }}>
        <button
          ref={addSourceButtonRef}
          type="button"
          onClick={() => setPanelOpen(true)}
          style={{
            minHeight: 44,
            padding: "0 16px",
            background: "#1a56db",
            color: "#fff",
            border: "none",
            borderRadius: 4,
          }}
        >
          データを追加
        </button>
      </div>

      {panelOpen && (
        <div ref={panelContainerRef} tabIndex={-1}>
          {/* code review P1 #1: without this, opening this panel was a
              dead end -- the only ways out were registering SOME source
              (even an unwanted one) or reloading (which, since DuckDB-WASM
              is in-memory, discards every already-registered source).
              Closing here is a plain `setPanelOpen(false)`, not routed
              through IntakeApp at all: an in-flight registration abandoned
              this way unmounts IntakeApp before its `onComplete` effect can
              ever see `phase === "registered"`, the same "closing mid-load
              acts as cancel" guarantee Δ6 already established. */}
          <div style={{ display: "flex", justifyContent: "flex-end" }}>
            <button
              type="button"
              onClick={() => setPanelOpen(false)}
              style={{ minHeight: 44, padding: "0 12px", background: "transparent" }}
            >
              閉じる
            </button>
          </div>
          <IntakeApp mode="panel" usedIds={usedIds} onComplete={handleSourceComplete} />
        </div>
      )}
    </div>
  );
}
