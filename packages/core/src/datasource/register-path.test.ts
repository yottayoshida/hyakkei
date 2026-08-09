import { describe, expect, it } from "vitest";
import {
  classifyRegisterFailure,
  rowToPlainObject,
  throwClassifiedFailure,
} from "./register-path.js";
import { DataSourceError } from "./types.js";

// The exact, verified real DuckDB-WASM error text (docs/spikes/m0-duckdb.md
// "OOM behavior: PASS" — `PRAGMA memory_limit='50MB'` against a 100MB CSV,
// all 3 engines) — grounding this test in the real message M0 empirically
// captured, not an invented string, per this project's "no guessing"
// discipline. QA Phase 8 finding (Major): `classifyRegisterFailure`'s
// "oom" branch had zero test coverage anywhere before this.
const REAL_DUCKDB_OOM_MESSAGE =
  "Out of Memory Error: could not allocate block of size 256.0 KiB (47.6 MiB/47.6 MiB used)\n" +
  "Database is launched in in-memory mode and no temporary directory is specified.\n" +
  "Possible solutions:\n" +
  "* Reducing the number of threads (SET threads=X)\n" +
  "* Disabling insertion-order preservation (SET preserve_insertion_order=false)\n" +
  "* Increasing the memory limit (SET memory_limit='...GB')";

describe("classifyRegisterFailure", () => {
  it("classifies the real, verified DuckDB-WASM OOM message as 'oom'", () => {
    expect(classifyRegisterFailure(new Error(REAL_DUCKDB_OOM_MESSAGE))).toBe("oom");
  });

  it("classifies an unrelated error as 'corrupt'", () => {
    expect(classifyRegisterFailure(new Error("Binder Error: column not found"))).toBe("corrupt");
  });

  it("classifies a non-Error cause as 'corrupt'", () => {
    expect(classifyRegisterFailure("some string thrown")).toBe("corrupt");
    expect(classifyRegisterFailure(undefined)).toBe("corrupt");
  });
});

describe("throwClassifiedFailure", () => {
  it("throws a DataSourceError with kind 'oom' and the oom message for a real OOM cause", () => {
    try {
      throwClassifiedFailure(
        new Error(REAL_DUCKDB_OOM_MESSAGE),
        "ran out of memory",
        "content broken",
      );
      expect.fail("expected a throw");
    } catch (err) {
      expect(err).toBeInstanceOf(DataSourceError);
      expect((err as DataSourceError).kind).toBe("oom");
      expect((err as DataSourceError).message).toBe("ran out of memory");
      expect((err as DataSourceError).cause).toBeInstanceOf(Error);
    }
  });

  it("throws a DataSourceError with kind 'corrupt' and the corrupt message otherwise", () => {
    try {
      throwClassifiedFailure(new Error("Binder Error"), "ran out of memory", "content broken");
      expect.fail("expected a throw");
    } catch (err) {
      expect(err).toBeInstanceOf(DataSourceError);
      expect((err as DataSourceError).kind).toBe("corrupt");
      expect((err as DataSourceError).message).toBe("content broken");
    }
  });
});

describe("rowToPlainObject", () => {
  it("converts [key, value] pairs into a plain object", () => {
    expect(
      rowToPlainObject([
        ["id", 1],
        ["name", "サンプル"],
      ]),
    ).toEqual({ id: 1, name: "サンプル" });
  });

  it("converts bigint values to number", () => {
    expect(rowToPlainObject([["count", 42n]])).toEqual({ count: 42 });
  });

  it("keeps a bigint as a string when numeric conversion is non-finite", () => {
    const huge = 10n ** 400n;
    expect(rowToPlainObject([["count", huge]])).toEqual({ count: huge.toString() });
  });

  it("keeps a finite but unsafe bigint as a string to avoid precision loss", () => {
    const large = 2n ** 60n;
    expect(rowToPlainObject([["count", large]])).toEqual({ count: large.toString() });
  });

  it("/simplify altitude pass: a column literally named __proto__ becomes a genuine own data property, not the exotic setter", () => {
    const row = rowToPlainObject([
      ["id", 1],
      ["__proto__", "polluted?"],
      ["constructor", "also polluted?"],
    ]);
    expect(Object.hasOwn(row, "__proto__")).toBe(true);
    expect(row["__proto__"]).toBe("polluted?");
    expect(row.id).toBe(1);
    expect(row.constructor).toBe("also polluted?");
  });

  it("does not mutate Object.prototype", () => {
    const before = Object.getOwnPropertyNames(Object.prototype);
    rowToPlainObject([["__proto__", "x"]]);
    expect(Object.getOwnPropertyNames(Object.prototype)).toEqual(before);
  });
});
