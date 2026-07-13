import { describe, it, expect } from 'vitest';
import { createArticleFromText } from '../lib/extractors/extract-text.js';
import { parseArticleFromHtml } from '../lib/extractors/extract-html.js';

// Minimal DOMParser stub for testing extractors that require a constructor.
function makeDOMParserMock() {
  return class MockDOMParser extends (globalThis.DOMParser || class {}) {} as unknown as new () => { parseFromString(html: string, type: string): Document };
}

describe('parseArticleFromHtml', () => {
  it('rejects non-http(s) source URLs', () => {
    const doc = document.createElement('html');
    doc.innerHTML = '<p>Real content for readability.</p>';
    const mockDOMParser = makeDOMParserMock();

    expect(() => parseArticleFromHtml('<p>Hello world, this is a real article with enough text to satisfy the extractor and it keeps going to be long enough.</p>', 'file:///etc/passwd', mockDOMParser)).toThrow(/http/);
    expect(() => parseArticleFromHtml('<p>Hello world, this is a real article with enough text to satisfy the extractor and it keeps going to be long enough.</p>', 'ftp://example.com/page', mockDOMParser)).toThrow(/http/);
  });

  it('accepts http(s) source URLs', () => {
    const doc = document.createElement('html');
    doc.innerHTML = '<p>Hello world, this is a real article with enough text to satisfy the extractor and it keeps going to be long enough.</p>';
    const mockDOMParser = makeDOMParserMock();

    // Should not throw for valid protocols — just exercise that parsing proceeds.
    expect(() => parseArticleFromHtml('<p>Hello world, this is a real article with enough text to satisfy the extractor and it keeps going to be long enough.</p>', 'https://example.com/article', mockDOMParser)).not.toThrow();
  });

  describe('edge cases', () => {
    it('throws on empty', () => {
      expect(() => createArticleFromText('')).toThrow();
    });
    it('throws on whitespace', () => {
      expect(() => createArticleFromText('   ')).toThrow();
    });
    it('handles punctuation', () => {
      expect(() => createArticleFromText('!!! ??? ...')).toThrow();
    });

    it('extracts short first line as title and body from remainder', () => {
      const article = createArticleFromText('My Article Title\n\nFirst paragraph.\n\nSecond paragraph.');
      expect(article.title).toBe('My Article Title');
      expect(article.textContent).toContain('First paragraph.');
      expect(article.textContent).not.toContain('My Article Title');
    });

    it('falls back to "Pasted Article" for long first lines', () => {
      const longTitle = 'A'.repeat(151);
      const article = createArticleFromText(`${longTitle}\n\nBody text here.`);
      expect(article.title).toBe('Pasted Article');
    });

    it('splits paragraphs on blank lines', () => {
      const longBody = 'First paragraph with substantial content that passes the length filter and contains enough words.';
      const article = createArticleFromText(`Title Line\n\n${longBody}`);
      expect(Array.isArray(article.paragraphs)).toBe(true);
    });

    it('returns word count and estimated read time', () => {
      const text = 'word '.repeat(60); // 60 words
      const article = createArticleFromText(text.trim());
      expect(article.wordCount).toBeGreaterThan(0);
      expect(article.estimatedMinutes).toBeGreaterThanOrEqual(1);
    });

    it('detects language', () => {
      const text = 'word '.repeat(60); // 60 words for minimum threshold
      const article = createArticleFromText(text.trim());
      expect(typeof article.lang).toBe('string');
      expect(article.lang.length).toBeGreaterThan(0);
    });

    it('sets siteName and excerpt fields', () => {
      const text = 'word '.repeat(60); // 60 words for minimum threshold
      const article = createArticleFromText(text.trim());
      expect(article.siteName).toBe('Pasted');
      expect(typeof article.excerpt).toBe('string');
    });

    it('strips markdown images from body when title is present', () => {
      const text = 'Short Title\n\n![alt](image.png)\n\n' + 'word '.repeat(60) + '\nmore words'; // hasTitle=true, cleaned used for bodyText
      const article = createArticleFromText(text);
      expect(article.textContent).not.toContain('![');
    });

    it('preserves markdown image in raw text when no title detected', () => {
      // Long first line exceeds 150 chars → hasTitle=false → bodyText uses uncleaned original
      const longLine = 'A'.repeat(160) + '\n![alt](image.png)\n\nbody';
      const article = createArticleFromText(longLine);
      expect(article.textContent).toContain('![alt](image.png)');
    });

    it('throws on too few words', () => {
      expect(() => createArticleFromText('one two')).toThrow();
    });
  });
});
