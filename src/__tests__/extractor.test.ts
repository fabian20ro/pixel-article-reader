import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  extractArticle,
  extractArticleWithJina,
  createArticleFromText,
  createArticleFromTextFile,
  createArticleFromPdf,
  splitTextBySentences,
  extractParagraphsFromTextItems,
} from '../lib/extractor.js';

// ── Mock Readability globally ─────────────────────────────────────

const mockParse = vi.fn();

beforeEach(() => {
  (globalThis as Record<string, unknown>).Readability = class {
    constructor(_doc: Document) {}
    parse = mockParse;
  };
  (globalThis as Record<string, unknown>).TurndownService = class {
    constructor(_options?: object) {}
    turndown(html: string): string {
      const doc = new DOMParser().parseFromString(html, 'text/html');
      doc.querySelectorAll('script, style, iframe, object, embed').forEach((node) => node.remove());
      return (doc.body?.textContent ?? '').replace(/\s+/g, ' ').trim();
    }
  };
});

afterEach(() => {
  vi.restoreAllMocks();
  delete (globalThis as Record<string, unknown>).Readability;
  delete (globalThis as Record<string, unknown>).TurndownService;
});

// ── Helpers ─────────────────────────────────────────────────────────

function mockFetch(html: string, status = 200, headers: Record<string, string> = {}) {
  const resp = {
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 200 ? 'OK' : 'Error',
    text: () => Promise.resolve(html),
    headers: {
      get: (name: string) => headers[name.toLowerCase()] ?? null,
    },
  };
  vi.spyOn(globalThis, 'fetch').mockResolvedValue(resp as unknown as Response);
}

const PROXY = 'https://proxy.example.workers.dev';
const ARTICLE_URL = 'https://news.example.com/2024/great-article';

const SAMPLE_HTML = `
<!DOCTYPE html>
<html>
<head><title>Test Article</title></head>
<body>
  <article>
    <h1>Test Article Title</h1>
    <p>This is the first paragraph of the article. It contains enough text to pass the minimum length filter.</p>
    <p>This is the second paragraph with additional content. It also has enough text to be considered a real paragraph.</p>
  </article>
</body>
</html>`;

// ── Tests ───────────────────────────────────────────────────────────

