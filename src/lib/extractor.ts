/**
 * Article extraction: fetch HTML through CORS proxy, parse with Readability.
 * Also handles local files (PDF, TXT) and pasted text.
 */

import { detectLanguage, type Language } from './lang-detect.js';

// Readability is loaded as a global via <script> tag (vendor/Readability.js)
declare const Readability: new (doc: Document) => {
  parse(): { title: string; content: string; textContent: string; siteName: string; excerpt: string } | null;
};

// Turndown is loaded as a global via <script> tag (vendor/turndown.js)
declare const TurndownService: new (options?: Record<string, unknown>) => {
  turndown(html: string): string;
};

/** Minimal typing for pdf.js library (loaded lazily via dynamic import). */
interface PdfJsTextItem {
  str: string;
  transform: number[];
  height: number;
}

interface PdfJsLib {
  GlobalWorkerOptions: { workerSrc: string };
  getDocument(src: { data: ArrayBuffer }): {
    promise: Promise<{
      numPages: number;
      getPage(num: number): Promise<{
        getTextContent(): Promise<{
          items: PdfJsTextItem[];
        }>;
      }>;
    }>;
  };
}

const PDF_JS_CDN = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@4.9.155/build/pdf.min.mjs';
const PDF_JS_WORKER_CDN = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@4.9.155/build/pdf.worker.min.mjs';

let _pdfjsLib: PdfJsLib | null = null;

export interface Article {
  title: string;
  content: string;         // HTML from Readability
  textContent: string;     // plain text
  markdown: string;        // markdown for rendering/export
  paragraphs: string[];    // split for TTS chunking
  lang: Language;
  htmlLang: string;        // raw lang from <html lang="...">, e.g. "de" or "de-DE"
  siteName: string;
  excerpt: string;
  wordCount: number;
  estimatedMinutes: number;
  resolvedUrl: string;     // final URL after redirects (from proxy)
}

const MIN_PARAGRAPH_LENGTH = 20;
const MAX_ARTICLE_SIZE = 2_000_000; // 2 MB
const FETCH_TIMEOUT = 10_000;       // 10 s
const WORDS_PER_MINUTE = 180;       // spoken pace

/**
 * Create an Article directly from pasted plain text (no fetch needed).
 */
export function createArticleFromText(text: string): Article {
  const lines = text.split('\n');
  const firstLine = lines[0].trim();
  const hasTitle = firstLine.length > 0 && firstLine.length <= 150;
  const title = hasTitle ? firstLine : 'Pasted Article';
  const bodyText = hasTitle ? lines.slice(1).join('\n').trim() : text.trim();
  const textContent = bodyText || text.trim();

  let paragraphs = splitPlainTextParagraphs(textContent);
  if (paragraphs.length === 0) {
    throw new Error('Pasted text is too short to read as an article.');
  }

  const wordCount = countWords(textContent);
  const estimatedMinutes = Math.max(1, Math.round(wordCount / WORDS_PER_MINUTE));
  const lang = detectLanguage(textContent);

  return {
    title,
    content: '',
    textContent,
    markdown: textContent,
    paragraphs,
    lang,
    htmlLang: '',
    siteName: 'Pasted',
    excerpt: textContent.slice(0, 200),
    wordCount,
    estimatedMinutes,
    resolvedUrl: '',
  };
}

/**
 * Create an Article from a local text file (.txt, .text).
 */
export async function createArticleFromTextFile(file: File): Promise<Article> {
  if (file.size > MAX_ARTICLE_SIZE) {
    throw new Error('File is too large (>2 MB). Please use a smaller file.');
  }

  const text = await file.text();
  const textContent = text.trim();

  if (!textContent) {
    throw new Error('The text file is empty.');
  }

  const paragraphs = splitPlainTextParagraphs(textContent);
  if (paragraphs.length === 0) {
    throw new Error('The text file has no readable content.');
  }

  const title = file.name.replace(/\.(txt|text)$/i, '') || 'Text Document';
  const wordCount = countWords(textContent);
  const estimatedMinutes = Math.max(1, Math.round(wordCount / WORDS_PER_MINUTE));
  const lang = detectLanguage(textContent);

  return {
    title,
    content: '',
    textContent,
    markdown: textContent,
    paragraphs,
    lang,
    htmlLang: '',
    siteName: 'Text File',
    excerpt: textContent.slice(0, 200),
    wordCount,
    estimatedMinutes,
    resolvedUrl: '',
  };
}

