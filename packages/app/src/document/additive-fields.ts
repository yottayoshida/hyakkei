import { Dashboard, Query } from "@hyakkei/schema";

export type AdditiveObjectFields = Record<string, unknown>;
export type QueryAdditiveFields = ReadonlyMap<string, AdditiveObjectFields>;

const DASHBOARD_KEYS = new Set(Object.keys(Dashboard.properties));
const QUERY_KEYS = new Set(Object.keys(Query.properties));

function isPlainSerializable(value: unknown): boolean {
  if (value === null) return true;
  const type = typeof value;
  if (type === "string" || type === "boolean") return true;
  if (type === "number") return Number.isFinite(value);
  if (type !== "object") return false;
  if (Array.isArray(value)) return value.every(isPlainSerializable);
  const prototype = Object.getPrototypeOf(value);
  return (
    (prototype === Object.prototype || prototype === null) &&
    Object.values(value ?? {}).every(isPlainSerializable)
  );
}

function copyUnknownFields(value: Record<string, unknown>, knownKeys: ReadonlySet<string>) {
  const extras: AdditiveObjectFields = Object.create(null) as AdditiveObjectFields;
  for (const [key, fieldValue] of Object.entries(value)) {
    if (!knownKeys.has(key)) extras[key] = fieldValue;
  }
  return extras;
}

export function extractDashboardAdditiveFields(dashboard: Record<string, unknown>): {
  documentExtras: AdditiveObjectFields;
  queryExtras: Map<string, AdditiveObjectFields>;
} {
  const queryExtras = new Map<string, AdditiveObjectFields>();
  const queries = Array.isArray(dashboard.queries) ? dashboard.queries : [];
  for (const query of queries) {
    if (!query || typeof query !== "object") continue;
    const queryRecord = query as Record<string, unknown>;
    if (typeof queryRecord.id !== "string") continue;
    queryExtras.set(queryRecord.id, copyUnknownFields(queryRecord, QUERY_KEYS));
  }
  return {
    documentExtras: copyUnknownFields(dashboard, DASHBOARD_KEYS),
    queryExtras,
  };
}

export function assertSerializableAdditiveFields(value: unknown, path = "$"): void {
  if (!isPlainSerializable(value)) {
    throw new TypeError(`additive field at ${path} is not JSON-serializable`);
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertSerializableAdditiveFields(item, `${path}[${index}]`));
    return;
  }
  if (value !== null && typeof value === "object") {
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      assertSerializableAdditiveFields(child, `${path}.${key}`);
    }
  }
}

export function assertSerializableQueryAdditiveFields(
  queryExtras: QueryAdditiveFields | undefined,
): void {
  if (!queryExtras) return;
  for (const [queryId, extras] of queryExtras) {
    assertSerializableAdditiveFields(extras, `$.queries[${queryId}]`);
  }
}
