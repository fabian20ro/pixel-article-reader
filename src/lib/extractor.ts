/**
 * Article extraction: fetch HTML through CORS proxy, parse with Readability.
 */

import { detectLanguage, type Language } from './lang-detect.js';

// Readability is loaded as a global via <script> tag (vendor/Readability.js)
declare const Readability: new (doc: Document) => {
  parse(): { title: string; content: string; textContent: string; siteName: string; excerpt: string } | null;
};

export interface Article {
  title: string;
  content: string;         // HTML from Readability
  textContent: string;     // plain text
  paragraphs: string[];    // split for TTS chunking
  lang: Language;
  siteName: string;
  excerpt: string;
  wordCount: number;
  estimatedMinutes: number;
}

const MIN_PARAGRAPH_LENGTH = 20;
const MAX_ARTICLE_SIZE = 2_000_000; // 2 MB
const FETCH_TIMEOUT = 10_000;       // 10 s
const WORDS_PER_MINUTE = 180;       // spoken pace

/**
 * Fetch an article URL via the CORS proxy and extract readable content.
 */
export async function extractArticle(url: string, proxyBase: string): Promise<Article> {
  const html = await fetchViaProxy(url, proxyBase);
  return parseArticle(html, url);
}

async function fetchViaProxy(url: string, proxyBase: string): Promise<string> {
  const proxyUrl = `${proxyBase}?url=${encodeURIComponent(url)}`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT);

  try {
    const resp = await fetch(proxyUrl, { signal: controller.signal });
    if (!resp.ok) {
      throw new Error(`Proxy returned ${resp.status}: ${resp.statusText}`);
    }

    const contentLength = resp.headers.get('content-length');
    if (contentLength && parseInt(contentLength, 10) > MAX_ARTICLE_SIZE) {
      throw new Error('Article is too large (>2 MB).');
    }

    return await resp.text();
  } catch (err: unknown) {
    if (err instanceof DOMException && err.name === 'AbortError') {
      throw new Error('Timed out fetching the article. Try again later.');
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

function parseArticle(html: string, sourceUrl: string): Article {
  const doc = new DOMParser().parseFromString(html, 'text/html');

  // Fix relative URLs so Readability can resolve them
  const base = doc.createElement('base');
  base.href = sourceUrl;
  doc.head.appendChild(base);

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
    throw new Error('Could not extract article content. Try pasting the article text directly.');
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
