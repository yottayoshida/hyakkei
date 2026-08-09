/**
 * Resolve a packaged asset against the document that loaded the app. Using
 * `document.baseURI` keeps every self-hosted DuckDB resource under a GitHub
 * Pages project subpath instead of accidentally pointing at the origin root.
 */
export function appAssetUrl(path: string, base = document.baseURI): string {
  if (
    path.startsWith("/") ||
    path.includes("\\") ||
    /\s/.test(path) ||
    path.split("/").includes("..") ||
    /^[a-z][a-z\d+.-]*:/i.test(path)
  ) {
    throw new Error(`Expected a relative app asset path, received: ${path}`);
  }

  const baseUrl = new URL(".", new URL(base));
  const resolved = new URL(path, baseUrl);
  if (resolved.origin !== baseUrl.origin || !resolved.pathname.startsWith(baseUrl.pathname)) {
    throw new Error(`Expected a relative app asset path within its base path, received: ${path}`);
  }
  return resolved.toString();
}