describe('extractArticle', () => {
  it('fetches through the proxy with the encoded URL', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      status: 200,
      statusText: 'OK',
      text: () => Promise.resolve(SAMPLE_HTML),
      headers: { get: () => null },
    } as unknown as Response);

    mockParse.mockReturnValue({
      title: 'Test Article Title',
      content: '<p>paragraph</p>',
      textContent: 'This is a full paragraph of text that is long enough to pass the filter.\n\nThis is a second paragraph of text that is also long enough.',
      siteName: 'Example News',
      excerpt: 'This is a full paragraph...',
    });

    await extractArticle(ARTICLE_URL, PROXY);

    expect(fetchSpy).toHaveBeenCalledWith(
      `${PROXY}?url=${encodeURIComponent(ARTICLE_URL)}`,
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
  });

  it('uses X-Final-URL header as resolvedUrl when proxy returns it', async () => {
    const REDIRECTED_URL = 'https://web.de/magazine/politik/article-title-123';
    mockFetch(SAMPLE_HTML, 200, { 'x-final-url': REDIRECTED_URL });
    mockParse.mockReturnValue({
      title: 'Redirected Article',
      content: '<p>Content</p>',
      textContent: 'This is a full paragraph of text that is long enough to pass the filter.\n\nThis is a second paragraph of text that is also long enough.',
      siteName: 'WEB.DE',
      excerpt: 'This is a full paragraph...',
    });

    const article = await extractArticle('https://share.google/abc123', PROXY);

    expect(article.resolvedUrl).toBe(REDIRECTED_URL);
    expect(article.siteName).toBe('WEB.DE');
  });

  it('falls back to original URL when X-Final-URL header is absent', async () => {
    mockFetch(SAMPLE_HTML);
    mockParse.mockReturnValue({
      title: 'Test Article Title',
      content: '<p>Content here</p>',
      textContent: 'This is the first paragraph of the article. It contains enough text.\n\nThis is the second paragraph with additional content that is also long enough.',
      siteName: 'Example News',
      excerpt: 'This is the first paragraph...',
    });

    const article = await extractArticle(ARTICLE_URL, PROXY);

    expect(article.resolvedUrl).toBe(ARTICLE_URL);
  });

  it('returns a well-formed Article object on success', async () => {
    mockFetch(SAMPLE_HTML);
    mockParse.mockReturnValue({
      title: 'Test Article Title',
      content: '<p>Content here</p>',
      textContent:
        'This is the first paragraph of the article. It contains enough text.\n\nThis is the second paragraph with additional content that is also long enough.',
      siteName: 'Example News',
      excerpt: 'This is the first paragraph...',
    });

    const article = await extractArticle(ARTICLE_URL, PROXY);

    expect(article.title).toBe('Test Article Title');
    expect(article.siteName).toBe('Example News');
    expect(article.paragraphs.length).toBe(2);
    expect(article.lang).toBe('en');
    expect(article.wordCount).toBeGreaterThan(0);
    expect(article.estimatedMinutes).toBeGreaterThanOrEqual(1);
  });

  it('produces markdown content from extracted HTML', async () => {
    mockFetch(SAMPLE_HTML);
    mockParse.mockReturnValue({
      title: 'Markdown Title',
      content: '<h2>Section</h2><p>Paragraph with <strong>bold</strong> text.</p>',
      textContent: 'Section\\n\\nParagraph with bold text.',
      siteName: 'Example',
      excerpt: 'Section...',
    });

    const article = await extractArticle(ARTICLE_URL, PROXY);

    expect(article.markdown.length).toBeGreaterThan(0);
    expect(article.markdown).toContain('Markdown Title');
  });

  it('falls back to <p> extraction when Readability returns null', async () => {
    const html = `<html><head><title>Fallback Page</title></head><body>
      <p>This paragraph is long enough to be captured by the fallback logic in the extractor.</p>
      <p>Another paragraph that also meets the minimum length requirement for extraction.</p>
    </body></html>`;

    mockFetch(html);
    mockParse.mockReturnValue(null);

    const article = await extractArticle(ARTICLE_URL, PROXY);

    expect(article.title).toBe('Fallback Page');
    expect(article.paragraphs.length).toBeGreaterThanOrEqual(1);
    expect(article.siteName).toBe('news.example.com');
  });

  it('throws when proxy returns a non-OK status', async () => {
    mockFetch('', 502, {});

    await expect(extractArticle(ARTICLE_URL, PROXY)).rejects.toThrow(/502/);
  });

  it('throws with rate limit message on 429 and includes Retry-After', async () => {
    const resp = {
      ok: false,
      status: 429,
      statusText: 'Too Many Requests',
      json: () => Promise.resolve({ error: 'Rate limit exceeded. Maximum 20 requests per minute. Try again in 45 seconds.' }),
      headers: {
        get: (name: string) => {
          if (name === 'Retry-After') return '45';
          return null;
        },
      },
    };
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(resp as unknown as Response);

    await expect(extractArticle(ARTICLE_URL, PROXY)).rejects.toThrow(/rate limit/i);
  });

  it('shows fallback rate limit message when 429 has no error body', async () => {
    const resp = {
      ok: false,
      status: 429,
      statusText: 'Too Many Requests',
      json: () => Promise.reject(new Error('no json')),
      headers: {
        get: (name: string) => {
          if (name === 'Retry-After') return '30';
          return null;
        },
      },
    };
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(resp as unknown as Response);

    await expect(extractArticle(ARTICLE_URL, PROXY)).rejects.toThrow(/30 seconds/);
  });

  it('throws when article content is empty', async () => {
    mockFetch('<html><body></body></html>');
    mockParse.mockReturnValue({
      title: 'Empty',
      content: '',
      textContent: '',
      siteName: '',
      excerpt: '',
    });

    await expect(extractArticle(ARTICLE_URL, PROXY)).rejects.toThrow(/extract/i);
  });

  it('throws when content-length exceeds 2 MB', async () => {
    mockFetch('', 200, { 'content-length': '3000000' });

    await expect(extractArticle(ARTICLE_URL, PROXY)).rejects.toThrow(/too large/i);
  });

  it('filters out short paragraphs (< 20 chars)', async () => {
    mockFetch(SAMPLE_HTML);
    mockParse.mockReturnValue({
      title: 'Title',
      content: '<p>Content</p>',
      textContent:
        'Short\n\nThis is a long enough paragraph to pass the minimum length filter easily.\n\nOk\n\nAnother paragraph with sufficient length to be included in the result set.',
      siteName: '',
      excerpt: '',
    });

    const article = await extractArticle(ARTICLE_URL, PROXY);

    // "Short" and "Ok" should be filtered out
    expect(article.paragraphs.length).toBe(2);
    expect(article.paragraphs[0]).toContain('long enough');
  });

  it('uses hostname as siteName when Readability provides none', async () => {
    mockFetch(SAMPLE_HTML);
    mockParse.mockReturnValue({
      title: 'Title',
      content: '<p>Content</p>',
      textContent: 'This paragraph has enough text to pass the minimum character filter threshold.',
      siteName: '',
      excerpt: '',
    });

    const article = await extractArticle(ARTICLE_URL, PROXY);
    expect(article.siteName).toBe('news.example.com');
  });

  it('falls back to single-newline splitting if double-newline yields nothing', async () => {
    // textContent has NO double-newlines, so the \n\s*\n split produces a single
    // long chunk. With the sentence fallback, when double-newline split yields only 1
    // paragraph, it falls through to single-newline splitting, which splits the text
    // into 2 paragraphs (one per line).
    mockFetch(SAMPLE_HTML);
    mockParse.mockReturnValue({
      title: 'Title',
      content: '',
      textContent:
        'This is a paragraph separated by single newlines only.\nAnother paragraph here with enough characters to pass.',
      siteName: '',
      excerpt: '',
    });

    const article = await extractArticle(ARTICLE_URL, PROXY);
    // Single-newline split yields 2 paragraphs
    expect(article.paragraphs.length).toBe(2);
    expect(article.paragraphs[0]).toContain('single newlines');
    expect(article.paragraphs[1]).toContain('Another paragraph');
  });

  it('calculates estimated listening time', async () => {
    // 180 words = 1 minute at spoken pace
    const words = Array(360).fill('word').join(' ');
    mockFetch(SAMPLE_HTML);
    mockParse.mockReturnValue({
      title: 'Title',
      content: '',
      textContent: words,
      siteName: '',
      excerpt: '',
    });

    const article = await extractArticle(ARTICLE_URL, PROXY);
    expect(article.estimatedMinutes).toBe(2);
  });

  it('extracts htmlLang from <html lang="de"> attribute', async () => {
    const html = `<!DOCTYPE html><html lang="de"><head><title>German</title></head><body><p>Inhalt</p></body></html>`;
    mockFetch(html);
    mockParse.mockReturnValue({
      title: 'German Article',
      content: '<p>Inhalt</p>',
      textContent: 'Dies ist ein deutscher Artikel mit genug Text um den Filter zu passieren.',
      siteName: '',
      excerpt: '',
    });

    const article = await extractArticle(ARTICLE_URL, PROXY);
    expect(article.htmlLang).toBe('de');
  });

  it('returns empty htmlLang when <html> has no lang attribute', async () => {
    mockFetch(SAMPLE_HTML);
    mockParse.mockReturnValue({
      title: 'Title',
      content: '<p>Content</p>',
      textContent: 'This paragraph has enough text to pass the minimum character filter threshold.',
      siteName: '',
      excerpt: '',
    });

    const article = await extractArticle(ARTICLE_URL, PROXY);
    expect(article.htmlLang).toBe('');
  });

  it('strips raw HTML tags from paragraphs', async () => {
    mockFetch(SAMPLE_HTML);
    mockParse.mockReturnValue({
      title: 'Title',
      content: '<p>Content</p>',
      textContent:
        'Normal paragraph with enough words to pass the filter easily.\n\n<img src="photo.jpg" alt="photo"> This has some text around the image tag.\n\nAnother normal paragraph with plenty of readable text content here.',
      siteName: '',
      excerpt: '',
    });

    const article = await extractArticle(ARTICLE_URL, PROXY);

    // No paragraph should contain raw HTML tags
    for (const p of article.paragraphs) {
      expect(p).not.toMatch(/<[^>]+>/);
    }
  });

  it('filters out paragraphs that are only data URIs', async () => {
    mockFetch(SAMPLE_HTML);
    mockParse.mockReturnValue({
      title: 'Title',
      content: '<p>Content</p>',
      textContent:
        'This is a real paragraph with enough text content to be read aloud.\n\ndata:image/png;base64,iVBORw0KGgoAAAANSUhEUg==\n\nAnother real paragraph with meaningful content for the reader.',
      siteName: '',
      excerpt: '',
    });

    const article = await extractArticle(ARTICLE_URL, PROXY);

    // Data URI paragraph should be filtered out
    expect(article.paragraphs.length).toBe(2);
    for (const p of article.paragraphs) {
      expect(p).not.toContain('data:image');
    }
  });

  it('filters out paragraphs with only image markdown and no real words', async () => {
    mockFetch(SAMPLE_HTML);
    mockParse.mockReturnValue({
      title: 'Title',
      content: '<p>Content</p>',
      textContent:
        'First paragraph with enough words to satisfy the speakable text filter.\n\n![](https://example.com/image-with-a-very-long-url-that-has-many-segments-and-parameters-to-exceed-the-eighty-character-threshold.jpg)\n\nSecond paragraph also has enough words to be considered real content.',
      siteName: '',
      excerpt: '',
    });

    const article = await extractArticle(ARTICLE_URL, PROXY);

    expect(article.paragraphs.length).toBe(2);
    expect(article.paragraphs[0]).toContain('First paragraph');
    expect(article.paragraphs[1]).toContain('Second paragraph');
  });

  it('strips [Image: ...](url) link-format references from paragraphs', async () => {
    mockFetch(SAMPLE_HTML);
    mockParse.mockReturnValue({
      title: 'Title',
      content: '<p>Content</p>',
      textContent:
        'First paragraph with enough words to satisfy the speakable text filter.\n\n[Image: original 1080x2424, displayed at 891x2000](https://cdn.example.com/photo.jpg)\n\nSecond paragraph also has enough words to be considered real content.',
      siteName: '',
      excerpt: '',
    });

    const article = await extractArticle(ARTICLE_URL, PROXY);

    expect(article.paragraphs.length).toBe(2);
    for (const p of article.paragraphs) {
      expect(p).not.toMatch(/Image/i);
    }
  });

  it('strips short image URLs with common extensions', async () => {
    mockFetch(SAMPLE_HTML);
    mockParse.mockReturnValue({
      title: 'Title',
      content: '<p>Content</p>',
      textContent:
        'First paragraph with enough words to pass the filter easily.\n\nhttps://cdn.example.com/pic.jpg Some text with enough words around it.\n\nAnother paragraph with plenty of readable text content here.',
      siteName: '',
      excerpt: '',
    });

    const article = await extractArticle(ARTICLE_URL, PROXY);

    for (const p of article.paragraphs) {
      expect(p).not.toContain('.jpg');
    }
  });

  it('strips image markdown with alt text instead of keeping alt', async () => {
    mockFetch(SAMPLE_HTML);
    mockParse.mockReturnValue({
      title: 'Title',
      content: '<p>Content</p>',
      textContent:
        'First paragraph with enough words to satisfy the speakable text filter.\n\n![A beautiful sunset over the ocean](https://example.com/sunset.jpg)\n\nSecond paragraph also has enough words to be considered real content.',
      siteName: '',
      excerpt: '',
    });

    const article = await extractArticle(ARTICLE_URL, PROXY);

    expect(article.paragraphs.length).toBe(2);
    expect(article.paragraphs[0]).toContain('First paragraph');
    expect(article.paragraphs[1]).toContain('Second paragraph');
    for (const p of article.paragraphs) {
      expect(p).not.toContain('sunset');
    }
  });

  it('preserves links whose text starts with "Image" but is not a Jina reference', async () => {
    mockFetch(SAMPLE_HTML);
    mockParse.mockReturnValue({
      title: 'Title',
      content: '<p>Content</p>',
      textContent:
        'First paragraph with enough words to satisfy the speakable text filter.\n\nFor more details see [Image processing techniques](https://example.com/guide) in the documentation.\n\nSecond paragraph also has enough words to be considered real content.',
      siteName: '',
      excerpt: '',
    });

    const article = await extractArticle(ARTICLE_URL, PROXY);

    const joined = article.paragraphs.join(' ');
    expect(joined).toContain('Image processing techniques');
  });

  it('keeps paragraphs with Romanian diacritics', async () => {
    mockFetch(SAMPLE_HTML);
    mockParse.mockReturnValue({
      title: 'Title',
      content: '<p>Content</p>',
      textContent:
        'Acesta este un paragraf în limba română cu diacritice ă î ș ț â.',
      siteName: '',
      excerpt: '',
    });

    const article = await extractArticle(ARTICLE_URL, PROXY);
    expect(article.paragraphs.length).toBe(1);
    expect(article.paragraphs[0]).toContain('română');
  });
});

