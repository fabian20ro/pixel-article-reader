import { describe, it, expect, vi } from 'vitest';
import { extractUrl, isValidArticleUrl } from '../lib/url-utils.js';
import { extractArticle } from '../lib/extractors/extract-url.js';

describe('url_utils', () => {
  describe('isValidArticleUrl', () => {
    it('accepts valid URLs', () => {
      expect(isValidArticleUrl('https://example.com')).toBe(true);
      expect(isValidArticleUrl('https://a.b')).toBe(true);
    });

    it('rejects invalid URLs', () => {
      expect(isValidArticleUrl('ftp://example.com')).toBe(false);
      expect(isValidArticleUrl('not-a-url')).toBe(false);
    });

    it('rejects URLs with no dot in hostname', () => {
      expect(isValidArticleUrl('https://localhost/path')).toBe(false);
      expect(isValidArticleUrl('http://127.0.0.1:8080')).toBe(true);
    });
  });

  describe('extractUrl', () => {
    it('extracts URL from plain text', () => {
      expect(extractUrl('https://example.com')).toBe('https://example.com');
    });

    it('extracts URL from text with trailing punctuation', () => {
      expect(extractUrl('Check this: https://example.com/path?q=1,')).toBe('https://example.com/path?q=1');
    });

    it('extracts URL from share-text pattern', () => {
      expect(extractUrl('Some title\nhttps://example.com/path')).toBe('https://example.com/path');
    });

    it('returns null for non-URLs', () => {
      expect(extractUrl('Hello world')).toBeNull();
    });

    it('returns null for empty/whitespace input', () => {
      expect(extractUrl('')).toBeNull();
      expect(extractUrl('   ')).toBeNull();
    });

    it('returns null when URL is embedded in long text (>500 char prefix)', () => {
      const prefix = 'x'.repeat(501);
      expect(extractUrl(`${prefix} https://example.com`)).toBeNull();
    });

    it('extracts URL with exactly 500-char prefix (boundary)', () => {
      const prefix = 'a'.repeat(499) + ' ';
      expect(extractUrl(prefix + 'https://example.com')).toBe('https://example.com');
    });

    it('handles share-text URLs where trailing text is in brackets', () => {
      // Trailing bracketed text after URL means URL isn't at end-of-string so returns null.
      expect(extractUrl('[Read more] https://example.com [source]')).toBeNull();
    });

    it('returns null when URL is embedded mid-text (not at end)', () => {
      expect(extractUrl('Some text https://example.com more text')).toBeNull();
    });

    it('strips trailing ellipsis from share-text URLs', () => {
      expect(extractUrl('Read this: https://example.com/path...')).toBe('https://example.com/path');
    });

    it('selects the last URL when multiple are present at end-of-text', () => {
      const text = 'First link: https://old.example.com\nThen updated: https://new.example.com';
      expect(extractUrl(text)).toBe('https://new.example.com');
    });
  });

  describe('extractArticle', () => {
    it('extracts content from a valid URL', async () => {
      const fetcher = vi.fn(async () => {
        return new Response(JSON.stringify({
          title: 'Test Title',
          content: '<h1>Test</h1>',
          textContent: 'Test Content',
          markdown: 'Test Markdown',
          paragraphs: ['Test Paragraph'],
          lang: 'en',
          htmlLang: 'en',
          siteName: 'Test Site',
          excerpt: 'Test Excerpt',
          wordCount: 10,
          estimatedMinutes: 1,
          resolvedUrl: 'https://example.com',
        }), { 
          status: 200,
          headers: { 'content-type': 'application/json' } 
        });
      });
      const article = await extractArticle('https://example.com', '', { fetcher });
      expect(article.title).toBe('Test Title');
    });
  });
});
