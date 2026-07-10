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
  });
});
