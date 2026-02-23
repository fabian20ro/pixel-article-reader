/**
 * Article extraction: fetch HTML through CORS proxy, parse with Readability.
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

  if (byBlank.length > 0) return byBlank;

  return text
    .split(/\n/)
    .map((p) => stripNonTextContent(p))
    .filter((p) => p.length >= MIN_PARAGRAPH_LENGTH)
    .filter((p) => isSpeakableText(p));
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