describe('extractArticleWithJina', () => {
  it('fetches markdown mode from proxy', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      status: 200,
      statusText: 'OK',
      text: () => Promise.resolve(
        '# Jina Title\n\nParagraph one has enough words for extraction.\n\nParagraph two also has enough words for extraction.',
      ),
      headers: { get: (name: string) => (name === 'X-Final-URL' ? ARTICLE_URL : null) },
    } as unknown as Response);

    const article = await extractArticleWithJina(ARTICLE_URL, PROXY);

    expect(fetchSpy).toHaveBeenCalledWith(
      `${PROXY}?url=${encodeURIComponent(ARTICLE_URL)}&mode=markdown`,
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
    expect(article.title).toBe('Jina Title');
    expect(article.markdown).toContain('Paragraph one');
    expect(article.paragraphs.length).toBe(2);
  });

  it('falls back to Readability path when markdown mode fails', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    fetchSpy
      .mockResolvedValueOnce({
        ok: false,
        status: 502,
        statusText: 'Bad Gateway',
        json: () => Promise.resolve({ error: 'Jina unavailable' }),
        headers: { get: () => null },
      } as unknown as Response)
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        statusText: 'OK',
        text: () => Promise.resolve(SAMPLE_HTML),
        headers: { get: () => null },
      } as unknown as Response);

    mockParse.mockReturnValue({
      title: 'Fallback Article',
      content: '<p>Fallback paragraph content with enough text.</p>',
      textContent: 'Fallback paragraph content with enough text to pass the filter.',
      siteName: 'Fallback Site',
      excerpt: 'Fallback paragraph...',
    });

    const article = await extractArticleWithJina(ARTICLE_URL, PROXY);

    expect(article.title).toBe('Fallback Article');
    expect(article.markdown.length).toBeGreaterThan(0);
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it('filters out image-only markdown paragraphs from Jina output', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      status: 200,
      statusText: 'OK',
      text: () => Promise.resolve(
        '# Title\n\nThis is the real article text with enough words.\n\n![](https://example.com/image.jpg)\n\nAnother paragraph with enough content for TTS reading.',
      ),
      headers: { get: (name: string) => (name === 'X-Final-URL' ? ARTICLE_URL : null) },
    } as unknown as Response);

    const article = await extractArticleWithJina(ARTICLE_URL, PROXY);

    // Image-only paragraph should be filtered
    for (const p of article.paragraphs) {
      expect(p).not.toContain('example.com/image');
    }
    expect(article.paragraphs.length).toBe(2);
  });

  it('converts markdown blocks into clean TTS paragraphs', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      status: 200,
      statusText: 'OK',
      text: () => Promise.resolve(
        '# Title\n\n- **First** item with [link](https://example.com) and plenty of supporting words.\n\n> Quoted text here with enough words to remain in the paragraph list.',
      ),
      headers: { get: (name: string) => (name === 'X-Final-URL' ? ARTICLE_URL : null) },
    } as unknown as Response);

    const article = await extractArticleWithJina(ARTICLE_URL, PROXY);

    expect(article.paragraphs[0]).toContain('First item with link');
    expect(article.paragraphs[1]).toContain('Quoted text here');
  });
});

