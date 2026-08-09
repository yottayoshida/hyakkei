import { Dashboard, Query } from "@hyakkei/schema";

export type AdditiveObjectFields = Record<string, unknown>;
export type QueryAdditiveFields = ReadonlyMap<string, AdditiveObjectFields>;

const DASHBOARD_KEYS = new Set(Object.keys(Dashboard.properties));
const QUERY_KEYS = new Set(Object.keys(Query.properties));

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
  assertSerializable(value, path, new WeakSet<object>());
}

function assertSerializable(value: unknown, path: string, ancestors: WeakSet<object>): void {
  if (value === null) return;
  const type = typeof value;
  if (type === "string" || type === "boolean") return;
  if (type === "number" && Number.isFinite(value)) return;
  if (type !== "object") {
    throw new TypeError(`additive field at ${path} is not JSON-serializable`);
  }

  const objectValue = value as object;
  if (ancestors.has(objectValue)) {
    throw new TypeError(`additive field at ${path} contains a cycle`);
  }
  ancestors.add(objectValue);
  try {
    const ownNames = Object.getOwnPropertyNames(objectValue);
    if (Object.getOwnPropertySymbols(objectValue).length > 0) {
      throw new TypeError(`additive field at ${path} has symbol keys`);
    }
    if (Array.isArray(value)) {
      for (let index = 0; index < value.length; index++) {
        if (!Object.prototype.hasOwnProperty.call(value, index)) {
          throw new TypeError(`additive field at ${path}[${index}] is a sparse array hole`);
        }
        assertSerializable(value[index], `${path}[${index}]`, ancestors);
      }
      const unexpectedArrayKeys = ownNames.filter((key) => key !== "length" && !/^\d+$/.test(key));
      if (unexpectedArrayKeys.length > 0) {
        throw new TypeError(`additive field at ${path} has non-index array keys`);
      }
      return;
    }

    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      throw new TypeError(`additive field at ${path} is not a plain object`);
    }
    for (const key of ownNames) {
      if (!Object.prototype.propertyIsEnumerable.call(value, key)) {
        throw new TypeError(`additive field at ${path}.${key} is not enumerable`);
      }
      assertSerializable((value as Record<string, unknown>)[key], `${path}.${key}`, ancestors);
    }
  } finally {
    ancestors.delete(objectValue);
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
