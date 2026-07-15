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
