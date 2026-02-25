/**
 * Shared types and constants for article extraction.
 */

import type { Language } from '../language-config.js';

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

export const MIN_PARAGRAPH_LENGTH = 20;
export const MAX_ARTICLE_SIZE = 2_000_000;     // 2 MB (HTML articles)
export const MAX_PDF_SIZE = 10_000_000;        // 10 MB (PDF documents)
export const FETCH_TIMEOUT = 10_000;           // 10 s
export const PDF_FETCH_TIMEOUT = 30_000;       // 30 s (PDFs are larger)
export const WORDS_PER_MINUTE = 180;           // spoken pace

/** Shared image-stripping regex patterns for markdown content. */
export const IMAGE_MD_RE = /!\[[^\]]*\]\([^()]*(?:\([^)]*\)[^()]*)*\)/g;
export const IMAGE_JINA_RE = /\[Image\s*[:\d][^\]]*\]\([^()]*(?:\([^)]*\)[^()]*)*\)/gi;
export const IMAGE_HTML_RE = /<img[^>]*\/?>/gi;
