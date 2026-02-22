/**
 * URL validation and share target parameter parsing.
 */

/** Extract the article URL from the current page's query parameters. */
export function getUrlFromParams(): string | null {
  const params = new URLSearchParams(window.location.search);

  // Share Target sends ?url=...  Some apps put the URL in ?text= or ?title= instead.
  const candidates = [params.get('url'), params.get('text'), params.get('title')];

  for (const raw of candidates) {
    if (!raw) continue;
    const url = extractUrl(raw);
    if (url) return url;
  }
  return null;
}

/** Try to pull a valid http(s) URL out of an arbitrary string. */
export function extractUrl(text: string): string | null {
  const trimmed = text.trim();

  // Direct URL
  if (isValidArticleUrl(trimmed)) return trimmed;

  // URL might be embedded in surrounding text — pick the first match
  const match = trimmed.match(/https?:\/\/[^\s"'<>]+/i);
  if (match && isValidArticleUrl(match[0])) return match[0];

  return null;
}

/** Basic validation: must be http or https and have a hostname with a dot. */
export function isValidArticleUrl(input: string): boolean {
  try {
    const url = new URL(input);
    return (
      (url.protocol === 'http:' || url.protocol === 'https:') &&
      url.hostname.includes('.')
    );
  } catch {
    return false;
  }
}

/** Clear share-target query params from the URL bar without a reload. */
export function clearQueryParams(): void {
  if (window.location.search) {
    const clean = window.location.pathname;
    window.history.replaceState(null, '', clean);
  }
}
