/**
 * URL fetch orchestration — detects format (HTML, PDF, EPUB) and dispatches
 * to the correct parser.  Split from extract-html.ts for maintainability.
 */

import {
  type Article,
  MAX_ARTICLE_SIZE,
  MAX_PDF_SIZE,
  PDF_FETCH_TIMEOUT,
  FETCH_TIMEOUT,
} from './types.js';
import { parsePdfFromArrayBuffer } from './extract-pdf.js';
import { parseEpubFromArrayBuffer } from './extract-epub.js';
import { parseArticleFromHtml, parseArticleFromMarkdown } from './extract-html.js';

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

/** Check if a URL likely points to an EPUB based on its path. */
function isEpubUrl(url: string): boolean {
  try {
    const pathname = new URL(url).pathname.toLowerCase();
    // Matches .epub at end AND .epub.<variant> at end (e.g. .epub.noimages, .epub.images)
    return pathname.endsWith('.epub') || /\.epub\.[^/]+$/.test(pathname);
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
 * Fetch a binary file (PDF or EPUB) via the CORS proxy.
 * Returns the response as an ArrayBuffer with size checks.
 */
async function fetchBinaryViaProxy(
  url: string,
  proxyBase: string,
  proxySecret?: string,
  onProgress?: (message: string) => void,
  label = 'file',
): Promise<{ buffer: ArrayBuffer; finalUrl: string }> {
  onProgress?.(`Downloading ${label}...`);

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
      throw new Error(`${label} is too large (>10 MB).`);
    }

    const buffer = await resp.arrayBuffer();
    if (buffer.byteLength > MAX_PDF_SIZE) {
      throw new Error(`${label} is too large (>10 MB).`);
    }

    const finalUrl = resp.headers.get('X-Final-URL') || url;
    return { buffer, finalUrl };
  } catch (err: unknown) {
    if (err instanceof DOMException && err.name === 'AbortError') {
      throw new Error(`Timed out downloading the ${label}. The file may be too large or the connection is slow.`);
    }
    if (err instanceof TypeError) {
      throw new Error('Could not reach the article proxy. Check your internet connection or try again later.');
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

/** Check first bytes to detect binary format when content-type is unreliable. */
function detectBinaryFormat(firstBytes: string): 'pdf' | 'epub' | null {
  if (firstBytes.startsWith('%PDF-')) return 'pdf';
  // ZIP local file header: PK\x03\x04 (not just PK, to avoid false matches on .docx etc.)
  if (firstBytes.length >= 4 &&
      firstBytes.charCodeAt(0) === 0x50 &&
      firstBytes.charCodeAt(1) === 0x4B &&
      firstBytes.charCodeAt(2) === 0x03 &&
      firstBytes.charCodeAt(3) === 0x04) return 'epub';
  return null;
}

/**
 * Fetch an article URL via the CORS proxy and extract readable content.
 * Automatically detects PDF/EPUB by URL extension or response content-type,
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

  // Fast path: URL clearly points to an EPUB
  if (isEpubUrl(url)) {
    return extractArticleFromEpubUrl(url, proxyBase, proxySecret, onProgress);
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

    // PDF detected by content-type
    if (ct.includes('application/pdf')) {
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

    // EPUB detected by content-type
    if (ct.includes('application/epub')) {
      const contentLength = resp.headers.get('content-length');
      if (contentLength && parseInt(contentLength, 10) > MAX_PDF_SIZE) {
        throw new Error('EPUB is too large (>10 MB).');
      }
      const buffer = await resp.arrayBuffer();
      if (buffer.byteLength > MAX_PDF_SIZE) {
        throw new Error('EPUB is too large (>10 MB).');
      }
      const finalUrl = resp.headers.get('X-Final-URL') || url;
      onProgress?.('Extracting text from EPUB...');
      return parseEpubFromArrayBuffer(buffer, finalUrl, onProgress);
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

    // Fallback: detect PDF by magic bytes when content-type was wrong.
    // Note: resp.text() + TextEncoder round-trip can corrupt bytes > 0x7F,
    // but %PDF- is pure ASCII so the header check is reliable. pdf.js is
    // tolerant of minor byte corruption in practice. EPUB is not handled here
    // because ZIP headers are binary-sensitive and would be corrupted.
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
  const { buffer, finalUrl } = await fetchBinaryViaProxy(url, proxyBase, proxySecret, onProgress, 'PDF');
  onProgress?.('Extracting text from PDF...');
  return parsePdfFromArrayBuffer(buffer, finalUrl, onProgress);
}

/**
 * Fetch an EPUB via the CORS proxy and extract readable text using JSZip.
 */
export async function extractArticleFromEpubUrl(
  url: string,
  proxyBase: string,
  proxySecret?: string,
  onProgress?: (message: string) => void,
): Promise<Article> {
  const { buffer, finalUrl } = await fetchBinaryViaProxy(url, proxyBase, proxySecret, onProgress, 'EPUB');
  onProgress?.('Extracting text from EPUB...');
  return parseEpubFromArrayBuffer(buffer, finalUrl, onProgress);
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
