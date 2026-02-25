/**
 * EPUB extraction via JSZip (loaded lazily from CDN or local vendor).
 * EPUB is a ZIP archive containing XHTML chapters, a manifest, and metadata.
 */

import { type Article, MAX_PDF_SIZE } from './types.js';
import { buildArticleFromParagraphs, filterReadableParagraphs } from './utils.js';

// ── JSZip types ───────────────────────────────────────────────────────

interface JSZipInstance {
  files: Record<string, { async(type: 'string'): Promise<string>; async(type: 'arraybuffer'): Promise<ArrayBuffer> }>;
  loadAsync(data: ArrayBuffer): Promise<JSZipInstance>;
  file(name: string): { async(type: 'string'): Promise<string> } | null;
}
interface JSZipConstructor {
  new(): JSZipInstance;
}

const JSZIP_CDN = 'https://cdn.jsdelivr.net/npm/jszip@3.10.1/dist/jszip.min.js';

let _JSZip: JSZipConstructor | null = null;

/** Load JSZip lazily from CDN. */
async function loadJSZip(): Promise<JSZipConstructor> {
  const global = globalThis as Record<string, unknown>;
  if (global.JSZip && typeof global.JSZip === 'function') {
    return global.JSZip as unknown as JSZipConstructor;
  }
  if (_JSZip) return _JSZip;

  try {
    // Load via script tag since JSZip uses UMD (not pure ESM)
    await new Promise<void>((resolve, reject) => {
      const script = document.createElement('script');
      script.src = JSZIP_CDN;
      script.integrity = 'sha384-OLBgp1GsljhM2TJ+sbHjaiH9txEUvgdDTAzHv2P24donTt6/529l+9Ua0vFImLlb';
      script.crossOrigin = 'anonymous';
      script.onload = () => resolve();
      script.onerror = () => reject(new Error('Failed to load JSZip'));
      document.head.appendChild(script);
    });

    const loaded = (globalThis as Record<string, unknown>).JSZip as unknown as JSZipConstructor;
    if (!loaded) throw new Error('JSZip not available after load');
    _JSZip = loaded;
    return loaded;
  } catch {
    throw new Error('Could not load EPUB support. Check your internet connection and try again.');
  }
}

/**
 * Create an Article from a local EPUB file.
 */
export async function createArticleFromEpub(
  file: File,
  onProgress?: (message: string) => void,
): Promise<Article> {
  if (file.size > MAX_PDF_SIZE) {
    throw new Error('EPUB is too large (>10 MB). Please use a smaller file.');
  }

  onProgress?.('Loading EPUB...');
  const JSZip = await loadJSZip();

  const buffer = await file.arrayBuffer();
  const zip = await new JSZip().loadAsync(buffer);

  // Parse container.xml to find the OPF file
  const containerXml = await readZipFile(zip, 'META-INF/container.xml');
  if (!containerXml) {
    throw new Error('Invalid EPUB: missing container.xml');
  }

  const opfPath = extractOpfPath(containerXml);
  if (!opfPath) {
    throw new Error('Invalid EPUB: cannot find content.opf path');
  }

  const opfContent = await readZipFile(zip, opfPath);
  if (!opfContent) {
    throw new Error('Invalid EPUB: cannot read content.opf');
  }

  const opfDir = opfPath.includes('/') ? opfPath.slice(0, opfPath.lastIndexOf('/') + 1) : '';
  const { title: epubTitle, chapterPaths } = parseOpf(opfContent, opfDir);

  if (chapterPaths.length === 0) {
    throw new Error('Could not find any chapters in this EPUB.');
  }

  onProgress?.(`Processing ${chapterPaths.length} chapters...`);

  // Guard against zip bombs: limit total extracted text to 50 MB
  const MAX_EXTRACTED_BYTES = 50_000_000;
  let totalExtracted = 0;

  const allParagraphs: string[] = [];
  for (let i = 0; i < chapterPaths.length; i++) {
    if (chapterPaths.length > 5 && i % 3 === 0) {
      onProgress?.(`Processing chapter ${i + 1} of ${chapterPaths.length}...`);
    }
    const html = await readZipFile(zip, chapterPaths[i]);
    if (!html) continue;

    totalExtracted += html.length;
    if (totalExtracted > MAX_EXTRACTED_BYTES) {
      throw new Error('EPUB content is too large after decompression. The file may be corrupted.');
    }

    const chapterParagraphs = extractTextFromXhtml(html);
    allParagraphs.push(...chapterParagraphs);
  }

  const paragraphs = filterReadableParagraphs(allParagraphs);

  if (paragraphs.length === 0) {
    throw new Error('Could not extract readable text from this EPUB.');
  }

  const title = epubTitle || file.name.replace(/\.epub$/i, '') || 'EPUB Document';
  return buildArticleFromParagraphs(paragraphs, title, 'EPUB', paragraphs.join('\n\n'));
}

