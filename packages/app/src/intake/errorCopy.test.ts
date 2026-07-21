import type { NetworkBlockedReason } from "@hyakkei/core/datasource";
import { describe, expect, it } from "vitest";
import { describeError, type ErrorFamily } from "./errorCopy.js";
import type { AppErrorKind } from "./types.js";

// The 10 `DataSourceErrorKind` leaves (core) plus the 2 app-only leaves
// (`legacy-xls`/`data-layer-load`, issue #11a) — `as const satisfies` pins
// each listed string as a real literal AND checks it's a valid kind; the
// `_EveryKindListed` type below (Phase 6-B adversarial review: the
// array-literal form alone only proves every LISTED kind is valid, never
// that the list is COMPLETE) is what actually fails the build if
// `AppErrorKind` grows a leaf this list doesn't cover — the real,
// compile-time version of the coverage claim this test makes.
const KNOWN_KINDS = [
  "unsupported-format",
  "corrupt",
  "empty",
  "too-large",
  "encoding",
  "network-blocked",
  "network-notfound",
  "non-csv-response",
  "aborted",
  "oom",
  "legacy-xls",
  "data-layer-load",
] as const satisfies readonly AppErrorKind[];

type _EveryKindListed = AppErrorKind extends (typeof KNOWN_KINDS)[number] ? true : never;
const _everyKindListed: _EveryKindListed = true;
void _everyKindListed;

const NETWORK_BLOCKED_REASONS = [
  "third-party",
  "http-editor",
  "credentials",
  "scheme",
  "fetch-failed",
] as const satisfies readonly NetworkBlockedReason[];

type _EveryReasonListed = NetworkBlockedReason extends (typeof NETWORK_BLOCKED_REASONS)[number]
  ? true
  : never;
const _everyReasonListed: _EveryReasonListed = true;
void _everyReasonListed;

// Pins the family classification per kind (Phase 6-B: the original test
// only checked `tone`, so a mutation swapping e.g. `too-large`'s family
// from "size" to "content" would have passed silently).
const EXPECTED_FAMILY: Record<(typeof KNOWN_KINDS)[number], ErrorFamily> = {
  "unsupported-format": "content",
  corrupt: "content",
  empty: "content",
  encoding: "content",
  "non-csv-response": "acquisition",
  "too-large": "size",
  oom: "size",
  "network-blocked": "acquisition",
  "network-notfound": "acquisition",
  aborted: "acquisition",
  "legacy-xls": "content",
  "data-layer-load": "infrastructure",
};

describe("describeError", () => {
  it.each(KNOWN_KINDS)("returns non-blank copy for every known kind: %s", (kind) => {
    const copy = describeError(kind, undefined);
    expect(copy.title.trim()).not.toBe("");
    expect(copy.detail.trim()).not.toBe("");
  });

  it.each(KNOWN_KINDS)("kind '%s' classifies into its documented family", (kind) => {
    expect(describeError(kind, undefined).family).toBe(EXPECTED_FAMILY[kind]);
  });

  it("'empty' is the only info-tone kind — every other kind is error-tone", () => {
    for (const kind of KNOWN_KINDS) {
      const copy = describeError(kind, undefined);
      expect(copy.tone, kind).toBe(kind === "empty" ? "info" : "error");
    }
  });

  it("oom's copy pins the mandatory trust-anchor line verbatim (D10: shown at the exact moment a user wonders whether their data left the browser)", () => {
    expect(describeError("oom", undefined).detail).toContain("パソコンには保存されていません");
  });

  it.each(NETWORK_BLOCKED_REASONS)(
    "network-blocked with reason '%s' returns copy distinguishable from every OTHER reason and the no-reason fallback",
    (reason) => {
      const withReason = describeError("network-blocked", reason);
      expect(withReason.title.trim()).not.toBe("");
      expect(withReason.detail.trim()).not.toBe("");

      const others = [undefined, ...NETWORK_BLOCKED_REASONS.filter((r) => r !== reason)];
      for (const other of others) {
        const otherCopy = describeError("network-blocked", other);
        // Pairwise, not just "differs from the no-reason fallback"
        // (Phase 6-B: two reasons could have been silently swapped and
        // the original test — which only compared each to the fallback —
        // would not have noticed).
        expect(
          withReason.detail,
          `reason '${reason}' and '${other}' produced identical detail text`,
        ).not.toBe(otherCopy.detail);
      }
    },
  );

  it("each network-blocked reason's copy names its own specific fix, not another reason's", () => {
    // Distinguishing substrings unique to each reason's actual remedy —
    // a mutation that shuffled which `ErrorCopy` object a reason maps to
    // would fail one of these even if all 5 objects individually still
    // looked like "real, non-blank copy".
    expect(describeError("network-blocked", "third-party").detail).toContain("ドラッグ&ドロップ");
    expect(describeError("network-blocked", "http-editor").detail).toContain("https");
    expect(describeError("network-blocked", "credentials").detail).toContain("パスワード");
    expect(describeError("network-blocked", "scheme").detail).toContain("https");
    expect(describeError("network-blocked", "fetch-failed").detail).toContain("時間をおいて");
  });

  it("network-blocked with no reason falls back to generic (still non-blank) copy", () => {
    const copy = describeError("network-blocked", undefined);
    expect(copy.title.trim()).not.toBe("");
    expect(copy.detail.trim()).not.toBe("");
  });

  it("no technical jargon leaks into any known kind's copy", () => {
    const forbidden = ["DuckDB", "duckdb", "BOM", "CORS", "origin", "zip", "HTML", "PAR1"];
    for (const kind of KNOWN_KINDS) {
      const copy = describeError(kind, "fetch-failed");
      for (const term of forbidden) {
        expect(copy.title, `${kind}.title contains "${term}"`).not.toContain(term);
        expect(copy.detail, `${kind}.detail contains "${term}"`).not.toContain(term);
      }
    }
  });

  it("a future, not-yet-recognized kind still degrades to real (non-blank) generic copy, not a blank panel", () => {
    const copy = describeError("some-future-kind" as AppErrorKind, undefined);
    expect(copy.title.trim()).not.toBe("");
    expect(copy.detail.trim()).not.toBe("");
  });

  it("'data-layer-load' explicitly clears the user's file of blame (issue #91: this is the app's own code failing to load, not the user's data)", () => {
    expect(describeError("data-layer-load", undefined).detail).toContain(
      "お使いのファイルに問題はありません",
    );
  });

  it("'legacy-xls' names the concrete fix (re-save as .xlsx), not the generic unsupported-format copy", () => {
    const copy = describeError("legacy-xls", undefined);
    expect(copy.detail).toContain(".xlsx");
    expect(copy.title).not.toBe(describeError("unsupported-format", undefined).title);
  });
});
