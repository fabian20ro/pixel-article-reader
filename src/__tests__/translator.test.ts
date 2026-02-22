import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { translateParagraphs, buildBatches } from '../lib/translator.js';

const PROXY = 'https://proxy.example.workers.dev';

// ── Helpers ─────────────────────────────────────────────────────────

function mockTranslateResponse(translatedText: string, detectedLang = 'de') {
  return {
    ok: true,
    status: 200,
    json: () => Promise.resolve({ translatedText, detectedLang }),
    headers: { get: () => null },
  } as unknown as Response;
}

function mockErrorResponse(status: number, error: string) {
  return {
    ok: false,
    status,
    statusText: 'Error',
    json: () => Promise.resolve({ error }),
    headers: { get: (name: string) => name === 'Retry-After' ? '30' : null },
  } as unknown as Response;
}

beforeEach(() => {
  vi.restoreAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ── buildBatches ───────────────────────────────────────────────────

describe('buildBatches', () => {
  it('returns empty array for empty input', () => {
    expect(buildBatches([])).toEqual([]);
  });

  it('puts a single short paragraph in one batch', () => {
    const result = buildBatches(['Hello world']);
    expect(result).toEqual(['Hello world']);
  });

  it('groups short paragraphs into a single batch', () => {
    const paragraphs = ['Para one.', 'Para two.', 'Para three.'];
    const result = buildBatches(paragraphs);
    expect(result).toEqual(['Para one.\n\nPara two.\n\nPara three.']);
  });

  it('splits when combined length exceeds batch limit', () => {
    const longPara = 'A'.repeat(2000);
    const paragraphs = [longPara, longPara];
    const result = buildBatches(paragraphs);
    expect(result.length).toBe(2);
    expect(result[0]).toBe(longPara);
    expect(result[1]).toBe(longPara);
  });

  it('handles a single paragraph longer than batch limit', () => {
    const veryLong = 'B'.repeat(5000);
    const result = buildBatches([veryLong]);
    // Single paragraph goes into one batch even if over limit
    expect(result.length).toBe(1);
    expect(result[0]).toBe(veryLong);
  });
});

// ── translateParagraphs ────────────────────────────────────────────

describe('translateParagraphs', () => {
  it('returns empty array for empty input', async () => {
    const result = await translateParagraphs([], 'de', 'en', PROXY);
    expect(result).toEqual([]);
  });

  it('translates a single paragraph', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      mockTranslateResponse('Hello world'),
    );

    const result = await translateParagraphs(['Hallo Welt'], 'de', 'en', PROXY);
    expect(result).toEqual(['Hello world']);
  });

  it('sends correct request body to proxy', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      mockTranslateResponse('Translated text'),
    );

    await translateParagraphs(['Original text'], 'de', 'en', PROXY, 'my-secret');

    expect(fetchSpy).toHaveBeenCalledWith(
      `${PROXY}?action=translate`,
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          'Content-Type': 'application/json',
          'X-Proxy-Key': 'my-secret',
        }),
        body: JSON.stringify({ text: 'Original text', from: 'de', to: 'en' }),
      }),
    );
  });

  it('preserves paragraph count when batched', async () => {
    const paragraphs = [
      'Erster Absatz.',
      'Zweiter Absatz.',
      'Dritter Absatz.',
    ];

    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      mockTranslateResponse('First paragraph.\n\nSecond paragraph.\n\nThird paragraph.'),
    );

    const result = await translateParagraphs(paragraphs, 'de', 'en', PROXY);
    expect(result.length).toBe(3);
  });

  it('handles API error with descriptive message', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      mockErrorResponse(502, 'Google Translate API returned 503: Service Unavailable'),
    );

    await expect(
      translateParagraphs(['Test'], 'de', 'en', PROXY),
    ).rejects.toThrow(/502/);
  });

  it('falls back to GET translation when POST is rejected with 405', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(mockErrorResponse(405, 'Only GET requests are allowed.'))
      .mockResolvedValueOnce(mockTranslateResponse('Hello from GET fallback'));

    const result = await translateParagraphs(['Salut'], 'ro', 'en', PROXY, 'my-secret');

    expect(result).toEqual(['Hello from GET fallback']);
    expect(fetchSpy).toHaveBeenCalledTimes(2);

    expect(fetchSpy.mock.calls[0][0]).toBe(`${PROXY}?action=translate`);
    expect(fetchSpy.mock.calls[0][1]).toEqual(expect.objectContaining({ method: 'POST' }));

    const secondUrl = String(fetchSpy.mock.calls[1][0]);
    expect(secondUrl).toContain(`${PROXY}?`);
    expect(secondUrl).toContain('action=translate');
    expect(secondUrl).toContain('from=ro');
    expect(secondUrl).toContain('to=en');
    expect(secondUrl).toContain('text=Salut');
    expect(fetchSpy.mock.calls[1][1]).toEqual(expect.objectContaining({ method: 'GET' }));
  });

  it('handles rate limit error with retry info', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      mockErrorResponse(429, 'Rate limit exceeded'),
    );

    await expect(
      translateParagraphs(['Test'], 'de', 'en', PROXY),
    ).rejects.toThrow(/rate limit/i);
  });

  it('handles network error', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new TypeError('Failed to fetch'));

    await expect(
      translateParagraphs(['Test'], 'de', 'en', PROXY),
    ).rejects.toThrow(/Could not reach translation service/);
  });

  it('does not include X-Proxy-Key header when no secret', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      mockTranslateResponse('Translated'),
    );

    await translateParagraphs(['Text'], 'de', 'en', PROXY);

    const callHeaders = fetchSpy.mock.calls[0][1]?.headers as Record<string, string>;
    expect(callHeaders['X-Proxy-Key']).toBeUndefined();
  });
});
