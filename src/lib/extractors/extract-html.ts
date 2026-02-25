/**
 * HTML article extraction via Readability.js + Turndown.
 * Also handles URL-level fetch orchestration (HTML vs PDF detection).
 */

import { detectLanguage } from '../lang-detect.js';
import {
  type Article,
  MAX_ARTICLE_SIZE,
  PDF_FETCH_TIMEOUT,
  FETCH_TIMEOUT,
  WORDS_PER_MINUTE,
  IMAGE_MD_RE,
  IMAGE_JINA_RE,
  IMAGE_HTML_RE,
} from './types.js';
import {
  splitPlainTextParagraphs,
  markdownToParagraphs,
  extractTitleFromMarkdown,
  countWords,
} from './utils.js';
import { parsePdfFromArrayBuffer } from './extract-pdf.js';

// Readability is loaded as a global via <script> tag (vendor/Readability.js)
declare const Readability: new (doc: Document) => {
  parse(): { title: string; content: string; textContent: string; siteName: string; excerpt: string } | null;
};

// Turndown is loaded as a global via <script> tag (vendor/turndown.js)
declare const TurndownService: new (options?: Record<string, unknown>) => {
  turndown(html: string): string;
};

/**
 * Handle non-OK proxy responses with detailed error messages.
 */
async function handleProxyError(resp: Response): Promise<never> {
  let detail = '';
  try {
    const body = await resp.json();
    if (body.error) detail = body.error;
  } catch { /* ignore parse errors */ }

  if (resp.status === 429) {
    const retryAfter = resp.headers.get('Retry-After');
    const waitMsg = retryAfter ? ` Try again in ${retryAfter} seconds.` : ' Please wait a moment and try again.';
    throw new Error(detail || `Rate limit exceeded — too many requests.${waitMsg}`);
  }
  if (resp.status === 403) {
    throw new Error(detail || 'Proxy rejected the request — check that PROXY_SECRET is configured in the app.');
  }
  throw new Error(detail || `Proxy returned ${resp.status}: ${resp.statusText}`);
}

/** Check if a URL likely points to a PDF based on its path. */
function isPdfUrl(url: string): boolean {
  try {
    const pathname = new URL(url).pathname.toLowerCase();
    return pathname.endsWith('.pdf');
  } catch {
    return false;
  }
}

