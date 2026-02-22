import { describe, it, expect, beforeEach } from 'vitest';
import { extractUrl, isValidArticleUrl, getUrlFromParams, clearQueryParams } from '../lib/url-utils.js';

// ── isValidArticleUrl ───────────────────────────────────────────────

describe('isValidArticleUrl', () => {
  it('accepts a standard https URL', () => {
    expect(isValidArticleUrl('https://example.com/article')).toBe(true);
  });

  it('accepts http URLs', () => {
    expect(isValidArticleUrl('http://news.site.org/post/123')).toBe(true);
  });

  it('rejects URLs without a dot in hostname', () => {
    expect(isValidArticleUrl('http://localhost/article')).toBe(false);
  });

  it('rejects non-http protocols', () => {
    expect(isValidArticleUrl('ftp://files.example.com/doc')).toBe(false);
    expect(isValidArticleUrl('javascript:alert(1)')).toBe(false);
  });

  it('rejects garbage strings', () => {
    expect(isValidArticleUrl('not a url')).toBe(false);
    expect(isValidArticleUrl('')).toBe(false);
  });

  it('accepts URLs with paths, query params, and fragments', () => {
    expect(isValidArticleUrl('https://example.com/path?q=1&b=2#section')).toBe(true);
  });

  it('accepts URLs with subdomains', () => {
    expect(isValidArticleUrl('https://blog.sub.example.co.uk/post')).toBe(true);
  });
});

// ── extractUrl ──────────────────────────────────────────────────────

describe('extractUrl', () => {
  it('returns a direct URL unchanged', () => {
    expect(extractUrl('https://example.com/article')).toBe('https://example.com/article');
  });

  it('trims whitespace', () => {
    expect(extractUrl('  https://example.com/article  ')).toBe('https://example.com/article');
  });

  it('extracts a URL from surrounding text', () => {
    expect(extractUrl('Check this out: https://example.com/article — great read')).toBe(
      'https://example.com/article',
    );
  });

  it('extracts a URL from a "shared" message format', () => {
    const shared = 'Cool Article Title\nhttps://news.site.com/2024/post';
    expect(extractUrl(shared)).toBe('https://news.site.com/2024/post');
  });

  it('returns null for text with no URL', () => {
    expect(extractUrl('Just some random text without links')).toBeNull();
  });

  it('returns null for empty string', () => {
    expect(extractUrl('')).toBeNull();
  });

  it('returns null for a URL without a dot in hostname', () => {
    expect(extractUrl('http://localhost:3000/page')).toBeNull();
  });

  it('picks the first valid URL when multiple are present', () => {
    const text = 'See https://first.com/a and https://second.com/b';
    expect(extractUrl(text)).toBe('https://first.com/a');
  });
});

// ── getUrlFromParams ────────────────────────────────────────────────

describe('getUrlFromParams', () => {
  beforeEach(() => {
    // Reset URL to a clean state
    window.history.replaceState(null, '', '/');
  });

  it('extracts URL from ?url= query param', () => {
    window.history.replaceState(null, '', '/?url=https%3A%2F%2Fexample.com%2Fpost');
    expect(getUrlFromParams()).toBe('https://example.com/post');
  });

  it('extracts URL from ?text= query param', () => {
    window.history.replaceState(null, '', '/?text=https%3A%2F%2Fexample.com%2Fpost');
    expect(getUrlFromParams()).toBe('https://example.com/post');
  });

  it('prefers ?url= over ?text=', () => {
    window.history.replaceState(
      null,
      '',
      '/?url=https%3A%2F%2Ffirst.com&text=https%3A%2F%2Fsecond.com',
    );
    expect(getUrlFromParams()).toBe('https://first.com');
  });

  it('extracts URL embedded in text param', () => {
    window.history.replaceState(
      null,
      '',
      '/?text=Check%20this%20https%3A%2F%2Fexample.com%2Fpost',
    );
    expect(getUrlFromParams()).toBe('https://example.com/post');
  });

  it('returns null when no URL params are present', () => {
    window.history.replaceState(null, '', '/');
    expect(getUrlFromParams()).toBeNull();
  });

  it('returns null when params contain no valid URL', () => {
    window.history.replaceState(null, '', '/?text=just+some+text');
    expect(getUrlFromParams()).toBeNull();
  });
});

// ── clearQueryParams ────────────────────────────────────────────────

describe('clearQueryParams', () => {
  it('removes query params from the URL bar', () => {
    window.history.replaceState(null, '', '/?url=https%3A%2F%2Fexample.com');
    clearQueryParams();
    expect(window.location.search).toBe('');
    expect(window.location.pathname).toBe('/');
  });

  it('does nothing when there are no query params', () => {
    window.history.replaceState(null, '', '/');
    clearQueryParams(); // should not throw
    expect(window.location.pathname).toBe('/');
  });
});