/**
 * Load pdf.js library lazily from CDN on first use.
 */
async function loadPdfJs(): Promise<PdfJsLib> {
  // Check for globally-available pdfjsLib (e.g. loaded via <script> tag or test mock)
  const global = globalThis as Record<string, unknown>;
  if (global.pdfjsLib && typeof (global.pdfjsLib as PdfJsLib).getDocument === 'function') {
    return global.pdfjsLib as PdfJsLib;
  }

  if (_pdfjsLib) return _pdfjsLib;

  try {
    // Dynamic import from CDN — browser resolves the URL at runtime.
    // TypeScript cannot resolve CDN URLs, so we use a variable to suppress static analysis.
    const url = PDF_JS_CDN;
    const module = await import(/* webpackIgnore: true */ url) as PdfJsLib;
    module.GlobalWorkerOptions.workerSrc = PDF_JS_WORKER_CDN;
    _pdfjsLib = module;
    return module;
  } catch {
    throw new Error('Could not load PDF support. Check your internet connection and try again.');
  }
}

/**
 * Create an Article from a local PDF file.
 */
export async function createArticleFromPdf(file: File): Promise<Article> {
  if (file.size > MAX_ARTICLE_SIZE) {
    throw new Error('PDF is too large (>2 MB). Please use a smaller file.');
  }

  const pdfjsLib = await loadPdfJs();

  const buffer = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: buffer }).promise;

  const allParagraphs: string[] = [];

  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const content = await page.getTextContent();
    const pageParagraphs = extractParagraphsFromTextItems(content.items);
    allParagraphs.push(...pageParagraphs);
  }

  // Apply text cleaning and paragraph filtering
  let paragraphs = allParagraphs
    .map((p) => stripNonTextContent(p))
    .filter((p) => p.length >= MIN_PARAGRAPH_LENGTH)
    .filter((p) => isSpeakableText(p));

  // If structural detection yields ≤1 paragraph, try sentence-based splitting
  if (paragraphs.length <= 1) {
    const saved = paragraphs[0];
    const fullText = allParagraphs.join(' ');
    const fromSentences = splitPlainTextParagraphs(fullText);
    paragraphs = fromSentences.length > 0 ? fromSentences : (saved ? [saved] : []);
  }

  if (paragraphs.length === 0) {
    throw new Error('Could not extract readable text from this PDF.');
  }

  const title = file.name.replace(/\.pdf$/i, '') || 'PDF Document';
  const textContent = paragraphs.join('\n\n');
  const wordCount = countWords(textContent);
  const estimatedMinutes = Math.max(1, Math.round(wordCount / WORDS_PER_MINUTE));
  const lang = detectLanguage(textContent);

  return {
    title,
    content: '',
    textContent,
    markdown: textContent,
    paragraphs,
    lang,
    htmlLang: '',
    siteName: 'PDF',
    excerpt: textContent.slice(0, 200),
    wordCount,
    estimatedMinutes,
    resolvedUrl: '',
  };
}

/**
 * Detect paragraph boundaries from PDF text items using vertical position gaps.
 * PDF text items include position data: transform[5] is the Y coordinate.
 * A gap larger than 1.8x line height suggests a paragraph break.
 */
