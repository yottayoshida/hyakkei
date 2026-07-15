export * from "./types.js";
export * from "./egress-policy.js";
export * from "./file-source.js";
export * from "./url-source.js";
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
export { quoteIdentifier } from "./identifier.js";
