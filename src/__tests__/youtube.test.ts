import { describe, it, expect, vi } from 'vitest';
import { extractArticleFromYoutube, extractYoutubeVideoId } from '../lib/extractors/extract-youtube.js';

vi.mock('youtube-transcript-plus', () => ({
  YoutubeTranscript: vi.fn().mockImplementation(function(this: any) {
    this.fetchTranscript = vi.fn().mockResolvedValue([
      { text: 'Hello world.' },
      { text: 'This is a test transcript.' },
      { text: 'It has multiple segments.' },
    ]);
  }),
}));

describe('extractYoutubeVideoId', () => {
  it('extracts ID from standard watch URL', () => {
    expect(extractYoutubeVideoId('https://www.youtube.com/watch?v=dQw4w9WgXcQ')).toBe('dQw4w9WgXcQ');
  });

  it('extracts ID from short URL', () => {
    expect(extractYoutubeVideoId('https://youtu.be/dQw4w9WgXcQ')).toBe('dQw4w9WgXcQ');
  });

  it('extracts ID from embed URL', () => {
    expect(extractYoutubeVideoId('https://www.youtube.com/embed/dQw4w9WgXcQ')).toBe('dQw4w9WgXcQ');
  });

  it('extracts ID from shorts URL', () => {
    expect(extractYoutubeVideoId('https://www.youtube.com/shorts/dQw4w9WgXcQ')).toBe('dQw4w9WgXcQ');
  });

  it('returns null for invalid URLs', () => {
    expect(extractYoutubeVideoId('https://example.com')).toBeNull();
  });
});

describe('extractArticleFromYoutube', () => {
  const YT_URL = 'https://www.youtube.com/watch?v=test';

  it('successfully extracts metadata and transcript', async () => {
    const mockHtml = `
      <html>
        <script>var ytInitialPlayerResponse = {"videoDetails":{"title":"Test Video","shortDescription":"Test Description"}};</script>
      </html>
    `;
    const mockFetcher = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: () => Promise.resolve(mockHtml),
    });

    const article = await extractArticleFromYoutube(YT_URL, mockFetcher as any);

    expect(article.title).toBe('Transcript for: Test Video');
    expect(article.siteName).toBe('YouTube');
    expect(article.paragraphs.length).toBeGreaterThan(0);
    expect(article.markdown).toContain('Test Description');
    expect(article.markdown).toContain('Hello world');
  });

  it('falls back to <title> if player response is missing', async () => {
    const mockHtml = `
      <html>
        <head><title>Fallback Title - YouTube</title></head>
      </html>
    `;
    const mockFetcher = vi.fn().mockResolvedValue({
      ok: true,
      text: () => Promise.resolve(mockHtml),
    });

    const article = await extractArticleFromYoutube(YT_URL, mockFetcher as any);
    expect(article.title).toBe('Transcript for: Fallback Title');
  });

  it('throws if no transcript is found', async () => {
    const { YoutubeTranscript } = await import('youtube-transcript-plus');
    vi.mocked(YoutubeTranscript).mockImplementationOnce(function(this: any) {
      this.fetchTranscript = vi.fn().mockResolvedValue([]);
    } as any);

    const mockFetcher = vi.fn().mockResolvedValue({
      ok: true,
      text: () => Promise.resolve('<html></html>'),
    });

    await expect(extractArticleFromYoutube(YT_URL, mockFetcher as any)).rejects.toThrow(/No transcript/);
  });
});