// ── createArticleFromText ───────────────────────────────────────────

describe('createArticleFromText', () => {
  it('uses first line as title if short enough', () => {
    const text = 'My Article Title\n\nFirst paragraph with enough text to pass the filter.\n\nSecond paragraph also has enough text.';
    const article = createArticleFromText(text);
    expect(article.title).toBe('My Article Title');
    expect(article.paragraphs.length).toBe(2);
  });

  it('uses generic title if first line is too long', () => {
    const longLine = 'A'.repeat(200);
    const text = `${longLine}\n\nSome paragraph with enough text to pass the minimum filter.`;
    const article = createArticleFromText(text);
    expect(article.title).toBe('Pasted Article');
  });

  it('sets resolvedUrl to empty string', () => {
    const text = 'Title\n\nThis paragraph has enough text to pass the minimum length filter.';
    const article = createArticleFromText(text);
    expect(article.resolvedUrl).toBe('');
  });

  it('sets markdown to the pasted text content', () => {
    const text = 'Title\n\nThis paragraph has enough text to pass the minimum length filter.';
    const article = createArticleFromText(text);
    expect(article.markdown).toContain('This paragraph');
  });

  it('sets siteName to Pasted', () => {
    const text = 'Title\n\nThis paragraph has enough text to pass the minimum length filter.';
    const article = createArticleFromText(text);
    expect(article.siteName).toBe('Pasted');
  });

  it('throws when text is too short', () => {
    expect(() => createArticleFromText('Short')).toThrow(/too short/i);
  });

  it('detects language from pasted text', () => {
    const roText = 'Titlu Articol\n\nAcesta este un paragraf cu suficient text în limba română cu diacritice ă î ș ț â.';
    const article = createArticleFromText(roText);
    expect(article.lang).toBe('ro');
  });

  it('falls back to single-newline splitting', () => {
    const text = 'Title\nThis is a paragraph separated by single newlines.\nAnother paragraph here with enough characters to pass the filter.';
    const article = createArticleFromText(text);
    expect(article.paragraphs.length).toBeGreaterThanOrEqual(1);
  });

  it('calculates word count and estimated minutes', () => {
    const words = Array(360).fill('word').join(' ');
    const text = `Title\n\n${words}`;
    const article = createArticleFromText(text);
    expect(article.wordCount).toBeGreaterThan(300);
    expect(article.estimatedMinutes).toBe(2);
  });

  it('sets htmlLang to empty string for pasted text', () => {
    const text = 'Title\n\nThis paragraph has enough text to pass the minimum length filter.';
    const article = createArticleFromText(text);
    expect(article.htmlLang).toBe('');
  });
});

