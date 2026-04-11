// @vitest-environment node

import { afterEach, describe, expect, it, vi } from 'vitest';
import worker from '../../worker/index.ts';

const env = {
  ALLOWED_ORIGIN: 'https://app.example',
  PROXY_SECRET: '',
};

const ctx = {} as ExecutionContext;

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('worker validation', () => {
  it('rejects raw proxy requests to private IPs before fetching', async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);

    const response = await worker.fetch(
      new Request('https://worker.example/?url=http://127.0.0.1/internal'),
      env,
      ctx,
    );

    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: 'Access to internal addresses is not allowed.' });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('rejects parse requests to non-http URLs before fetching', async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);

    const response = await worker.fetch(
      new Request('https://worker.example/parse', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: 'file:///etc/passwd', format: 'article' }),
      }),
      env,
      ctx,
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: 'Only http and https URLs are allowed.' });
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe('worker youtube parse', () => {
  it('returns a JSON article and fetches all transcript hops inside the worker', async () => {
    const fetchSpy = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = input.toString();

      if (url.startsWith('https://www.youtube.com/watch?v=dQw4w9WgXcQ')) {
        return new Response(
          `<html><script>var ytInitialPlayerResponse = {"videoDetails":{"title":"Worker Video","shortDescription":"Transcript desc"}};</script>"INNERTUBE_API_KEY":"worker-key"</html>`,
          { status: 200, headers: { 'content-type': 'text/html' } },
        );
      }

      if (url.startsWith('https://www.youtube.com/youtubei/v1/player?key=worker-key')) {
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
          '<transcript><text start="0" dur="1">Hello.</text><text start="1" dur="1">Worker path transcript.</text></transcript>',
          { status: 200, headers: { 'content-type': 'text/xml' } },
        );
      }

      throw new Error(`Unexpected worker fetch: ${url}`);
    });

    vi.stubGlobal('fetch', fetchSpy);

    const response = await worker.fetch(
      new Request('https://worker.example/parse', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
          format: 'article',
        }),
      }),
      env,
      ctx,
    );

    expect(response.status).toBe(200);
    const article = await response.json();
    expect(article.siteName).toBe('YouTube');
    expect(article.title).toBe('Transcript for: Worker Video');
    expect(article.paragraphs.join(' ')).toContain('Worker path transcript.');
    expect(fetchSpy).toHaveBeenCalledTimes(3);
  });
});
