// Control characters (issue #15/F7, Security review T9): `meta.title` is
// attacker-controllable the moment PR-2b's open exists (`BaseMeta.title`
// has no `maxLength`/pattern -- schema/common.ts's own comment says so
// deliberately, plain display text is not an injection surface AT RENDER
// time). A download FILENAME is a different surface: path separators,
// C0 control characters, and Unicode bidi-control characters (U+202E RTL
// OVERRIDE etc., usable to spoof a file extension -- e.g. a title
// containing "evil" + U+202E + "gpj.exe" *displays* as "evil.exe.jpg")
// all need stripping before this string ever reaches `<a download>`.
// Built via `new RegExp(...,
// "u")` from an explicit `\uXXXX` escape string, not written as literal
// invisible characters in a `/regex/` source literal -- those characters
// are indistinguishable from each other and from nothing at all in an
// editor or a diff, exactly the property this function exists to strip.
// `\p{Bidi_Control}` rather than the code points spelled out. This list was
// written by hand and shipped missing U+061C ARABIC LETTER MARK until Codex
// Round 1 caught it -- the property is the same twelve code points (verified
// by walking all of Unicode: zero difference against the previous escapes)
// with no opportunity to omit one, and it tracks future additions to the
// class on its own. `renderer/dom/display-text.ts` reached the same form
// independently for the dashboard footer; this is the older copy catching up.
//
// U+2060-U+2064 (WORD JOINER etc.) are format characters, not bidi controls,
// and remain excluded here -- they cannot reorder displayed text the way an
// extension-spoofing attack needs. (`display-text.ts` DOES strip them,
// because its question is "does this value render as nothing", not "can it
// reorder"; the two policies genuinely differ and are not shared.)
const UNSAFE_CHARS = new RegExp(
  // eslint-disable-next-line no-control-regex -- the \x00-\x1f range is the point of this pattern, not an accident
  '[\\\\/:*?"<>|\\x00-\\x1f\\p{Bidi_Control}]',
  "gu",
);

/**
 * Deliberately NOT `generateSourceId`'s sanitizer (`intake/identifier.ts`,
 * mirror-pattern handoff #1, shape enumeration A9): that function collapses
 * every non-ASCII character to `_` (`予算_2026年度` -> `"table"`) because its
 * output is an internal DuckDB identifier, never shown to a user
 * (`identifier.ts`'s own doc comment states this explicitly). A download
 * filename is the opposite case -- it IS user-facing, so CJK and emoji must
 * survive.
 */
function sanitizeTitle(title: string): string {
  const normalized = title.normalize("NFC");
  const stripped = normalized.replace(UNSAFE_CHARS, "");
  const collapsed = stripped.replace(/\s+/g, " ").trim();
  const trimmed = collapsed.replace(/^[.\s]+|[.\s]+$/g, "");
  // Code-point iteration via `for...of`, not `.slice(0, 60)` (Codex Round 1
  // P2): `String.prototype.slice` counts UTF-16 code UNITS, so a title
  // ending exactly at the 60-unit boundary mid-emoji would keep only the
  // lone leading surrogate of a pair -- an unpaired surrogate that,
  // depending on the browser, either renders as U+FFFD or corrupts the
  // filename outright. `for...of` iterates by code POINT (like
  // `Array.from`) but stops at 60 without first materializing an array of
  // every code point in an attacker-controlled title (`meta.title` has no
  // schema `maxLength` -- adversarial case A-7, up to 100,000 characters).
  let truncated = "";
  let count = 0;
  for (const char of trimmed) {
    if (count >= 60) break;
    truncated += char;
    count++;
  }
  return truncated === "" ? "dashboard" : truncated;
}

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

/** `YYYYMMDD-HHmm` in the local timezone -- matches the UX/Security-agreed default filename shape, not UTC (the user reads this timestamp, not a machine). */
function formatTimestamp(date: Date): string {
  return `${date.getFullYear()}${pad2(date.getMonth() + 1)}${pad2(date.getDate())}-${pad2(date.getHours())}${pad2(date.getMinutes())}`;
}

/**
 * `<title>_YYYYMMDD-HHmm.json` (issue #15/F7, UX decision): every save is a
 * fresh browser download (`showSaveFilePicker` is Chromium-only, rejected
 * -- ADR-0002/plan), so files accumulate in Downloads as
 * `dashboard.json`/`dashboard (1).json`/... with no way to tell which is
 * newest. A sortable timestamp suffix fixes that with zero extra UI and
 * matches Japanese municipal document-naming convention (date-suffixed
 * filenames are the norm there, not a browser-download workaround).
 * `now` is an injected parameter (not `new Date()` internally) purely for
 * test determinism.
 */
export function downloadFilename(title: string, now: Date): string {
  return `${sanitizeTitle(title)}_${formatTimestamp(now)}.json`;
}