// ── splitTextBySentences ──────────────────────────────────────────────

describe('splitTextBySentences', () => {
  it('splits text without paragraph breaks into 3-sentence paragraphs', () => {
    const text = 'First sentence is here. Second sentence follows along. Third sentence ends now. Fourth sentence begins. Fifth sentence is short. Sixth sentence wraps up the text.';
    const paragraphs = splitTextBySentences(text);
    expect(paragraphs.length).toBe(2);
  });

  it('returns single paragraph for text with 3 or fewer sentences', () => {
    const text = 'First sentence here. Second sentence follows. Third sentence ends.';
    const paragraphs = splitTextBySentences(text);
    expect(paragraphs.length).toBe(1);
    expect(paragraphs[0]).toBe(text);
  });

  it('handles abbreviations without false splitting', () => {
    const text = 'Dr. Smith went to St. Louis last week on business. He met with Mrs. Johnson about the important project they discussed. They discussed the new comprehensive plan together. It was a very productive meeting indeed. The results were all extremely positive. Everyone involved was very satisfied.';
    const paragraphs = splitTextBySentences(text);
    // Should be 2 paragraphs of 3 sentences each
    expect(paragraphs.length).toBe(2);
  });

  it('handles text ending without period', () => {
    const text = 'First sentence is written. Second sentence follows. Third sentence comes next. Fourth sentence is the last one';
    const paragraphs = splitTextBySentences(text);
    expect(paragraphs.length).toBeGreaterThanOrEqual(1);
  });

  it('handles exclamation and question marks as sentence boundaries', () => {
    const text = 'What a great day! How are you doing? I am doing well. This is sentence four. Here is sentence five. And here is sentence six.';
    const paragraphs = splitTextBySentences(text);
    expect(paragraphs.length).toBe(2);
  });

  it('uses custom sentences per paragraph', () => {
    const text = 'One sentence here. Two sentence here. Three sentence here. Four sentence here. Five sentence here. Six sentence here.';
    const paragraphs = splitTextBySentences(text, 2);
    expect(paragraphs.length).toBe(3);
  });

  it('returns empty array for text too short to be speakable', () => {
    const text = 'Too short.';
    const paragraphs = splitTextBySentences(text);
    expect(paragraphs.length).toBe(0);
  });
});

