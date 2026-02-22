/**
 * Article extraction: fetch HTML through CORS proxy, parse with Readability.
 */
import { detectLanguage } from './lang-detect.js';
const MIN_PARAGRAPH_LENGTH = 20;
const MAX_ARTICLE_SIZE = 2000000; // 2 MB
const FETCH_TIMEOUT = 10000; // 10 s
const WORDS_PER_MINUTE = 180; // spoken pace
/**
 * Fetch an article URL via the CORS proxy and extract readable content.
 */
export async function extractArticle(url, proxyBase, proxySecret) {
    const html = await fetchViaProxy(url, proxyBase, proxySecret);
    return parseArticle(html, url);
}
async function fetchViaProxy(url, proxyBase, proxySecret) {
    const proxyUrl = `${proxyBase}?url=${encodeURIComponent(url)}`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT);
    const headers = {};
    if (proxySecret) {
        headers['X-Proxy-Key'] = proxySecret;
    }
    try {
        const resp = await fetch(proxyUrl, { signal: controller.signal, headers });
        if (!resp.ok) {
            // Try to read error body from the proxy for more detail
            let detail = '';
            try {
                const body = await resp.json();
                if (body.error)
                    detail = body.error;
            }
            catch { /* ignore parse errors */ }
            if (resp.status === 403) {
                throw new Error(detail || 'Proxy rejected the request — check that PROXY_SECRET is configured in the app.');
            }
            throw new Error(detail || `Proxy returned ${resp.status}: ${resp.statusText}`);
        }
        const contentLength = resp.headers.get('content-length');
        if (contentLength && parseInt(contentLength, 10) > MAX_ARTICLE_SIZE) {
            throw new Error('Article is too large (>2 MB).');
        }
        return await resp.text();
    }
    catch (err) {
        if (err instanceof DOMException && err.name === 'AbortError') {
            throw new Error('Timed out fetching the article. Try again later.');
        }
        if (err instanceof TypeError) {
            throw new Error('Could not reach the article proxy. Check your internet connection or try again later.');
        }
        throw err;
    }
    finally {
        clearTimeout(timer);
    }
}
function parseArticle(html, sourceUrl) {
    const doc = new DOMParser().parseFromString(html, 'text/html');
    // Fix relative URLs so Readability can resolve them
    const base = doc.createElement('base');
    base.href = sourceUrl;
    doc.head.appendChild(base);
    const parsed = new Readability(doc).parse();
    let title;
    let textContent;
    let content;
    let siteName;
    let excerpt;
    if (parsed) {
        title = parsed.title;
        textContent = parsed.textContent;
        content = parsed.content;
        siteName = parsed.siteName || new URL(sourceUrl).hostname;
        excerpt = parsed.excerpt;
    }
    else {
        // Fallback: grab all <p> text
        const pElements = doc.querySelectorAll('p');
        const paragraphs = Array.from(pElements).map((p) => p.textContent?.trim() ?? '');
        textContent = paragraphs.filter((p) => p.length > 0).join('\n\n');
        content = '';
        title = doc.title || 'Untitled';
        siteName = new URL(sourceUrl).hostname;
        excerpt = textContent.slice(0, 200);
    }
    if (!textContent || textContent.trim().length === 0) {
        throw new Error('Could not extract readable content from this page.');
    }
    const paragraphs = textContent
        .split(/\n\s*\n/)
        .map((p) => p.trim())
        .filter((p) => p.length >= MIN_PARAGRAPH_LENGTH);
    if (paragraphs.length === 0) {
        // If double-newline splitting yields nothing, try single newlines
        const fallback = textContent
            .split(/\n/)
            .map((p) => p.trim())
            .filter((p) => p.length >= MIN_PARAGRAPH_LENGTH);
        if (fallback.length === 0) {
            throw new Error('Article appears empty after parsing.');
        }
        paragraphs.push(...fallback);
    }
    const wordCount = textContent.split(/\s+/).length;
    const estimatedMinutes = Math.max(1, Math.round(wordCount / WORDS_PER_MINUTE));
    const lang = detectLanguage(textContent);
    return {
        title,
        content,
        textContent,
        paragraphs,
        lang,
        siteName,
        excerpt,
        wordCount,
        estimatedMinutes,
    };
}
