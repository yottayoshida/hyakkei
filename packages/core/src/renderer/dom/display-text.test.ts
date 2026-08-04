import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { sanitizeDisplayText } from "./display-text.js";

// Written as escapes, never as literal characters. `download-filename.ts`'s
// own comment makes the case: an invisible character in source is
// indistinguishable from a different invisible character, and from nothing at
// all, in an editor and in a diff — which is the exact property these tests
// exist to control.
const RLO = "\u202e"; // RIGHT-TO-LEFT OVERRIDE — reorders the text that follows
const ALM = "\u061c"; // ARABIC LETTER MARK — the one download-filename.ts shipped without
const ZWSP = "\u200b";
const BOM = "\ufeff";

describe("sanitizeDisplayText", () => {
  it("leaves ordinary Japanese prose untouched", () => {
    const s = "総務省統計局「家計調査」2026年6月分";
    expect(sanitizeDisplayText(s)).toEqual({ text: s });
  });

  it("keeps the punctuation a source citation needs, which the filename sanitizer strips", () => {
    // This is the whole reason this function exists separately from
    // `download-filename.ts`: every character below is in that file's
    // UNSAFE_CHARS set, and every one of them is legitimate here.
    const s = 'https://example.go.jp/data?a=1&b=2 — 注記: 出典は "家計調査" | 免責事項あり';
    expect(sanitizeDisplayText(s).text).toBe(s);
  });

  it("strips every Bidi_Control code point, including U+061C", () => {
    // Enumerated from the Unicode property rather than a hand-written list,
    // for the same reason the implementation uses \p{Bidi_Control}: a
    // hand-written list is what dropped U+061C once already.
    const bidi: string[] = [];
    for (let cp = 0; cp <= 0x2ffff; cp++) {
      const ch = String.fromCodePoint(cp);
      if (/\p{Bidi_Control}/u.test(ch)) bidi.push(ch);
    }
    expect(bidi).toHaveLength(12);
    expect(bidi).toContain(ALM);
    for (const ch of bidi) {
      const cp = ch.codePointAt(0)!.toString(16).padStart(4, "0");
      expect(sanitizeDisplayText(`a${ch}b`).text, `U+${cp}`).toBe("ab");
    }
  });

  it("stops an unterminated RLO from reaching the DOM", () => {
    // The attack this exists for: text after the override renders reversed,
    // so a summary can rewrite how the provenance line beside it reads.
    expect(sanitizeDisplayText(`要約${RLO}2026-08-01 更新`).text).toBe("要約2026-08-01 更新");
  });

  it("strips C0 and C1 control characters", () => {
    expect(sanitizeDisplayText("a\x00b\x01c\x1fd\x7fe\x9f").text).toBe("abcde");
  });

  it("treats newlines and tabs as separators, not as controls to delete", () => {
    // `sourceNote` carries a source, notes and disclaimers in one free-text
    // field, so newlines are its natural shape. Deleting them outright would
    // merge two statements into one word and change what the text says.
    expect(sanitizeDisplayText("出典: 家計調査\n注記: 速報値").text).toBe(
      "出典: 家計調査 注記: 速報値",
    );
    expect(sanitizeDisplayText("a\tb\vc\fd\re").text).toBe("a b c d e");
  });

  it("resolves an invisible-only value to blank, across the whole class", () => {
    // A table, not two hand-picked characters. "Invisible-only reads as blank"
    // is a claim about a CLASS, and an earlier version tested ZWSP and BOM —
    // the two that came to mind — while eleven others passed through non-blank,
    // each one enough to render 「出典: 」 with nothing after it.
    const invisibles: ReadonlyArray<readonly [string, string]> = [
      ["ZWSP", ZWSP],
      ["BOM", BOM],
      ["WORD JOINER", "\u2060"],
      ["SOFT HYPHEN", "\u00ad"],
      ["COMBINING GRAPHEME JOINER", "\u034f"],
      ["HANGUL FILLER", "\u3164"],
      ["HANGUL CHOSEONG FILLER", "\u115f"],
      ["VARIATION SELECTOR-1", "\ufe00"],
      ["MONGOLIAN VOWEL SEPARATOR", "\u180e"],
      ["FUNCTION APPLICATION", "\u2061"],
      ["INVISIBLE PLUS", "\u2064"],
      ["TAG LATIN A", "\u{e0041}"],
    ];
    for (const [name, ch] of invisibles) {
      expect(sanitizeDisplayText(ch), name).toEqual({ text: "" });
    }
    expect(sanitizeDisplayText(invisibles.map(([, ch]) => ch).join(""))).toEqual({
      text: "",
    });
  });

  it("keeps U+2800 BRAILLE PATTERN BLANK, which is a character rather than a formatting artifact", () => {
    // The boundary of the rule above: it is not Default_Ignorable, and a
    // braille reader needs it. Removing it would corrupt braille prose the
    // same way stripping a space corrupts ordinary prose.
    expect(sanitizeDisplayText("⠀").text).toBe("⠀");
  });

  it("V-106: resolves whitespace-only and invisible-only values to empty", () => {
    // All four render the same way — the footer omits the field. Kept as one
    // test because the inputs are different SHAPES of "nothing", and a
    // regression is likely to break one without the others.
    expect(sanitizeDisplayText("")).toEqual({ text: "" });
    expect(sanitizeDisplayText("   ")).toEqual({ text: "" });
    // U+3000 IDEOGRAPHIC SPACE, as an escape: a literal one here is
    // indistinguishable from an ASCII space in a diff.
    expect(sanitizeDisplayText("\u3000")).toEqual({ text: "" });
    expect(sanitizeDisplayText(RLO)).toEqual({ text: "" });
  });

  it("collapses runs of whitespace", () => {
    expect(sanitizeDisplayText("  一行目\n\n二行目\t三行目  ").text).toBe("一行目 二行目 三行目");
  });

  it("applies NFC but not NFKC", () => {
    // NFC composes: か + combining dakuten becomes the single code point が.
    expect(sanitizeDisplayText("が").text).toBe("が");
    // NFKC would rewrite both of these; NFC must not, because a citation's
    // typography is part of what it says.
    expect(sanitizeDisplayText("ﬁ").text).toBe("ﬁ");
    expect(sanitizeDisplayText("２０２６年").text).toBe("２０２６年");
  });

  it("normalization does not reintroduce a stripped bidi control", () => {
    // Pins the implementation comment's claim that removal-then-normalize is
    // safe: if NFC could produce a bidi control, the order would matter.
    const out = sanitizeDisplayText(`か${RLO}゙`).text;
    expect(/\p{Bidi_Control}/u.test(out)).toBe(false);
    expect(out).toBe("が");
  });

  it("keeps individual emoji and combining marks intact", () => {
    expect(sanitizeDisplayText("\u{1f4ca} グラフ").text).toBe("\u{1f4ca} グラフ");
    // A combining mark is not Default_Ignorable, and NFC composes it rather
    // than dropping it.
    expect(sanitizeDisplayText("パ").text).toBe("パ");
  });

  it("splits a ZWJ emoji sequence, which is the accepted cost of the rule above", () => {
    // ZWJ is Default_Ignorable, so the invisible-only rule removes it and the
    // sequence renders as its component glyphs. Written as a test rather than
    // left to be discovered: a footer showing three faces instead of one
    // family is a cosmetic loss, and the alternative — an exception letting
    // ZWJ through — reopens the channel this function exists to close.
    const family = "\u{1f469}\u200d\u{1f469}\u200d\u{1f466}";
    expect(sanitizeDisplayText(family).text).toBe("\u{1f469}\u{1f469}\u{1f466}");
  });
});

