/**
 * PDF extraction via pdf.js (loaded lazily from CDN or local vendor).
 */

import { detectLanguage } from '../lang-detect.js';
import {
  type Article,
  MAX_PDF_SIZE,
  WORDS_PER_MINUTE,
  MIN_PARAGRAPH_LENGTH,
} from './types.js';
import {
  splitPlainTextParagraphs,
  stripNonTextContent,
  isSpeakableText,
  countWords,
} from './utils.js';

// ── pdf.js types ──────────────────────────────────────────────────────

export interface PdfJsTextItem {
  str: string;
  transform: number[];
  height: number;
}

interface PdfJsOutlineItem {
  title: string;
  dest: string | unknown[] | null;
  items?: PdfJsOutlineItem[];
}

interface PdfJsDocument {
  numPages: number;
  getPage(num: number): Promise<{
    getTextContent(): Promise<{
      items: PdfJsTextItem[];
    }>;
  }>;
  getOutline(): Promise<PdfJsOutlineItem[] | null>;
  getDestination(dest: string): Promise<unknown[] | null>;
  getPageIndex(ref: unknown): Promise<number>;
}

interface PdfJsLib {
  GlobalWorkerOptions: { workerSrc: string };
  getDocument(src: { data: ArrayBuffer }): {
    promise: Promise<PdfJsDocument>;
  };
}

// Local vendored paths (relative to the page URL root, not the module).
// These are lazy-loaded on first PDF open and cached by the service worker.
const PDF_JS_PATH = './vendor/pdfjs/pdf.min.mjs';
const PDF_JS_WORKER_PATH = './vendor/pdfjs/pdf.worker.min.mjs';

let _pdfjsLib: PdfJsLib | null = null;

/** Load pdf.js library lazily from vendored local files on first use. */
async function loadPdfJs(): Promise<PdfJsLib> {
  // Check for globally-available pdfjsLib (e.g. loaded via <script> tag or test mock)
  const global = globalThis as Record<string, unknown>;
  if (global.pdfjsLib && typeof (global.pdfjsLib as PdfJsLib).getDocument === 'function') {
    return global.pdfjsLib as PdfJsLib;
  }

  if (_pdfjsLib) return _pdfjsLib;

  try {
    // Dynamic import from local vendor path — browser resolves at runtime.
    // TypeScript cannot resolve dynamic URLs, so we use a variable to suppress static analysis.
    const url = PDF_JS_PATH;
    const module = await import(/* webpackIgnore: true */ url) as PdfJsLib;
    module.GlobalWorkerOptions.workerSrc = PDF_JS_WORKER_PATH;
    _pdfjsLib = module;
    return module;
  } catch {
    throw new Error('Could not load PDF support. The vendor file may be missing.');
  }
}

/**
 * Create an Article from a local PDF file.
 */
