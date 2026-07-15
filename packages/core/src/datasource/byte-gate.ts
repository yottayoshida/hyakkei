import { DEFAULT_MAX_BYTES } from "./egress-policy.js";
import { DataSourceError } from "./types.js";

// Re-exported (not re-declared) so both acquisition paths enforce the same
// 256 MiB ceiling by construction, not by two literals staying in sync
// manually (/simplify reuse pass) — `EgressPolicy.fetchBytes()`
// streams-and-counts a network `Response` body, while `FileSource`'s bytes
// are already fully materialized by the time this ceiling runs (post-hoc,
// not streaming), but the limit itself is the same value either way.
export { DEFAULT_MAX_BYTES };

/**
 * O-GATE (shape enumeration §4/§5): lives in the shared register path, not
 * in `EgressPolicy` alone — `FileSource` never touches egress (RS-9), so a
 * cap that only existed on the network side would leave File-acquired
 * bytes completely unguarded (the shape-enumeration mirror-pattern
 * finding, §5's "one place the naive hypothesis is wrong"). `UrlSource`'s
 * bytes are already pre-capped by `fetchBytes()` before they ever reach
 * this function — this is a second, authoritative check that holds
 * regardless of which acquisition path a given `DataSource` uses (V-089,
 * guarded against one-sided drift by the mirror-seam spy test, V-094).
 */
export function assertByteCeiling(bytes: Uint8Array, maxBytes: number = DEFAULT_MAX_BYTES): void {
  if (bytes.byteLength > maxBytes) {
    throw new DataSourceError(
      "too-large",
      `content is ${bytes.byteLength} bytes, exceeding the ${maxBytes}-byte limit`,
    );
  }
}
