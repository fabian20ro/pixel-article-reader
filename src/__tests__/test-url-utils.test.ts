import { describe, it, expect } from 'vitest';
import { extractUrl, isValidArticleUrl } from '../lib/url-utils.js';

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
});
