import { describe, it, expect, vi } from 'vitest';
import { extractArticleFromYoutube, extractYoutubeVideoId } from '../lib/extractors/extract-youtube.js';

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
  const YT_URL = 'https://www.youtube.com/watch?v=dQw4w9WgXcQ';

  it('fetches metadata, player info, and transcript XML', async () => {
    const fetcher = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = input.toString();

      if (url.startsWith('https://www.youtube.com/watch?v=')) {
        return new Response(
          `<html><script>var ytInitialPlayerResponse = {"videoDetails":{"title":"Test Video","shortDescription":"Line one\\nLine two"}};</script>"INNERTUBE_API_KEY":"abc123"</html>`,
          { status: 200, headers: { 'content-type': 'text/html' } },
        );
      }

      if (url.startsWith('https://www.youtube.com/youtubei/v1/player?key=abc123')) {
        expect(init?.method).toBe('POST');
        return new Response(JSON.stringify({
          captions: {
            playerCaptionsTracklistRenderer: {
              captionTracks: [
                {
                  baseUrl: 'https://www.youtube.com/api/timedtext?v=dQw4w9WgXcQ&lang=en',
                  languageCode: 'en',
                },
              ],
            },
          },
          playabilityStatus: { status: 'OK' },
        }), { status: 200, headers: { 'content-type': 'application/json' } });
      }

      if (url.startsWith('https://www.youtube.com/api/timedtext')) {
        return new Response(
          '<transcript><text start="0" dur="1">Hello world.</text><text start="1" dur="1">This is a test transcript.</text></transcript>',
          { status: 200, headers: { 'content-type': 'text/xml' } },
        );
      }

      throw new Error(`Unexpected URL ${url}`);
    });

    const article = await extractArticleFromYoutube(YT_URL, fetcher as typeof fetch);

    expect(fetcher).toHaveBeenCalledTimes(3);
    expect(article.title).toBe('Transcript for: Test Video');
    expect(article.siteName).toBe('YouTube');
    expect(article.markdown).toContain('Line one');
    expect(article.paragraphs.join(' ')).toContain('Hello world.');
    expect(article.resolvedUrl).toBe(YT_URL);
  });

  it('falls back to the page title when player metadata is missing', async () => {
    const fetcher = vi.fn(async (input: RequestInfo | URL) => {
      const url = input.toString();
      if (url.startsWith('https://www.youtube.com/watch?v=')) {
        return new Response(
          '<html><head><title>Fallback Title - YouTube</title></head>"INNERTUBE_API_KEY":"abc123"</html>',
          { status: 200 },
        );
      }
      if (url.startsWith('https://www.youtube.com/youtubei/v1/player?key=abc123')) {
        return new Response(JSON.stringify({
          captions: {
            playerCaptionsTracklistRenderer: {
              captionTracks: [{ baseUrl: 'https://www.youtube.com/api/timedtext?v=dQw4w9WgXcQ' }],
            },
          },
          playabilityStatus: { status: 'OK' },
        }), { status: 200 });
      }
      return new Response('<transcript><text start="0" dur="1">Hello world.</text></transcript>', { status: 200 });
    });

    const article = await extractArticleFromYoutube(YT_URL, fetcher as typeof fetch);
    expect(article.title).toBe('Transcript for: Fallback Title');
  });

  it('throws if no transcript tracks are available', async () => {
    const fetcher = vi.fn(async (input: RequestInfo | URL) => {
      const url = input.toString();
      if (url.startsWith('https://www.youtube.com/watch?v=')) {
        return new Response(
          '<html><script>var ytInitialPlayerResponse = {"videoDetails":{"title":"Test Video","shortDescription":"desc"}};</script>"INNERTUBE_API_KEY":"abc123"</html>',
          { status: 200 },
        );
      }

      return new Response(JSON.stringify({
        captions: {
          playerCaptionsTracklistRenderer: {
            captionTracks: [],
          },
        },
        playabilityStatus: { status: 'OK' },
      }), { status: 200 });
    });

    await expect(extractArticleFromYoutube(YT_URL, fetcher as typeof fetch)).rejects.toThrow(/No transcript/);
  });
});
