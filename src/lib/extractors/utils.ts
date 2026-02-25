/**
 * Shared extraction utilities: paragraph splitting, text filtering,
 * markdown processing, and article building helpers.
 */

import { detectLanguage } from '../lang-detect.js';
import {
  type Article,
  MIN_PARAGRAPH_LENGTH,
  WORDS_PER_MINUTE,
  IMAGE_MD_RE,
  IMAGE_JINA_RE,
} from './types.js';

/** Build an Article from pre-extracted paragraphs. */
export function buildArticleFromParagraphs(
  paragraphs: string[],
  title: string,
  siteName: string,
  markdown: string,
): Article {
  const textContent = paragraphs.join('\n\n');
  const wordCount = countWords(textContent);
  const estimatedMinutes = Math.max(1, Math.round(wordCount / WORDS_PER_MINUTE));
  const lang = detectLanguage(textContent);

  return {
    title,
    content: '',
    textContent,
    markdown,
    paragraphs,
    lang,
    htmlLang: '',
    siteName,
    excerpt: textContent.slice(0, 200),
    wordCount,
    estimatedMinutes,
    resolvedUrl: '',
  };
}

/**
 * Check if text contains enough real words to be worth speaking aloud.
 * Filters out paragraphs that are mostly URLs, base64 data, or non-text artifacts.
 */
export function isSpeakableText(text: string): boolean {
  const words = text.match(/[a-zA-Z\u00C0-\u024F]{2,}/g);
  return !!words && words.length >= 3;
}

/** Strip content that shouldn't be read aloud: HTML tags, data URIs, image refs, image URLs. */
export function stripNonTextContent(text: string): string {
  return text
    .replace(/<[^>]+>/g, ' ')
    .replace(/data:[a-zA-Z0-9+.-]+\/[a-zA-Z0-9+.-]+[;,]\S*/g, '')
    .replace(IMAGE_MD_RE, '')           // image markdown ![alt](url) (handles parens in URLs)
    .replace(IMAGE_JINA_RE, '') // [Image: ...](url) Jina format
    .replace(/https?:\/\/\S+\.(?:jpg|jpeg|png|gif|webp|svg|avif|bmp|ico)(?:[?#]\S*)?(?=\s|$|\)|])/gi, '') // image URLs
    .replace(/https?:\/\/\S{80,}/g, '')
    .replace(/\[Image\s*[:\d][^\]]*\]/gi, '')            // standalone [Image: ...] references
    .replace(/\s+/g, ' ')
    .trim();
}

export function stripMarkdownSyntax(block: string): string {
  const stripped = block
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/^\s{0,3}#{1,6}\s+/gm, '')
    .replace(/^\s*>\s?/gm, '')
    .replace(/^\s*[-*+]\s+/gm, '')
    .replace(/^\s*\d+\.\s+/gm, '')
    .replace(/!\[[^\]]*\]\([^()]*(?:\([^)]*\)[^()]*)*\)/g, '')           // Remove image markdown entirely (handles parens in URLs)
    .replace(/\[Image\s*[:\d][^\]]*\]\([^()]*(?:\([^)]*\)[^()]*)*\)/gi, '') // Remove [Image: ...](url) Jina format
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/[*_~]/g, '');
  return stripNonTextContent(stripped);
}

/** Strip non-text content, then filter for minimum length and speakability. */
export function filterReadableParagraphs(texts: string[]): string[] {
  return texts
    .map((p) => stripNonTextContent(p))
    .filter((p) => p.length >= MIN_PARAGRAPH_LENGTH)
    .filter((p) => isSpeakableText(p));
}

export function markdownToParagraphs(markdown: string): string[] {
  return markdown
    .split(/\n\s*\n+/)
    .map((block) => stripMarkdownSyntax(block))
    .map((text) => text.trim())
    .filter((text) => text.length >= MIN_PARAGRAPH_LENGTH)
    .filter((text) => isSpeakableText(text));
}

export function extractTitleFromMarkdown(markdown: string): string {
  const lines = markdown.split('\n').map((line) => line.trim()).filter(Boolean);

  const h1 = lines.find((line) => /^#\s+/.test(line));
  if (h1) return h1.replace(/^#\s+/, '').trim();

  return stripMarkdownSyntax(lines[0] ?? '').slice(0, 150);
}

export function splitPlainTextParagraphs(text: string): string[] {
  const byBlank = filterReadableParagraphs(text.split(/\n\s*\n/));

  if (byBlank.length > 1) return byBlank;

  const byLine = filterReadableParagraphs(text.split(/\n/));

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

export function countWords(text: string): number {
  const cleaned = text.trim();
  if (!cleaned) return 0;
  return cleaned.split(/\s+/).length;
}
