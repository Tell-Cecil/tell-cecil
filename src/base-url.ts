/** A tracker's base URL without a trailing slash, e.g. "https://gitlab.example.com/gitlab". Throws if it isn't a plain http(s) URL. */
export function baseUrl(v: string, what: string, example: string): string {
  let u: URL | undefined;
  try {
    u = new URL(v);
  } catch {
    // Reported below.
  }
  if (!u || (u.protocol !== "https:" && u.protocol !== "http:") || u.search || u.hash || u.username || u.password) {
    throw new Error(`${what} "${v}" must be a URL like "${example}"`);
  }
  return u.href.replace(/\/+$/, "");
}
