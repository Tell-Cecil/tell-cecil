/** Selectors a site can extend. Excluded elements can't be picked; masked ones lose their text. */
export interface Privacy {
  exclude?: string[];
  mask?: string[];
  /** Maps the page URL before it is sent. Default keeps origin and path, dropping query and hash. */
  url?: (href: string) => string;
}

/** The page URL as reported: rewritten by `privacy.url`, else origin and path only (no query or hash). */
export function pageUrl(href: string, p: Privacy = {}): string {
  if (p.url) return p.url(href);
  const u = new URL(href);
  return u.origin + u.pathname;
}