// ── 3-sentence fallback in createArticleFromText ───────────────────────

describe('createArticleFromText 3-sentence fallback', () => {
  it('uses 3-sentence fallback when pasted text has no newlines', () => {
    const text = 'First sentence of the article is right here. Second sentence follows immediately after. Third sentence ends the first paragraph. Fourth sentence starts the second paragraph. Fifth sentence continues nicely. Sixth sentence wraps up the whole text.';
    const article = createArticleFromText(text);
    expect(article.paragraphs.length).toBe(2);
  });

  it('preserves real paragraph breaks when present', () => {
    const text = 'Title\n\nFirst paragraph has enough text to pass the minimum length filter.\n\nSecond paragraph also has enough text to pass the minimum length filter.';
    const article = createArticleFromText(text);
    expect(article.paragraphs.length).toBe(2);
    expect(article.paragraphs[0]).toContain('First paragraph');
    expect(article.paragraphs[1]).toContain('Second paragraph');
  });

  it('handles single long sentence as one paragraph', () => {
    const text = 'This is a single very long sentence that contains many words and is definitely long enough to be a valid paragraph by itself for the text to speech engine.';
    const article = createArticleFromText(text);
    expect(article.paragraphs.length).toBe(1);
  });
});

// ── createArticleFromTextFile ────────────────────────────────────────────

