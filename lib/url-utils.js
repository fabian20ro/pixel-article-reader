/**
 * URL validation and share target parameter parsing.
 */
/** Extract the article URL from the current page's query parameters. */
export function getUrlFromParams() {
    const params = new URLSearchParams(window.location.search);
    // Share Target sends ?url=...  Some apps put the URL in ?text= or ?title= instead.
    const candidates = [params.get('url'), params.get('text'), params.get('title')];
    for (const raw of candidates) {
        if (!raw)
            continue;
        const url = extractUrl(raw);
        if (url)
            return url;
    }
    return null;
}
/** Try to pull a valid http(s) URL out of an arbitrary string.
 *
 * Only extracts URLs at/near the end of the text (share-text format like
 * "Article Title\nhttps://...").  If the URL is embedded in the middle of
 * long text, returns null so the caller can treat the input as pasted
 * article content.
 */
export function extractUrl(text) {
    const trimmed = text.trim();
    // Direct URL
    if (isValidArticleUrl(trimmed))
        return trimmed;
    // URL at the end of the text with a short description prefix (≤ 150 chars).
    // Covers the common share-text pattern: "Article Title\nhttps://..."
    const endMatch = trimmed.match(/https?:\/\/[^\s"'<>]+$/i);
    if (endMatch && isValidArticleUrl(endMatch[0])) {
        const prefix = trimmed.slice(0, endMatch.index).trim();
        if (prefix.length <= 150)
            return endMatch[0];
    }
    return null;
}
/** Basic validation: must be http or https and have a hostname with a dot. */
export function isValidArticleUrl(input) {
    try {
        const url = new URL(input);
        return ((url.protocol === 'http:' || url.protocol === 'https:') &&
            url.hostname.includes('.'));
    }
    catch {
        return false;
    }
}
/** Clear share-target query params from the URL bar without a reload. */
export function clearQueryParams() {
    if (window.location.search) {
        const clean = window.location.pathname;
        window.history.replaceState(null, '', clean);
    }
}