export function extractParagraphsFromTextItems(items: PdfJsTextItem[]): string[] {
  if (items.length === 0) return [];

  const paragraphs: string[] = [];
  let currentParagraph = '';
  let lastY: number | null = null;
  let lastHeight = 0;

  for (const item of items) {
    const text = item.str;
    if (!text.trim()) continue;

    const y = item.transform[5];
    const height = item.height || 12;

    if (lastY !== null) {
      const gap = Math.abs(lastY - y);
      const lineSpacing = lastHeight * 1.5;

      if (gap > lineSpacing * 1.8) {
        // Large vertical gap — paragraph break
        if (currentParagraph.trim()) {
          paragraphs.push(currentParagraph.trim());
        }
        currentParagraph = text;
      } else {
        // Same paragraph — join with space (handle hyphenation)
        if (currentParagraph.endsWith('-')) {
          currentParagraph = currentParagraph.slice(0, -1) + text;
        } else {
          currentParagraph += (currentParagraph ? ' ' : '') + text;
        }
      }
    } else {
      currentParagraph = text;
    }

    lastY = y;
    lastHeight = height;
  }

  if (currentParagraph.trim()) {
    paragraphs.push(currentParagraph.trim());
  }

  return paragraphs;
}

/**
 * Fetch an article URL via the CORS proxy and extract readable content.
 */