describe('createArticleFromTextFile', () => {
  it('creates article from a .txt file with paragraph breaks', async () => {
    const content = 'First paragraph has enough text to pass the minimum length.\n\nSecond paragraph also has enough text to pass the minimum length filter.';
    const file = new File([content], 'test-article.txt', { type: 'text/plain' });
    const article = await createArticleFromTextFile(file);
    expect(article.title).toBe('test-article');
    expect(article.siteName).toBe('Text File');
    expect(article.paragraphs.length).toBe(2);
  });

  it('throws on empty file', async () => {
    const file = new File([''], 'empty.txt', { type: 'text/plain' });
    await expect(createArticleFromTextFile(file)).rejects.toThrow(/empty/i);
  });

  it('applies 3-sentence fallback for text without paragraph breaks', async () => {
    const content = 'First sentence of the document here. Second sentence follows immediately. Third sentence ends a group. Fourth sentence starts another group. Fifth sentence continues the text. Sixth sentence completes it all.';
    const file = new File([content], 'no-breaks.txt', { type: 'text/plain' });
    const article = await createArticleFromTextFile(file);
    expect(article.paragraphs.length).toBe(2);
  });

  it('strips .text extension from filename for title', async () => {
    const content = 'Long enough paragraph content that passes the minimum length filter for article paragraphs.';
    const file = new File([content], 'my-doc.text', { type: 'text/plain' });
    const article = await createArticleFromTextFile(file);
    expect(article.title).toBe('my-doc');
  });
});

// ── extractParagraphsFromTextItems ──────────────────────────────────────

describe('extractParagraphsFromTextItems', () => {
  it('detects paragraph breaks from vertical position gaps', () => {
    const items = [
      { str: 'First paragraph text here.', transform: [1, 0, 0, 1, 72, 700], height: 12 },
      { str: 'More text in same paragraph.', transform: [1, 0, 0, 1, 72, 686], height: 12 },
      // Large gap (700-686=14 vs next gap of 640-686=46, much larger than lineSpacing*1.8=32.4)
      { str: 'Second paragraph after gap.', transform: [1, 0, 0, 1, 72, 640], height: 12 },
    ];
    const paragraphs = extractParagraphsFromTextItems(items);
    expect(paragraphs.length).toBe(2);
    expect(paragraphs[0]).toContain('First paragraph');
    expect(paragraphs[1]).toContain('Second paragraph');
  });

  it('joins text items on same line', () => {
    const items = [
      { str: 'Hello', transform: [1, 0, 0, 1, 72, 700], height: 12 },
      { str: 'World', transform: [1, 0, 0, 1, 120, 700], height: 12 },
    ];
    const paragraphs = extractParagraphsFromTextItems(items);
    expect(paragraphs.length).toBe(1);
    expect(paragraphs[0]).toBe('Hello World');
  });

  it('handles empty items array', () => {
    expect(extractParagraphsFromTextItems([])).toEqual([]);
  });

  it('skips whitespace-only items', () => {
    const items = [
      { str: 'Text here for first paragraph.', transform: [1, 0, 0, 1, 72, 700], height: 12 },
      { str: '   ', transform: [1, 0, 0, 1, 72, 688], height: 12 },
      { str: 'More text in the same spot.', transform: [1, 0, 0, 1, 72, 676], height: 12 },
    ];
    const paragraphs = extractParagraphsFromTextItems(items);
    expect(paragraphs.length).toBe(1);
    expect(paragraphs[0]).toContain('Text here');
    expect(paragraphs[0]).toContain('More text');
  });

  it('handles hyphenation at line ends', () => {
    const items = [
      { str: 'A very long hyphen-', transform: [1, 0, 0, 1, 72, 700], height: 12 },
      { str: 'ated word here.', transform: [1, 0, 0, 1, 72, 686], height: 12 },
    ];
    const paragraphs = extractParagraphsFromTextItems(items);
    expect(paragraphs.length).toBe(1);
    expect(paragraphs[0]).toContain('hyphenated');
  });
});

// ── createArticleFromPdf ────────────────────────────────────────────────

