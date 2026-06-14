import { type Article, MAX_PDF_SIZE } from './types.js';
import { buildArticleFromParagraphs } from './utils.js';

export interface PdfJsTextItem {
  str: string;
  transform: number[];
  height?: number;
}

/** Detect paragraph boundaries from PDF text items using vertical position gaps. */
export function extractParagraphsFromTextItems(items: PdfJsTextItem[]): string[] {
  if (items.length === 0) return [];

  const paragraphs: string[] = [];
  let currentParagraph = '';
  let lastY: number | null = null;
  let lastHeight = 0;

  for (const item of items) {
    const text = item.str.trim();
    if (!text) continue;

    const y = item.transform[5];
    const height = item.height || 12;

    if (lastY !== null) {
      const gap = Math.abs(lastY - y);
      const lineSpacing = lastHeight * 1.5;

      if (gap > lineSpacing * 1.5) {
        if (currentParagraph.trim()) {
          paragraphs.push(currentParagraph.trim());
        }
        currentParagraph = text;
      } else {
        if (currentParagraph.endsWith('-')) {
          currentParagraph = currentParagraph.slice(0, -1) + text;
        } else if (currentParagraph.endsWith('- ')) {
          currentParagraph = currentParagraph.slice(0, -2) + text;
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

/** Create an Article from a local PDF file. */
export async function createArticleFromPdf(
  file: File | { name: string; size: number; arrayBuffer(): Promise<ArrayBuffer> },
  onProgress?: (message: string) => void,
): Promise<Article> {
  if (file.size > MAX_PDF_SIZE) {
    throw new Error('PDF is too large (>10 MB). Please use a smaller file.');
  }

  const buffer = await file.arrayBuffer();
  return parsePdfFromArrayBuffer(buffer, file.name, onProgress);
}

/** Parse a PDF buffer into an Article. */
export async function parsePdfFromArrayBuffer(
  buffer: ArrayBuffer,
  url: string,
  onProgress?: (message: string) => void,
): Promise<Article> {
  onProgress?.('Processing PDF...');
  // Stub implementation
  return buildArticleFromParagraphs(['PDF content stub'], 'PDF Document', 'PDF', '');
}
