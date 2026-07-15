import iconv from "iconv-lite";
import { startsWith, UTF8_BOM } from "./byte-prefix.js";

const UTF16LE_BOM = new Uint8Array([0xff, 0xfe]);
const UTF16BE_BOM = new Uint8Array([0xfe, 0xff]);

/**
 * O-ENC (csv only — shape enumeration §2d/§4, plan D11): decodes raw bytes
 * to text via a deliberately simple 2-stage detector, not a full
 * confidence-scoring sniffer (`jschardet` was evaluated and deferred at
 * /plan time — the UX requirement is zero technical jargon exposed to the
 * user, which a lightweight, explainable 2-stage check satisfies as well
 * as a heavier one would).
 *
 * Stage order is load-bearing (EN-9/EN-10/CS-B7, verified empirically
 * during shape enumeration): a UTF-16 BOM MUST be checked and handled
 * *before* the UTF-8-fatal probe, not after. A UTF-16LE-encoded file
 * (`FF FE ...`) throws under `TextDecoder("utf-8", {fatal:true})` (it is
 * not valid UTF-8), which would otherwise fall through to the Shift_JIS
 * branch and silently mojibake the entire file — the fatal-throw does NOT
 * protect against this on its own; only checking the BOM first does.
 * `TextDecoder`'s default `ignoreBOM:false` strips a matched BOM for
 * whichever encoding label is passed (verified empirically for UTF-8;
 * applies uniformly to the UTF-16 variants too), so callers never see the
 * BOM bytes as leading garbage in the returned string (EN-2's bug — a
 * literal U+FEFF character prepended to the first column name, e.g. "id"
 * read back as invisible-BOM-plus-"id" — is what happens if this default
 * is ever overridden).
 *
 * Known, accepted residual risk (EN-4/EN-7/EN-12, not fixed here — the
 * 2-stage detector is deliberately this simple, per /plan's scope): bytes
 * that are simultaneously valid UTF-8 AND intended as Shift_JIS (rare, but
 * real) decode silently as UTF-8 with no throw; a truncated multibyte
 * sequence at EOF may fall through to a permissive Shift_JIS decode rather
 * than cleanly erroring; Latin-1/Windows-1252 content is out of scope
 * entirely (not a third detector branch) and will decode as garbled
 * Shift_JIS. All three are mitigated at the UI layer (PR-B's "文字化けて
 * いますか？" escape hatch — re-read as a different encoding), not by a
 * more elaborate detector here.
 */
export function decodeCsvText(bytes: Uint8Array): string {
  if (startsWith(bytes, UTF8_BOM)) return new TextDecoder("utf-8").decode(bytes);
  if (startsWith(bytes, UTF16LE_BOM)) return new TextDecoder("utf-16le").decode(bytes);
  if (startsWith(bytes, UTF16BE_BOM)) return new TextDecoder("utf-16be").decode(bytes);

  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    // Passed directly as a Uint8Array, not wrapped in `Buffer.from()`:
    // verified empirically (with `global.Buffer` unset, simulating a
    // browser) that `iconv.decode()` works correctly on a plain
    // `Uint8Array` — Node's `Buffer` global does not exist in this
    // project's browser runtime, and iconv-lite's decode path does not
    // require it when the input is already a typed array, not a string.
    return iconv.decode(bytes, "Shift_JIS");
  }
}
