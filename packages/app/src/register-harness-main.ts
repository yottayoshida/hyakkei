import {
  createFileSource,
  createUrlSource,
  DataSourceError,
  rowToPlainObject,
  type EgressPolicy,
  type RegisterContext,
} from "@hyakkei/core";
import type { Source } from "@hyakkei/schema";
import { createDuckDB, type DuckDBHandle } from "./duckdb/factory.js";

let handlePromise: Promise<DuckDBHandle> | undefined;

function getHandle(): Promise<DuckDBHandle> {
  handlePromise ??= createDuckDB();
  return handlePromise;
}

/** `EgressPolicy` a `FileSource` must never call — proves FileSource's register/inspect path never touches the network (mirror-seam asymmetry check). */
const forbiddenEgress: EgressPolicy = {
  fetchBytes(): Promise<Uint8Array> {
    throw new Error("register-harness: FileSource must not call egress.fetchBytes");
  },
};

/**
 * A deliberately loose `EgressPolicy` for exercising `UrlSource`'s shared
 * register path — same-origin fetch only, no https-scheme/origin allowlist
 * enforcement. Per plan D11: the real `createEgressPolicy`'s security logic
 * already has its own 24-case Vitest suite (`egress-policy.test.ts`); this
 * harness's job is proving `UrlSource` reaches the *same* csv/parquet
 * register functions `FileSource` does (V-094), not re-verifying egress
 * security in a browser.
 */
const stubEgress: EgressPolicy = {
  async fetchBytes(url: string): Promise<Uint8Array> {
    const response = await fetch(url);
    return new Uint8Array(await response.arrayBuffer());
  },
};

function serializeError(err: unknown): {
  ok: false;
  kind?: string;
  reason?: string;
  message: string;
} {
  if (err instanceof DataSourceError) {
    return { ok: false, kind: err.kind, reason: err.reason, message: err.message };
  }
  return { ok: false, message: err instanceof Error ? err.message : String(err) };
}

const harness = {
  async registerFile(spec: Source, bytesArray: number[], sheet?: string) {
    try {
      const bytes = new Uint8Array(bytesArray);
      const { db, conn } = await getHandle();
      const ctx: RegisterContext = { registrar: { db, conn }, egress: forbiddenEgress };
      const source = createFileSource(spec as Extract<Source, { kind: "file" }>, bytes);
      const shape = await source.inspect(ctx);
      const table = await source.register(ctx, sheet ? { sheet } : undefined);
      return { ok: true, shape, table };
    } catch (err) {
      return serializeError(err);
    }
  },

  async registerUrl(spec: Source) {
    try {
      const { db, conn } = await getHandle();
      const ctx: RegisterContext = { registrar: { db, conn }, egress: stubEgress };
      const source = createUrlSource(spec as Extract<Source, { kind: "url" }>);
      const shape = await source.inspect(ctx);
      const table = await source.register(ctx);
      return { ok: true, shape, table };
    } catch (err) {
      return serializeError(err);
    }
  },

  async query(sql: string) {
    const { conn } = await getHandle();
    const result = await conn.query(sql);
    return result
      .toArray()
      .map((row) => rowToPlainObject(row as unknown as Iterable<[string, unknown]>));
  },

  /** Generates real parquet bytes via DuckDB itself (COPY TO), sidestepping the need for a committed binary fixture whose byte layout could drift from what the pinned duckdb-wasm version actually produces. */
  async makeParquetBytes(sql: string): Promise<number[]> {
    const { db, conn } = await getHandle();
    const virtualName = `__harness_gen_${Math.random().toString(36).slice(2)}.parquet`;
    await conn.query(`COPY (${sql}) TO '${virtualName}' (FORMAT PARQUET)`);
    const bytes = await db.copyFileToBuffer(virtualName);
    return Array.from(bytes);
  },
};

declare global {
  interface Window {
    __hyakkeiHarness: typeof harness;
  }
}

window.__hyakkeiHarness = harness;