export async function createArticleFromPdf(
  file: File,
  onProgress?: (message: string) => void,
): Promise<Article> {
  if (file.size > MAX_PDF_SIZE) {
    throw new Error('PDF is too large (>10 MB). Please use a smaller file.');
  }

  const buffer = await file.arrayBuffer();
  const article = await parsePdfFromArrayBuffer(buffer, '', onProgress);

  // Override title with filename
  article.title = file.name.replace(/\.pdf$/i, '') || 'PDF Document';
  article.siteName = 'PDF';
  article.resolvedUrl = '';
  return article;
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
 * Parse a PDF from an ArrayBuffer (shared by both URL and local file paths).
 */
export async function parsePdfFromArrayBuffer(
  buffer: ArrayBuffer,
  sourceUrl: string,
  onProgress?: (message: string) => void,
): Promise<Article> {
  // Phase 1: Extract raw text from each page
  const pdfjsLib = await loadPdfJs();
  const pdf = await pdfjsLib.getDocument({ data: buffer }).promise;
  const { paragraphs: rawParagraphs, pageMap } = await extractPdfRawText(pdf, onProgress);

  // Phase 2: Filter and assemble speakable paragraphs
  const { paragraphs, paragraphPages } = filterPdfParagraphs(rawParagraphs, pageMap);

  // Phase 3: Insert chapter headings from PDF outline
  await insertPdfChapterHeadings(pdf, paragraphs, paragraphPages);

  // Phase 4: Build article metadata
  return buildPdfArticle(paragraphs, sourceUrl);
}

/** Phase 1: Walk PDF pages and extract raw paragraph text with page mapping. */
async function extractPdfRawText(
  pdf: PdfJsDocument,
  onProgress?: (message: string) => void,
): Promise<{ paragraphs: string[]; pageMap: number[] }> {
  onProgress?.(`Extracting text from ${pdf.numPages} pages...`);

  const paragraphs: string[] = [];
  const pageMap: number[] = [];

  for (let i = 1; i <= pdf.numPages; i++) {
    if (pdf.numPages > 10 && i % 5 === 0) {
      onProgress?.(`Extracting text... page ${i} of ${pdf.numPages}`);
    }
    const page = await pdf.getPage(i);
    const content = await page.getTextContent();
    for (const p of extractParagraphsFromTextItems(content.items)) {
      pageMap.push(i);
      paragraphs.push(p);
    }
  }

  return { paragraphs, pageMap };
}

/** Phase 2: Filter raw paragraphs to speakable text, falling back to sentence splitting. */
function filterPdfParagraphs(
  rawParagraphs: string[],
  pageMap: number[],
): { paragraphs: string[]; paragraphPages: number[] } {
  const filtered: Array<{ text: string; page: number }> = [];
  for (let i = 0; i < rawParagraphs.length; i++) {
    const stripped = stripNonTextContent(rawParagraphs[i]);
    if (stripped.length >= MIN_PARAGRAPH_LENGTH && isSpeakableText(stripped)) {
      filtered.push({ text: stripped, page: pageMap[i] });
    }
  }

  if (filtered.length <= 1) {
    const saved = filtered[0]?.text;
    const fullText = rawParagraphs.join(' ');
    const fromSentences = splitPlainTextParagraphs(fullText);
    return {
      paragraphs: fromSentences.length > 0 ? fromSentences : (saved ? [saved] : []),
      paragraphPages: [],
    };
  }

  if (filtered.length === 0) {
    throw new Error('Could not extract readable text from this PDF.');
  }

  return {
    paragraphs: filtered.map((f) => f.text),
    paragraphPages: filtered.map((f) => f.page),
  };
}

/** Phase 3: Extract PDF outline and insert chapter headings into paragraphs. */
async function insertPdfChapterHeadings(
  pdf: PdfJsDocument,
  paragraphs: string[],
  paragraphPages: number[],
): Promise<void> {
  try {
    if (paragraphPages.length > 0) {
      const chapters = await extractPdfChapters(pdf, paragraphPages);
      if (chapters.length > 0) {
        for (let i = chapters.length - 1; i >= 0; i--) {
          const ch = chapters[i];
          const prefix = '#'.repeat(Math.min(Math.max(ch.level + 1, 2), 4));
          paragraphs.splice(ch.paragraphIndex, 0, `${prefix} ${ch.title}`);
        }
      }
    }
  } catch {
    // Outline extraction failed — proceed without chapters
  }
}

/** Phase 4: Assemble the final Article from paragraphs and source URL. */
function buildPdfArticle(paragraphs: string[], sourceUrl: string): Article {
  if (paragraphs.length === 0) {
    throw new Error('Could not extract readable text from this PDF.');
  }

  let title: string;
  try {
    const urlPath = new URL(sourceUrl).pathname;
    const filename = urlPath.split('/').pop() || '';
    title = filename.replace(/\.pdf$/i, '').replace(/[-_]/g, ' ') || 'PDF Document';
  } catch {
    title = 'PDF Document';
  }

  const textContent = paragraphs.join('\n\n');
  const wordCount = countWords(textContent);

  return {
    title,
    content: '',
    textContent,
    markdown: textContent,
    paragraphs,
    lang: detectLanguage(textContent),
    htmlLang: '',
    siteName: 'PDF',
    excerpt: textContent.slice(0, 200),
    wordCount,
    estimatedMinutes: Math.max(1, Math.round(wordCount / WORDS_PER_MINUTE)),
    resolvedUrl: sourceUrl,
  };
}

/**
 * Extract chapter entries from PDF outline (bookmarks) and map them to paragraph indices.
 */
async function extractPdfChapters(
  pdf: PdfJsDocument,
  paragraphPages: number[],
): Promise<Array<{ paragraphIndex: number; title: string; level: number }>> {
  const outline = await pdf.getOutline();
  if (!outline || outline.length === 0) return [];

  const results: Array<{ paragraphIndex: number; title: string; level: number }> = [];

  async function processItems(items: PdfJsOutlineItem[], level: number): Promise<void> {
    for (const item of items) {
      if (!item.title?.trim() || !item.dest) continue;

      try {
        let destArray: unknown[] | null = null;
        if (typeof item.dest === 'string') {
          destArray = await pdf.getDestination(item.dest);
        } else if (Array.isArray(item.dest)) {
          destArray = item.dest;
        }

        if (destArray && destArray.length > 0) {
          const pageIndex = await pdf.getPageIndex(destArray[0]);
          const pageNum = pageIndex + 1; // 1-based to match paraPageMap

          // Find the first paragraph from this page or later
          const paraIdx = paragraphPages.findIndex((p) => p >= pageNum);
          if (paraIdx >= 0) {
            results.push({ paragraphIndex: paraIdx, title: item.title.trim(), level });
          }
        }
      } catch {
        // Skip this outline entry if destination resolution fails
      }

      if (item.items && item.items.length > 0) {
        await processItems(item.items, level + 1);
      }
    }
  }

  await processItems(outline, 1);
  return results;
}