describe('createArticleFromPdf', () => {
  beforeEach(() => {
    (globalThis as Record<string, unknown>).pdfjsLib = {
      GlobalWorkerOptions: { workerSrc: '' },
      getDocument: vi.fn().mockReturnValue({
        promise: Promise.resolve({
          numPages: 1,
          getPage: vi.fn().mockResolvedValue({
            getTextContent: vi.fn().mockResolvedValue({
              items: [
                { str: 'First paragraph has enough text content to pass the minimum length filter.', transform: [1, 0, 0, 1, 72, 700], height: 12 },
                { str: 'More text in the same paragraph section for the reader.', transform: [1, 0, 0, 1, 72, 686], height: 12 },
                { str: 'Second paragraph after a large vertical gap in the document.', transform: [1, 0, 0, 1, 72, 640], height: 12 },
                { str: 'Additional text in the second paragraph section right here.', transform: [1, 0, 0, 1, 72, 626], height: 12 },
              ],
            }),
          }),
        }),
      }),
    };
  });

  afterEach(() => {
    delete (globalThis as Record<string, unknown>).pdfjsLib;
  });

  it('extracts paragraphs from PDF text items', async () => {
    const file = new File([new ArrayBuffer(10)], 'test.pdf', { type: 'application/pdf' });
    const article = await createArticleFromPdf(file);
    expect(article.title).toBe('test');
    expect(article.siteName).toBe('PDF');
    expect(article.paragraphs.length).toBe(2);
    expect(article.resolvedUrl).toBe('');
  });

  it('throws when pdfjsLib is not loaded', async () => {
    delete (globalThis as Record<string, unknown>).pdfjsLib;
    // Mock loadPdfJs to fail by ensuring pdfjsLib is undefined and dynamic import fails
    const file = new File([new ArrayBuffer(10)], 'test.pdf', { type: 'application/pdf' });
    await expect(createArticleFromPdf(file)).rejects.toThrow();
  });

  it('falls back to sentence splitting when PDF yields single paragraph', async () => {
    (globalThis as Record<string, unknown>).pdfjsLib = {
      GlobalWorkerOptions: { workerSrc: '' },
      getDocument: vi.fn().mockReturnValue({
        promise: Promise.resolve({
          numPages: 1,
          getPage: vi.fn().mockResolvedValue({
            getTextContent: vi.fn().mockResolvedValue({
              items: [
                { str: 'First sentence of the PDF document. Second sentence follows along. Third sentence ends here. Fourth sentence begins now. Fifth sentence is quite short. Sixth sentence wraps up.', transform: [1, 0, 0, 1, 72, 700], height: 12 },
              ],
            }),
          }),
        }),
      }),
    };

    const file = new File([new ArrayBuffer(10)], 'single-block.pdf', { type: 'application/pdf' });
    const article = await createArticleFromPdf(file);
    expect(article.paragraphs.length).toBe(2);
  });

  it('handles multi-page PDFs', async () => {
    const getPage = vi.fn()
      .mockResolvedValueOnce({
        getTextContent: vi.fn().mockResolvedValue({
          items: [
            { str: 'Page one content has enough text to be a valid paragraph for reading.', transform: [1, 0, 0, 1, 72, 700], height: 12 },
          ],
        }),
      })
      .mockResolvedValueOnce({
        getTextContent: vi.fn().mockResolvedValue({
          items: [
            { str: 'Page two content also has enough text to be its own paragraph for reading.', transform: [1, 0, 0, 1, 72, 700], height: 12 },
          ],
        }),
      });

    (globalThis as Record<string, unknown>).pdfjsLib = {
      GlobalWorkerOptions: { workerSrc: '' },
      getDocument: vi.fn().mockReturnValue({
        promise: Promise.resolve({ numPages: 2, getPage }),
      }),
    };

    const file = new File([new ArrayBuffer(10)], 'multi-page.pdf', { type: 'application/pdf' });
    const article = await createArticleFromPdf(file);
    expect(article.paragraphs.length).toBe(2);
  });

  it('throws when PDF has no readable text', async () => {
    (globalThis as Record<string, unknown>).pdfjsLib = {
      GlobalWorkerOptions: { workerSrc: '' },
      getDocument: vi.fn().mockReturnValue({
        promise: Promise.resolve({
          numPages: 1,
          getPage: vi.fn().mockResolvedValue({
            getTextContent: vi.fn().mockResolvedValue({ items: [] }),
          }),
        }),
      }),
    };

    const file = new File([new ArrayBuffer(10)], 'empty.pdf', { type: 'application/pdf' });
    await expect(createArticleFromPdf(file)).rejects.toThrow(/Could not extract/);
  });
});
