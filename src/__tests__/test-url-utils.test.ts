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
