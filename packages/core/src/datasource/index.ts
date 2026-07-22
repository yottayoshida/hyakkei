export * from "./types.js";
export * from "./egress-policy.js";
export * from "./file-source.js";
export * from "./url-source.js";
// issue 11b: the app's column-type-override UI reaches these through the
// same lazy `loadDataLayer()` boundary as the rest of this barrel
// (`layer.datasource.buildCastValidationSql(...)`, etc.) — never a static
// value import from `packages/app` (issue #54 bundle isolation).
export * from "./column-types.js";
// issue 11c: the app's light-shaping GUI reaches the query resolver
// (`buildQuerySql`/`buildQueryPreviewSql`/`buildQueryDiagnosticsSql`)
// through this same lazy boundary (`layer.datasource.buildQueryPreviewSql`,
// etc.), never a static value import (issue #54 bundle isolation).
export * from "./query-sql.js";
// Only `rowToPlainObject` is public from register-path.ts (not `export *`)
// — the rest (withVirtualTextFile, describeTable, classifyRegisterFailure,
// etc.) are FileSource/UrlSource's own internal plumbing, not part of the
// DataSource API surface. `rowToPlainObject` is the exception: a future
// editor/preview (PR-B) reading registered rows back into JS needs it to
// avoid reintroducing the `.toJSON()` `__proto__`-drop bug this PR found.
export { rowToPlainObject } from "./register-path.js";
// `quoteIdentifier` is PR-B's second addition to this exception list: the
// intake harness issues its own `DROP TABLE IF EXISTS <id>` when a user
// redoes a registration (register.ts's `CREATE TABLE` is not `CREATE OR
// REPLACE` — a stale table from an abandoned attempt would otherwise
// collide with a retry using the same generated id), and that statement
// needs the same identifier-quoting discipline `register-path.ts` already
// applies internally.
// `quoteStringLiteral` joins this exception list for issue 11c: it was
// previously defense-in-depth only (its one caller already guaranteed a
// safe input by construction), but issue 11c's query-sql.ts filter-value
// literals are genuinely untrusted user text, making this function
// load-bearing rather than optional hardening (Codex plan review finding).
export { quoteIdentifier, quoteStringLiteral } from "./identifier.js";
