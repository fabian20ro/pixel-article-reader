/**
 * URL fetch orchestration — detects format (HTML, PDF, EPUB, YouTube) and
 * dispatches to the correct parser.
 */

import {
  type Article,
  MAX_ARTICLE_SIZE,
  MAX_PDF_SIZE,
  PDF_FETCH_TIMEOUT,
} from './types.js';
import { parsePdfFromArrayBuffer } from './extract-pdf.js';
import { parseEpubFromArrayBuffer } from './extract-epub.js';
import { parseArticleFromHtml } from './extract-html.js';

export interface ExtractArticleOptions {
  domParserCtor?: new () => { parseFromString(html: string, type: string): Document };
  onProgress?: (message: string) => void;
  fetcher?: typeof fetch;
}

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

/** Check if a URL is a YouTube URL. */
function isYoutubeUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    if (parsed.hostname.includes('youtu.be')) {
      return parsed.pathname.length > 1;
    }
    if (!parsed.hostname.includes('youtube.com')) {
      return false;
    }
    return parsed.pathname.startsWith('/watch')
      || parsed.pathname.startsWith('/embed/')
      || parsed.pathname.startsWith('/shorts/');
  } catch {
    return false;
  }
}

function buildProxyHeaders(proxySecret?: string, extra: Record<string, string> = {}): Record<string, string> {
  return proxySecret ? { ...extra, 'X-Proxy-Key': proxySecret } : extra;
}

function buildWorkerParseUrl(proxyBase: string): string {
  return `${proxyBase.replace(/\/$/, '')}/parse`;
}

async function extractArticleViaWorkerParse(
  url: string,
  proxyBase: string,
  proxySecret?: string,
  fetcher: typeof fetch = globalThis.fetch,
): Promise<Article> {
  let resp: Response;

  try {
    resp = await fetcher(buildWorkerParseUrl(proxyBase), {
      method: 'POST',
      headers: buildProxyHeaders(proxySecret, { 'Content-Type': 'application/json' }),
      body: JSON.stringify({ url, format: 'article' }),
    });
  } catch (err: unknown) {
    if (err instanceof TypeError) {
      throw new Error('Could not reach the article proxy. Check your internet connection or try again later.');
    }
    throw err;
  }

  if (!resp.ok) {
    await handleProxyError(resp);
  }

  return await resp.json() as Article;
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

/**
 * Fetch an article URL and extract readable content.
 * Supports both CORS proxy path (browser) and direct path (worker/AI).
 */
export async function extractArticle(
  url: string,
  proxyBase: string,
  proxySecret?: string,
  options: ExtractArticleOptions = {},
): Promise<Article> {
  const {
    domParserCtor: DOMParserConstructor = globalThis.DOMParser,
    onProgress,
    fetcher = globalThis.fetch,
  } = options;
  const useProxy = proxyBase !== '';

  // YouTube path
  if (isYoutubeUrl(url)) {
    onProgress?.('Fetching YouTube transcript...');
    if (!useProxy) {
      throw new Error('Direct YouTube extraction is only supported through the worker parse API.');
    }
    return extractArticleViaWorkerParse(url, proxyBase, proxySecret, fetcher);
  }

  // Fast path: URL clearly ends in .pdf
  if (isPdfUrl(url)) {
    return useProxy 
      ? extractArticleFromPdfUrl(url, proxyBase, proxySecret, onProgress)
      : extractArticleFromPdfDirect(url, onProgress, fetcher);
  }

  // Fast path: URL clearly points to an EPUB
  if (isEpubUrl(url)) {
    return useProxy
      ? extractArticleFromEpubUrl(url, proxyBase, proxySecret, DOMParserConstructor, onProgress)
      : extractArticleFromEpubDirect(url, DOMParserConstructor, onProgress, fetcher);
  }

  onProgress?.('Fetching content...');

  const fetchUrl = useProxy ? `${proxyBase}?url=${encodeURIComponent(url)}` : url;
  const headers = useProxy ? buildProxyHeaders(proxySecret) : {};

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PDF_FETCH_TIMEOUT);

  try {
    const resp = await fetcher(fetchUrl, { signal: controller.signal, headers, redirect: 'follow' });
    if (!resp.ok) {
      if (useProxy) await handleProxyError(resp);
      throw new Error(`Server returned ${resp.status}: ${resp.statusText}`);
    }

    const ct = resp.headers.get('content-type') || '';

    // PDF detected by content-type
    if (ct.includes('application/pdf')) {
      const buffer = await resp.arrayBuffer();
      if (buffer.byteLength > MAX_PDF_SIZE) throw new Error('PDF is too large (>10 MB).');
      const finalUrl = resp.headers.get('X-Final-URL') || resp.url || url;
      onProgress?.('Extracting text from PDF...');
      return parsePdfFromArrayBuffer(buffer, finalUrl, onProgress);
    }

    // EPUB detected by content-type
    if (ct.includes('application/epub')) {
      const buffer = await resp.arrayBuffer();
      if (buffer.byteLength > MAX_PDF_SIZE) throw new Error('EPUB is too large (>10 MB).');
      const finalUrl = resp.headers.get('X-Final-URL') || resp.url || url;
      onProgress?.('Extracting text from EPUB...');
      return parseEpubFromArrayBuffer(buffer, finalUrl, DOMParserConstructor, onProgress);
    }

    // HTML path
    const body = await resp.text();
    if (body.length > MAX_ARTICLE_SIZE) throw new Error('Article is too large (>2 MB).');

    // Fallback: detect PDF by magic bytes
    if (body.startsWith('%PDF-')) {
      onProgress?.('Extracting text from PDF...');
      return parsePdfFromArrayBuffer(new TextEncoder().encode(body).buffer as ArrayBuffer, resp.url || url, onProgress);
    }

    const finalUrl = resp.headers.get('X-Final-URL') || resp.url || url;
    return parseArticleFromHtml(body, finalUrl, DOMParserConstructor);
  } catch (err: unknown) {
    if (err instanceof DOMException && err.name === 'AbortError') {
      throw new Error('Timed out fetching the content. Try again later.');
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

/** Fetch PDF directly (no proxy). */
async function extractArticleFromPdfDirect(url: string, onProgress?: (message: string) => void, fetcher: typeof fetch = globalThis.fetch): Promise<Article> {
  const resp = await fetcher(url, { redirect: 'follow' });
  if (!resp.ok) throw new Error(`PDF fetch failed: ${resp.status}`);
  const buffer = await resp.arrayBuffer();
  return parsePdfFromArrayBuffer(buffer, resp.url || url, onProgress);
}

/** Fetch EPUB directly (no proxy). */
async function extractArticleFromEpubDirect(url: string, DOMParserConstructor: new () => { parseFromString(html: string, type: string): Document }, onProgress?: (message: string) => void, fetcher: typeof fetch = globalThis.fetch): Promise<Article> {
  const resp = await fetcher(url, { redirect: 'follow' });
  if (!resp.ok) throw new Error(`EPUB fetch failed: ${resp.status}`);
  const buffer = await resp.arrayBuffer();
  return parseEpubFromArrayBuffer(buffer, resp.url || url, DOMParserConstructor, onProgress);
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
  DOMParserConstructor: new () => { parseFromString(html: string, type: string): Document } = globalThis.DOMParser,
  onProgress?: (message: string) => void,
): Promise<Article> {
  const { buffer, finalUrl } = await fetchBinaryViaProxy(url, proxyBase, proxySecret, onProgress, 'EPUB');
  onProgress?.('Extracting text from EPUB...');
  return parseEpubFromArrayBuffer(buffer, finalUrl, DOMParserConstructor, onProgress);
}