/** Read a file from a JSZip instance, trying both exact path and case-insensitive match. */
async function readZipFile(zip: JSZipInstance, path: string): Promise<string | null> {
  const entry = zip.file(path);
  if (entry) return entry.async('string');

  // Case-insensitive fallback
  const lowerPath = path.toLowerCase();
  for (const name of Object.keys(zip.files)) {
    if (name.toLowerCase() === lowerPath) {
      return zip.files[name].async('string');
    }
  }
  return null;
}

/** Extract the OPF file path from container.xml. */
function extractOpfPath(containerXml: string): string | null {
  const match = containerXml.match(/full-path\s*=\s*"([^"]+)"/);
  return match ? match[1] : null;
}

/** Parse OPF (Open Packaging Format) to get title and ordered chapter paths. */
function parseOpf(opfXml: string, opfDir: string): { title: string; chapterPaths: string[] } {
  const doc = new DOMParser().parseFromString(opfXml, 'application/xml');

  // Extract title from <dc:title>
  const titleEl = doc.querySelector('title');
  const title = titleEl?.textContent?.trim() || '';

  // Build manifest id→{href, mediaType} map
  const manifest = new Map<string, { href: string; mediaType: string }>();
  doc.querySelectorAll('manifest > item').forEach((item) => {
    const id = item.getAttribute('id') || '';
    const href = item.getAttribute('href') || '';
    const mediaType = item.getAttribute('media-type') || '';
    if (id && href) {
      manifest.set(id, { href, mediaType });
    }
  });

  // Get spine order (reading order)
  const chapterPaths: string[] = [];
  doc.querySelectorAll('spine > itemref').forEach((ref) => {
    const idref = ref.getAttribute('idref') || '';
    const entry = manifest.get(idref);
    if (entry) {
      // Only include XHTML/HTML content documents
      if (entry.mediaType.includes('html') || entry.mediaType.includes('xml') || entry.mediaType.includes('xhtml')) {
        chapterPaths.push(opfDir + entry.href);
      }
    }
  });

  return { title, chapterPaths };
}

/** Extract readable text paragraphs from an XHTML chapter. */
function extractTextFromXhtml(html: string): string[] {
  const doc = new DOMParser().parseFromString(html, 'text/html');

  // Remove non-content elements
  doc.querySelectorAll('script, style, nav, head, meta, link').forEach((el) => el.remove());

  const paragraphs: string[] = [];

  // Extract text from block-level elements
  const blocks = doc.querySelectorAll('p, h1, h2, h3, h4, h5, h6, li, blockquote, div');
  if (blocks.length > 0) {
    blocks.forEach((block) => {
      const text = block.textContent?.trim();
      if (text && text.length > 0) {
        paragraphs.push(text);
      }
    });
  } else {
    // Fallback: get all body text
    const bodyText = doc.body?.textContent?.trim();
    if (bodyText) {
      paragraphs.push(...bodyText.split(/\n\s*\n+/).map((p) => p.trim()).filter(Boolean));
    }
  }

  return paragraphs;
}
