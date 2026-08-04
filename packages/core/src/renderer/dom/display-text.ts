// Display-text sanitizer for document-supplied prose that the renderer draws
// as its own chrome (issue #124: the dashboard footer's summary, source note
// and dates). Everything else this package renders from a document -- chart
// titles, table cells, message tiles -- is inert once it is `textContent`,
// which is why no sanitizer existed before. Footer text is different in one
// specific way: it makes a CLAIM about where the data came from and when, and
// several such claims sit next to each other, so a value that can reorder or
// hide the text AROUND it can make a machine-recorded stamp read as something
// the author chose.
//
// Concretely: an unterminated U+202E (RIGHT-TO-LEFT OVERRIDE) inside a summary
// reverses the display order of the text that follows it. The footer's own
// defence is `dir="auto"` on every text-bearing element, which the HTML
// rendering spec backs with `unicode-bidi: isolate` -- this function is the
// second layer, for the case where a future edit drops that attribute or puts
// two values in one element.
//
// NOT `download-filename.ts`'s `UNSAFE_CHARS`, despite the overlapping intent:
// that set also strips `\ / : * ? " < > |` because a FILENAME must not carry
// path separators. A source citation legitimately contains those characters
// ("総務省統計局「家計調査」2026年6月分 https://example.go.jp/x?a=1"), so
// reusing it would corrupt exactly the field this exists to display honestly.
//
// The bidi set is `\p{Bidi_Control}` rather than a hand-written range list.
// `download-filename.ts` writes the list by hand and shipped it missing U+061C
// ARABIC LETTER MARK until Codex Round 1 caught it -- the Unicode property is
// the same twelve code points with no opportunity to omit one. (Verified: the
// property matches exactly U+061C, U+200E, U+200F, U+202A-E, U+2066-9.)
//
// Invisibles are taken from `\p{Default_Ignorable_Code_Point}` rather than a
// hand-picked list. This diverges from `download-filename.ts`, which excludes
// U+2060-U+2064 on the grounds that they cannot REORDER text -- true, and the
// wrong test here. A footer draws a label before its value, so a value made
// entirely of invisible characters renders as 「出典: 」 with nothing after it:
// the reader is told a source exists and shown none. Blank-resolution, not
// reordering, is what this side has to get right.
//
// Hand-picking was tried first and measured wrong: with only U+200B and U+FEFF
// listed, eleven other invisibles still passed through non-blank (U+2060,
// U+00AD, U+034F, U+3164, U+115F, U+FE00, U+180E, U+2061, U+2064, U+E0041 and
// the ZWJ family). The property covers all of them and cannot silently miss
// the next one.
//
// U+2800 BRAILLE PATTERN BLANK is deliberately NOT stripped: it is not
// Default_Ignorable, and it is a real character in braille text rather than an
// invisible formatting artifact.
//
// ZWJ (U+200D) is Default_Ignorable and so is removed -- which breaks emoji
// sequences apart into their component glyphs. Accepted: a footer rendering
// three separate faces where the author wrote one family emoji is a cosmetic
// loss, and the alternative (an exception letting ZWJ through) reopens the
// channel for hiding content between visible characters, which is what this
// function exists to close. Pinned in display-text.test.ts so the trade-off
// is a decision on record rather than something discovered later.
//
// The C0 range excludes \x09-\x0d (tab, LF, VT, FF, CR): those are separators,
// not controls, and `sourceNote` holds a source plus notes plus disclaimers in
// one free-text field, so newlines are its natural shape. Deleting them
// outright merges two statements into one word ("出典: A" + "\n" + "注記: B"
// becoming "出典: A注記: B"), which changes what the text says. They fall
// through to the whitespace collapse below instead, which is what turns them
// into the single space a `textContent` node can actually render.
const REMOVED = new RegExp(
  // eslint-disable-next-line no-control-regex -- stripping C0/C1 is the point of this pattern, not an accident
  "[\\p{Bidi_Control}\\p{Default_Ignorable_Code_Point}\\x00-\\x08\\x0e-\\x1f\\x7f-\\x9f]",
  "gu",
);

/**
 * Just the text. An earlier version also returned a `blanked` flag for
 * "the author wrote something that renders as nothing," distinct from "the
 * author wrote nothing" — with four tests and a comment claiming the caller
 * used it to tell them apart. No caller did, and none had a reason to: the
 * footer omits the field either way. Removed rather than left as a field
 * nobody reads, following this package's existing rule against defending
 * against situations that cannot arise (ADR-0010's `hasPendingSources`).
 */
export type DisplayText = {
  /** Sanitized text. Empty when the input carried no visible content. */
  text: string;
};

/**
 * NFC, not NFKC: NFKC rewrites ﬁ to fi and full-width forms to half-width,
 * which would silently edit a source citation's typography. NFC only composes
 * already-equivalent sequences.
 *
 * Removal runs before normalization, though the order does not matter here --
 * NFC does not introduce or remove bidi controls (verified).
 */
export function sanitizeDisplayText(raw: string): DisplayText {
  const text = raw.replace(REMOVED, "").normalize("NFC").replace(/\s+/g, " ").trim();
  return { text };
}
