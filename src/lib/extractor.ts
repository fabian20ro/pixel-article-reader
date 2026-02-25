/**
 * Article extraction — barrel file.
 *
 * Re-exports all public APIs from the per-format extraction modules.
 * Consumers import from './extractor.js' and never need to know about the
 * internal module split.
 */

// Types & shared constants
export type { Article } from './extractors/types.js';
export { IMAGE_MD_RE, IMAGE_JINA_RE, IMAGE_HTML_RE } from './extractors/types.js';

// Shared utilities (re-exported for test access)
export { splitTextBySentences } from './extractors/utils.js';

// HTML / URL extraction
export {
  extractArticle,
  extractArticleWithJina,
  extractArticleFromPdfUrl,
  sanitizeRenderedHtml,
} from './extractors/extract-html.js';

// PDF
export {
  createArticleFromPdf,
  extractParagraphsFromTextItems,
} from './extractors/extract-pdf.js';

// EPUB
export { createArticleFromEpub } from './extractors/extract-epub.js';

// Plain text & Markdown files
export {
  createArticleFromText,
  createArticleFromTextFile,
  createArticleFromMarkdownFile,
} from './extractors/extract-text.js';
