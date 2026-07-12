import { describe, expect, it } from 'vitest';
import { sanitizeHref } from '../lib/extractors/extract-epub.js';

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
});
