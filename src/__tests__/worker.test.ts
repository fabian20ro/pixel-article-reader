// @vitest-environment node

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import worker from '../../worker/index.ts';

const env = {
  ALLOWED_ORIGIN: 'https://app.example',
};

const ctx = {} as ExecutionContext;

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.useRealTimers();
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

  it('rejects parse requests with malformed JSON body', async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);

    const response = await worker.fetch(
      new Request('https://worker.example/parse', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{invalid json body',
      }),
      env,
      ctx,
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: 'Invalid JSON body.' });
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe('worker rate limiting', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  it('rejects requests after exhausting the per-IP quota within the window', async () => {
    const fetchSpy = vi.fn(async () => new Response('ok', { headers: { 'content-type': 'text/html' } }));
    vi.stubGlobal('fetch', fetchSpy);
    const request = (path: string) => new Request(
      `https://worker.example/?url=https://example.com/${path}`,
      { headers: { 'CF-Connecting-IP': '192.0.2.10' } },
    );

    // Every request through the configured quota must still be accepted.
    for (let i = 0; i < 60; i++) {
      const allowed = await worker.fetch(request(`page-${i}`), env, ctx);
      expect(allowed.status).toBe(200);
      expect(allowed.headers.get('X-RateLimit-Remaining')).toBe(String(59 - i));
    }

    const response = await worker.fetch(request('overflow'), env, ctx);

    expect(response.status).toBe(429);
    const body = await response.json();
    expect(typeof body.error).toBe('string');
    expect(body.error).toMatch(/Rate limit exceeded/i);
    expect(response.headers.get('X-RateLimit-Remaining')).toBe('0');
  });

  it('allows requests once the rate-limit window passes', async () => {
    const fetchSpy = vi.fn(async () => new Response('ok', { headers: { 'content-type': 'text/html' } }));
    vi.stubGlobal('fetch', fetchSpy);
    const request = () => new Request(
      'https://worker.example/?url=https://example.com/page',
      { headers: { 'CF-Connecting-IP': '192.0.2.11' } },
    );

    for (let i = 0; i < 60; i++) {
      const allowed = await worker.fetch(request(), env, ctx);
      expect(allowed.status).toBe(200);
    }

    vi.advanceTimersByTime(61_000);

    const response = await worker.fetch(request(), env, ctx);

    expect(response.status).toBe(200);
    expect(response.headers.get('X-RateLimit-Remaining')).toBe('59');
  });
});

describe('worker youtube parse', () => {
  it('returns a JSON article and fetches all transcript hops inside the worker', async () => {
    const fetchSpy = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = input.toString();
      const parsedUrl = new URL(url);

      if (
        parsedUrl.protocol === 'https:' &&
        parsedUrl.hostname === 'www.youtube.com' &&
        parsedUrl.pathname === '/youtubei/v1/player'
      ) {
        expect(init?.method).toBe('POST');
        return new Response(JSON.stringify({
          videoDetails: {
            title: "Worker Video",
            shortDescription: "Transcript desc"
          },
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

      if (
        parsedUrl.protocol === 'https:' &&
        parsedUrl.hostname === 'www.youtube.com' &&
        parsedUrl.pathname === '/api/timedtext'
      ) {
        return new Response(JSON.stringify({
          events: [
            { tStartMs: 0, dDurationMs: 1000, segs: [{ utf8: 'Hello.' }] },
            { tStartMs: 1000, dDurationMs: 1000, segs: [{ utf8: 'Worker path transcript.' }] }
          ]
        }), { status: 200, headers: { 'content-type': 'application/json' } });
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
    // Should be 2 calls: Player API (direct with static key) + Transcript
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });
});