describe("the sources involved carry no literal invisible characters", () => {
  // Enforced rather than remembered. Writing these tests, a literal
  // zero-width or full-width space slipped into the source three separate
  // times — each time invisible in the diff, and each time found only by an
  // ad-hoc script. That is precisely the failure mode this module exists to
  // prevent in a document, so leaving it unchecked in the module's own source
  // would be the same defect one level up.
  const files = [
    "display-text.ts",
    "display-text.test.ts",
    "dashboard-footer.ts",
    "dashboard-footer.test.ts",
  ];

  it.each(files)("%s writes them as escapes", (name) => {
    const source = readFileSync(join(import.meta.dirname, name), "utf8");
    const offenders = [...source]
      .map((ch, index) => ({ ch, index }))
      .filter(({ ch }) => {
        const cp = ch.codePointAt(0)!;
        return (
          /\p{Bidi_Control}/u.test(ch) ||
          cp === 0x200b || // ZERO WIDTH SPACE
          cp === 0x200d || // ZERO WIDTH JOINER
          cp === 0xfeff || // BOM / ZERO WIDTH NO-BREAK SPACE
          cp === 0x00a0 || // NO-BREAK SPACE
          cp === 0x3000 || // IDEOGRAPHIC SPACE
          cp === 0x7f ||
          (cp < 0x20 && ch !== "\n") ||
          (cp >= 0x80 && cp <= 0x9f)
        );
      })
      .map(({ ch, index }) => {
        const line = source.slice(0, index).split("\n").length;
        const cp = ch.codePointAt(0)!.toString(16).toUpperCase().padStart(4, "0");
        return `line ${line}: U+${cp}`;
      });
    expect(offenders).toEqual([]);
  });
});