export async function extractArticle(url: string, proxyBase: string, proxySecret?: string): Promise<Article> {
  const { body, finalUrl } = await fetchViaProxy(url, proxyBase, proxySecret, 'html');
  return parseArticleFromHtml(body, finalUrl);
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

function markdownToParagraphs(markdown: string): string[] {
  return markdown
    .split(/\n\s*\n+/)
    .map((block) => stripMarkdownSyntax(block))
    .map((text) => text.trim())
    .filter((text) => text.length >= MIN_PARAGRAPH_LENGTH)
    .filter((text) => isSpeakableText(text));
}

/**
 * Check if text contains enough real words to be worth speaking aloud.
 * Filters out paragraphs that are mostly URLs, base64 data, or non-text artifacts.
 */
function isSpeakableText(text: string): boolean {
  const words = text.match(/[a-zA-Z\u00C0-\u024F]{2,}/g);
  return !!words && words.length >= 3;
}

function splitPlainTextParagraphs(text: string): string[] {
  const byBlank = text
    .split(/\n\s*\n/)
    .map((p) => stripNonTextContent(p))
    .filter((p) => p.length >= MIN_PARAGRAPH_LENGTH)
    .filter((p) => isSpeakableText(p));

  if (byBlank.length > 1) return byBlank;

  const byLine = text
    .split(/\n/)
    .map((p) => stripNonTextContent(p))
    .filter((p) => p.length >= MIN_PARAGRAPH_LENGTH)
    .filter((p) => isSpeakableText(p));

  if (byLine.length > 1) return byLine;

  // Fallback: split by sentences when no paragraph breaks are found
  const cleaned = stripNonTextContent(text);
  const bySentence = splitTextBySentences(cleaned);
  if (bySentence.length > 0) return bySentence;

  // Final fallback: return whatever we got from earlier splits
  if (byBlank.length > 0) return byBlank;
  if (byLine.length > 0) return byLine;
  return [];
}

/**
 * Split text into paragraphs of N sentences each.
 * Used as a fallback when text has no detectable paragraph breaks (blank lines, newlines).
 */
export function splitTextBySentences(text: string, sentencesPerParagraph = 3): string[] {
  const sentences = splitSentences(text);
  if (sentences.length <= sentencesPerParagraph) {
    const trimmed = text.trim();
    if (trimmed.length >= MIN_PARAGRAPH_LENGTH && isSpeakableText(trimmed)) {
      return [trimmed];
    }
    return [];
  }

  const paragraphs: string[] = [];
  for (let i = 0; i < sentences.length; i += sentencesPerParagraph) {
    const chunk = sentences.slice(i, i + sentencesPerParagraph);
    const para = chunk.join(' ').trim();
    if (para.length >= MIN_PARAGRAPH_LENGTH && isSpeakableText(para)) {
      paragraphs.push(para);
    }
  }
  return paragraphs;
}

/** Common abbreviations that should not be treated as sentence endings. */
const ABBREVIATIONS = new Set([
  'mr', 'mrs', 'ms', 'dr', 'prof', 'sr', 'jr', 'st', 'ave', 'blvd',
  'gen', 'gov', 'sgt', 'cpl', 'pvt', 'capt', 'lt', 'col', 'maj',
  'dept', 'univ', 'assn', 'bros', 'inc', 'ltd', 'co', 'corp',
  'vs', 'etc', 'approx', 'appt', 'est', 'min', 'max',
  'jan', 'feb', 'mar', 'apr', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec',
]);

/**
 * Split text into individual sentences.
 * Handles abbreviations, decimal numbers, and ellipses.
 */
function splitSentences(text: string): string[] {
  const sentences: string[] = [];
  // Match sentence-ending punctuation followed by space and uppercase letter
  const parts = text.split(/(?<=[.!?])\s+/);
  let current = '';

  for (const part of parts) {
    if (!current) {
      current = part;
      continue;
    }

    // Check if the previous part ended with an abbreviation
    const lastWord = current.match(/(\w+)\.$/);
    if (lastWord && ABBREVIATIONS.has(lastWord[1].toLowerCase())) {
      // Abbreviation — don't split
      current += ' ' + part;
      continue;
    }

    // Check if it ended with a decimal number (e.g., "3.14" split as "3." + "14...")
    if (/\d\.$/.test(current) && /^\d/.test(part)) {
      current += ' ' + part;
      continue;
    }

    // Check if the next part starts with uppercase (real sentence boundary)
    if (/^[A-Z\u00C0-\u024F]/.test(part)) {
      sentences.push(current.trim());
      current = part;
    } else {
      // Doesn't start with uppercase — likely not a real sentence boundary
      current += ' ' + part;
    }
  }

  if (current.trim()) {
    sentences.push(current.trim());
  }

  return sentences.filter((s) => s.length > 0);
}

/** Strip content that shouldn't be read aloud: HTML tags, data URIs, image refs, image URLs. */
function stripNonTextContent(text: string): string {
  return text
    .replace(/<[^>]+>/g, ' ')
    .replace(/data:[a-zA-Z0-9+.-]+\/[a-zA-Z0-9+.-]+[;,]\S*/g, '')
    .replace(/!\[[^\]]*\]\((?:[^()]+|\([^()]*\))*\)/g, '')           // image markdown ![alt](url) (handles parens in URLs)
    .replace(/\[Image\s*[:\d][^\]]*\]\((?:[^()]+|\([^()]*\))*\)/gi, '') // [Image: ...](url) Jina format
    .replace(/https?:\/\/\S+\.(?:jpg|jpeg|png|gif|webp|svg|avif|bmp|ico)(?:[?#]\S*)?(?=\s|$|\)|])/gi, '') // image URLs
    .replace(/https?:\/\/\S{80,}/g, '')
    .replace(/\[Image\s*[:\d][^\]]*\]/gi, '')            // standalone [Image: ...] references
    .replace(/\s+/g, ' ')
    .trim();
}

function stripMarkdownSyntax(block: string): string {
  const stripped = block
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/^\s{0,3}#{1,6}\s+/gm, '')
    .replace(/^\s*>\s?/gm, '')
    .replace(/^\s*[-*+]\s+/gm, '')
    .replace(/^\s*\d+\.\s+/gm, '')
    .replace(/!\[[^\]]*\]\((?:[^()]+|\([^()]*\))*\)/g, '')           // Remove image markdown entirely (handles parens in URLs)
    .replace(/\[Image\s*[:\d][^\]]*\]\((?:[^()]+|\([^()]*\))*\)/gi, '') // Remove [Image: ...](url) Jina format
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/[*_~]/g, '');
  return stripNonTextContent(stripped);
}

function extractTitleFromMarkdown(markdown: string): string {
  const lines = markdown.split('\n').map((line) => line.trim()).filter(Boolean);

  const h1 = lines.find((line) => /^#\s+/.test(line));
  if (h1) return h1.replace(/^#\s+/, '').trim();

  return stripMarkdownSyntax(lines[0] ?? '').slice(0, 150);
}

function countWords(text: string): number {
  const cleaned = text.trim();
  if (!cleaned) return 0;
  return cleaned.split(/\s+/).length;
}
