/**
 * `sniff.ts` (magic-byte format checks) and `encoding.ts` (BOM detection)
 * both need a byte-prefix match — shared here instead of two independently
 * maintained copies (/simplify reuse pass).
 */
export function startsWith(bytes: Uint8Array, magic: Uint8Array, offset = 0): boolean {
  if (bytes.length < offset + magic.length) return false;
  for (let i = 0; i < magic.length; i++) {
    if (bytes[offset + i] !== magic[i]) return false;
  }
  return true;
}

export const UTF8_BOM = new Uint8Array([0xef, 0xbb, 0xbf]);
