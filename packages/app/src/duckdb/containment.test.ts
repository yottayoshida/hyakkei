import type { AsyncDuckDBConnection } from "@duckdb/duckdb-wasm";
import { describe, expect, it, vi } from "vitest";
import { configureContainment } from "./containment.js";

function fakeConnection(): { conn: AsyncDuckDBConnection; query: ReturnType<typeof vi.fn> } {
  const query = vi.fn().mockResolvedValue(undefined);
  return { conn: { query } as unknown as AsyncDuckDBConnection, query };
}

describe("configureContainment", () => {
  it("issues exactly the 4 M0-verified SET statements, in order, with lock_configuration last", async () => {
    const { conn, query } = fakeConnection();
    await configureContainment(conn);

    expect(query.mock.calls.map((call) => call[0])).toEqual([
      "SET autoinstall_known_extensions=false",
      "SET autoload_known_extensions=false",
      "SET allow_community_extensions=false",
      "SET lock_configuration=true",
    ]);
  });

  it("never sets enable_external_access (M0: breaks registerFileBuffer's local reads)", async () => {
    const { conn, query } = fakeConnection();
    await configureContainment(conn);

    const issued = query.mock.calls.map((call) => String(call[0]));
    expect(issued.some((sql) => sql.includes("enable_external_access"))).toBe(false);
  });
});
