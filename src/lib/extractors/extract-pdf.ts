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
          currentParagraph = currentParagraph.slice(0, -1).trimEnd() + ' ' + text;
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
  onProgress?.('Loading PDF...');
  
  // Load pdfjs-dist via dynamic import to keep bundle small
  const pdfjs = (await import('pdfjs-dist/legacy/build/pdf.mjs')) as any;
  
  // In a real environment, the worker would be hosted. 
  // For local/service worker, we use an empty string or the same url.
  pdfjs.GlobalWorkerOptions.workerSrc = '';

  const loadingTask = pdfjs.getDocument({
    data: buffer,
    // Avoid issues with some PDF versions by specifying version if needed
    // but usually it's auto-detected.
  });

  const pdf = await loadingTask.promise;
  const numPages = pdf.numPages;
  const allParagraphs: string[] = [];

  for (let i = 1; i <= numPages; i++) {
    onProgress?.(`Parsing page ${i}/${numPages}...`);
    const page = await pdf.getPage(i);
    const textContent = await page.getTextContent();
    const paragraphs = extractParagraphsFromTextItems(textContent.items);
    allParagraphs.push(...paragraphs);
  }

  // Clean up paragraphs (remove empty ones)
  const cleanParagraphs = allParagraphs.filter(p => p.trim().length > 0);

  if (cleanParagraphs.length === 0) {
    throw new Error('Could not extract text from PDF');
  }

  // Fallback for single paragraph that might be too short OR a single long block
  let finalParagraphs = cleanParagraphs;
  if (cleanParagraphs.length === 1) {
    if (cleanParagraphs[0].trim().length < 5) {
      throw new Error('PDF content too short to be meaningful');
    } else {
      // Fallback: split single long block into sentences to improve readability
      finalParagraphs = cleanParagraphs[0]
        .split(/\. (?=[A-Z])/)
        .filter((s) => s.trim().length > 0);
    }
  }

  const title = url.replace(/\.[^/.]+$/, "");
  return buildArticleFromParagraphs(finalParagraphs, title, 'PDF', finalParagraphs.join('\n\n'));
}
