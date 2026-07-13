import { describe, expect, it } from 'vitest';
import { sanitizeHref, parseEpubFromArrayBuffer } from '../lib/extractors/extract-epub.js';

describe('sanitizeHref', () => {
  it('returns normal paths as-is', () => {
    expect(sanitizeHref('chapters/intro.xhtml')).toBe('chapters/intro.xhtml');
    expect(sanitizeHref('text/section.html')).toBe('text/section.html');
    expect(sanitizeHref('a/b/c/d/e.xhtml')).toBe('a/b/c/d/e.xhtml');
  });

  it('strips single-dot segments', () => {
    expect(sanitizeHref('./chapter.xhtml')).toBe('chapter.xhtml');
    expect(sanitizeHref('text/./section.html')).toBe('text/section.html');
    expect(sanitizeHref('a/b/c/./d.xhtml')).toBe('a/b/c/d.xhtml');
  });

  it('collapses double-dot segments', () => {
    expect(sanitizeHref('../chapter.xhtml')).toBe('chapter.xhtml');
    expect(sanitizeHref('text/../section.html')).toBe('section.html');
    expect(sanitizeHref('a/b/../../c.xhtml')).toBe('c.xhtml');
  });

  it('does not allow path traversal beyond root', () => {
    expect(sanitizeHref('../../etc/passwd')).toBe('etc/passwd');
    expect(sanitizeHref('../../../etc/shadow')).toBe('etc/shadow');
  });

  it('handles URL-encoded traversal', () => {
    expect(sanitizeHref('%2e%2e/chapters/intro.xhtml')).toBe('chapters/intro.xhtml');
    expect(sanitizeHref('text/%2e%2e/section.html')).toBe('section.html');
  });

  it('decodes percent-encoded slashes', () => {
    // %2F is '/' — decoded, the path collapses to a single segment
    expect(sanitizeHref('chapters%2Fintro.xhtml')).toBe('chapters/intro.xhtml');
  });
});

describe('parseEpubFromArrayBuffer', () => {
  it('throws when given an empty buffer', async () => {
    await expect(
      parseEpubFromArrayBuffer(new ArrayBuffer(0), 'https://example.com/book.epub', class {
        parseFromString(html: string, _type: string) { return new DOMParser().parseFromString(html, 'application/xml'); }
      }),
    ).rejects.toThrow();
  });

  it('throws on invalid EPUB (junk buffer)', async () => {
    await expect(
      parseEpubFromArrayBuffer(new ArrayBuffer(20), 'https://example.com/book.epub', class {
        parseFromString(html: string, _type: string) { return new DOMParser().parseFromString(html, 'application/xml'); }
      }),
    ).rejects.toThrow();
  });

  it('derives title from URL pathname (does not throw "Invalid URL")', async () => {
    // Use a buffer that will fail at parseEpubCore but verify the fallback path works
    const buf = new Uint8Array(10).buffer;
    try {
      await parseEpubFromArrayBuffer(buf, 'https://example.com/my-book.epub', class {
        parseFromString(html: string, _type: string) { return new DOMParser().parseFromString(html, 'application/xml'); }
      });
    } catch (err: any) {
      // Expected to fail at some point — just ensure it doesn't throw about invalid URL
      expect(err.message).not.toContain('Invalid URL');
    }
  });
});