async function fetchViaProxy(
  url: string,
  proxyBase: string,
  proxySecret?: string,
  mode: 'html' | 'markdown' = 'html',
): Promise<{ body: string; finalUrl: string }> {
  const proxyUrl = `${proxyBase}?url=${encodeURIComponent(url)}${mode === 'markdown' ? '&mode=markdown' : ''}`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT);

  const headers: Record<string, string> = {};
  if (proxySecret) {
    headers['X-Proxy-Key'] = proxySecret;
  }

  try {
    const resp = await fetch(proxyUrl, { signal: controller.signal, headers });
    if (!resp.ok) {
      await handleProxyError(resp);
    }

    const contentLength = resp.headers.get('content-length');
    if (contentLength && parseInt(contentLength, 10) > MAX_ARTICLE_SIZE) {
      throw new Error('Article is too large (>2 MB).');
    }

    const body = await resp.text();
    if (body.length > MAX_ARTICLE_SIZE) {
      throw new Error('Article is too large (>2 MB).');
    }

    const finalUrl = resp.headers.get('X-Final-URL') || url;
    return { body, finalUrl };
  } catch (err: unknown) {
    if (err instanceof DOMException && err.name === 'AbortError') {
      throw new Error('Timed out fetching the article. Try again later.');
    }
    if (err instanceof TypeError) {
      throw new Error('Could not reach the article proxy. Check your internet connection or try again later.');
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Fetch an article URL via the CORS proxy and extract readable content.
 * Automatically detects PDF by URL extension or response content-type,
 * applying the correct size limits for each type.
 */
export async function extractArticle(
  url: string,
  proxyBase: string,
  proxySecret?: string,
  onProgress?: (message: string) => void,
): Promise<Article> {
  // Fast path: URL clearly ends in .pdf
  if (isPdfUrl(url)) {
    return extractArticleFromPdfUrl(url, proxyBase, proxySecret, onProgress);
  }

  onProgress?.('Fetching article...');

  const proxyUrl = `${proxyBase}?url=${encodeURIComponent(url)}`;
  const headers: Record<string, string> = {};
  if (proxySecret) {
    headers['X-Proxy-Key'] = proxySecret;
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PDF_FETCH_TIMEOUT);

  try {
    const resp = await fetch(proxyUrl, { signal: controller.signal, headers });
    if (!resp.ok) {
      await handleProxyError(resp);
    }

    const ct = resp.headers.get('content-type') || '';

    // PDF detected by content-type — use PDF size limit and binary reading
    if (ct.includes('application/pdf')) {
      const { MAX_PDF_SIZE } = await import('./types.js');
      const contentLength = resp.headers.get('content-length');
      if (contentLength && parseInt(contentLength, 10) > MAX_PDF_SIZE) {
        throw new Error('PDF is too large (>10 MB).');
      }
      const buffer = await resp.arrayBuffer();
      if (buffer.byteLength > MAX_PDF_SIZE) {
        throw new Error('PDF is too large (>10 MB).');
      }
      const finalUrl = resp.headers.get('X-Final-URL') || url;
      onProgress?.('Extracting text from PDF...');
      return parsePdfFromArrayBuffer(buffer, finalUrl, onProgress);
    }

    // HTML path — article size limit
    const contentLength = resp.headers.get('content-length');
    if (contentLength && parseInt(contentLength, 10) > MAX_ARTICLE_SIZE) {
      throw new Error('Article is too large (>2 MB).');
    }
    const body = await resp.text();
    if (body.length > MAX_ARTICLE_SIZE) {
      throw new Error('Article is too large (>2 MB).');
    }

    // Fallback: detect PDF by magic bytes when content-type was wrong
    if (body.startsWith('%PDF-')) {
      onProgress?.('Extracting text from PDF...');
      return parsePdfFromArrayBuffer(
        new TextEncoder().encode(body).buffer as ArrayBuffer,
        resp.headers.get('X-Final-URL') || url,
        onProgress,
      );
    }

    const finalUrl = resp.headers.get('X-Final-URL') || url;
    return parseArticleFromHtml(body, finalUrl);
  } catch (err: unknown) {
    if (err instanceof DOMException && err.name === 'AbortError') {
      throw new Error('Timed out fetching the article. Try again later.');
    }
    if (err instanceof TypeError) {
      throw new Error('Could not reach the article proxy. Check your internet connection or try again later.');
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Fetch a PDF via the CORS proxy and extract readable text using pdf.js.
 */
export async function extractArticleFromPdfUrl(
  url: string,
  proxyBase: string,
  proxySecret?: string,
  onProgress?: (message: string) => void,
): Promise<Article> {
  onProgress?.('Downloading PDF...');

  const { MAX_PDF_SIZE } = await import('./types.js');
  const proxyUrl = `${proxyBase}?url=${encodeURIComponent(url)}`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PDF_FETCH_TIMEOUT);

  const headers: Record<string, string> = {};
  if (proxySecret) {
    headers['X-Proxy-Key'] = proxySecret;
  }

  try {
    const resp = await fetch(proxyUrl, { signal: controller.signal, headers });
    if (!resp.ok) {
      await handleProxyError(resp);
    }

    const contentLength = resp.headers.get('content-length');
    if (contentLength && parseInt(contentLength, 10) > MAX_PDF_SIZE) {
      throw new Error('PDF is too large (>10 MB).');
    }

    const buffer = await resp.arrayBuffer();
    if (buffer.byteLength > MAX_PDF_SIZE) {
      throw new Error('PDF is too large (>10 MB).');
    }

    const finalUrl = resp.headers.get('X-Final-URL') || url;
    onProgress?.('Extracting text from PDF...');

    return parsePdfFromArrayBuffer(buffer, finalUrl, onProgress);
  } catch (err: unknown) {
    if (err instanceof DOMException && err.name === 'AbortError') {
      throw new Error('Timed out downloading the PDF. The file may be too large or the connection is slow.');
    }
    if (err instanceof TypeError) {
      throw new Error('Could not reach the article proxy. Check your internet connection or try again later.');
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Fetch markdown using Jina Reader via worker `mode=markdown`.
 * Falls back to Readability path if any step fails.
 */
export async function extractArticleWithJina(url: string, proxyBase: string, proxySecret?: string): Promise<Article> {
  try {
    const { body, finalUrl } = await fetchViaProxy(url, proxyBase, proxySecret, 'markdown');
    return parseArticleFromMarkdown(body, finalUrl);
  } catch {
    return extractArticle(url, proxyBase, proxySecret);
  }
}

function parseArticleFromHtml(html: string, sourceUrl: string): Article {
  const doc = new DOMParser().parseFromString(html, 'text/html');

  const htmlLang = doc.documentElement.getAttribute('lang')
    || doc.documentElement.getAttribute('xml:lang')
    || '';

  const base = doc.createElement('base');
  base.href = sourceUrl;
  doc.head.appendChild(base);

  // Strip images before Readability — this is a text reader, not an image viewer.
  doc.querySelectorAll('img').forEach((el) => el.remove());

  const parsed = new Readability(doc).parse();

  let title: string;
  let textContent: string;
  let content: string;
  let siteName: string;
  let excerpt: string;

  if (parsed) {
    title = parsed.title;
    textContent = parsed.textContent;
    content = parsed.content;
    siteName = parsed.siteName || new URL(sourceUrl).hostname;
    excerpt = parsed.excerpt;
  } else {
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

  let markdown = htmlToMarkdown(content, title, textContent);
  let paragraphs = markdownToParagraphs(markdown);

  if (paragraphs.length === 0) {
    paragraphs = splitPlainTextParagraphs(textContent);
    markdown = paragraphs.join('\n\n');
  }

  if (paragraphs.length === 0) {
    throw new Error('Article appears empty after parsing.');
  }

  const normalizedText = paragraphs.join('\n\n');
  const wordCount = countWords(normalizedText);
  const estimatedMinutes = Math.max(1, Math.round(wordCount / WORDS_PER_MINUTE));
  const lang = detectLanguage(normalizedText);

  return {
    title,
    content,
    textContent: normalizedText,
    markdown,
    paragraphs,
    lang,
    htmlLang,
    siteName,
    excerpt: excerpt || normalizedText.slice(0, 200),
    wordCount,
    estimatedMinutes,
    resolvedUrl: sourceUrl,
  };
}

function parseArticleFromMarkdown(markdown: string, sourceUrl: string): Article {
  const normalizedMarkdown = markdown.trim();
  if (!normalizedMarkdown) {
    throw new Error('Jina returned empty markdown content.');
  }

  const paragraphs = markdownToParagraphs(normalizedMarkdown);
  if (paragraphs.length === 0) {
    throw new Error('Could not extract readable paragraphs from markdown response.');
  }

  const textContent = paragraphs.join('\n\n');
  const title = extractTitleFromMarkdown(normalizedMarkdown) || new URL(sourceUrl).hostname;
  const wordCount = countWords(textContent);
  const estimatedMinutes = Math.max(1, Math.round(wordCount / WORDS_PER_MINUTE));
  const lang = detectLanguage(textContent);

  return {
    title,
    content: '',
    textContent,
    markdown: normalizedMarkdown,
    paragraphs,
    lang,
    htmlLang: '',
    siteName: new URL(sourceUrl).hostname,
    excerpt: textContent.slice(0, 200),
    wordCount,
    estimatedMinutes,
    resolvedUrl: sourceUrl,
  };
}

function htmlToMarkdown(contentHtml: string, title: string, textContent: string): string {
  const fallback = splitPlainTextParagraphs(textContent).join('\n\n');
  if (!contentHtml || typeof TurndownService === 'undefined') {
    return prependTitleHeading(fallback, title);
  }

  try {
    const turndown = new TurndownService({ headingStyle: 'atx', codeBlockStyle: 'fenced' });
    const markdown = turndown.turndown(contentHtml).trim();
    if (!markdown) return prependTitleHeading(fallback, title);
    return prependTitleHeading(markdown, title);
  } catch {
    return prependTitleHeading(fallback, title);
  }
}

function prependTitleHeading(markdown: string, title: string): string {
  const trimmed = markdown.trim();
  if (!trimmed) return title ? `# ${title}` : '';
  if (!title) return trimmed;
  if (/^#\s+/m.test(trimmed)) return trimmed;
  return `# ${title}\n\n${trimmed}`;
}

/**
 * Sanitize rendered HTML for safe display in the article view.
 * Removes scripts, images, dangerous attributes, etc.
 */
export function sanitizeRenderedHtml(html: string): string {
  const doc = new DOMParser().parseFromString(`<div>${html}</div>`, 'text/html');
  const container = doc.body.firstElementChild as HTMLElement | null;
  if (!container) return '';

  // Remove dangerous elements, form elements, and image-related elements (this is a text reader).
  container.querySelectorAll('script, style, iframe, object, embed, img, picture, source, svg, form, meta, link, base').forEach((el) => el.remove());

  // Remove links that became empty after image removal (linked images)
  // and links whose text is just an image reference (Jina Reader format).
  container.querySelectorAll('a').forEach((el) => {
    const text = el.textContent?.trim() ?? '';
    if (!text || /^Image\s*[:\d]/i.test(text)) {
      el.remove();
    }
  });

  container.querySelectorAll<HTMLElement>('*').forEach((el) => {
    const attrs = Array.from(el.attributes);
    attrs.forEach((attr) => {
      const name = attr.name.toLowerCase();
      const value = attr.value.trim();

      if (name.startsWith('on')) {
        el.removeAttribute(attr.name);
        return;
      }

      if ((name === 'href' || name === 'src') && /^\s*(javascript|data|vbscript):/i.test(value)) {
        el.removeAttribute(attr.name);
      }
    });

    if (el.tagName === 'A') {
      const href = el.getAttribute('href') ?? '';
      if (/^https?:\/\//i.test(href)) {
        el.setAttribute('target', '_blank');
        el.setAttribute('rel', 'noopener noreferrer');
      }
    }
  });

  return container.innerHTML;
}
