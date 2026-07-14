import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fetchTtsAudio } from '../lib/tts-audio-fetcher.js';

describe('fetchTtsAudio', () => {
  const config = { proxyBase: 'https://api.example.com' };

  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
    vi.stubGlobal('URL', {
      createObjectURL: vi.fn(() => 'blob:url'),
      revokeObjectURL: vi.fn(),
    });
  });

  it('returns blob url on success', async () => {
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      blob: async () => new Blob(['audio']),
    } as any);

    const result = await fetchTtsAudio('hello', 'en', config);
    expect(result).toBe('blob:url');
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('retries once on failure and returns null', async () => {
    vi.mocked(fetch).mockRejectedValue(new Error('Network error'));

    const result = await fetchTtsAudio('hello', 'en', config);
    expect(result).toBeNull();
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('returns null if fetch fails with ok: false', async () => {
    vi.mocked(fetch).mockResolvedValue({
      ok: false,
      status: 500,
    } as any);

    const result = await fetchTtsAudio('hello', 'en', config);
    expect(result).toBeNull();
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('does not retry on permanent 4xx errors', async () => {
    vi.mocked(fetch).mockResolvedValue({
      ok: false,
      status: 404,
    } as any);

    const result = await fetchTtsAudio('hello', 'en', config);
    expect(result).toBeNull();
    // Only one attempt — permanent error path throws immediately
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('retries on 429 (rate limit) as transient', async () => {
    vi.mocked(fetch).mockResolvedValue({
      ok: false,
      status: 429,
    } as any);

    const result = await fetchTtsAudio('hello', 'en', config);
    expect(result).toBeNull();
    // Two attempts — 429 is treated as transient despite being in 4xx range
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('encodes text and lang params in the fetch URL', async () => {
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      blob: async () => new Blob(['audio']),
    } as any);

    const result = await fetchTtsAudio('hello & world', 'en-US', config);
    expect(result).toBe('blob:url');
    const [calledUrl] = vi.mocked(fetch).mock.calls[0];
    expect(calledUrl).toContain(encodeURIComponent('hello & world'));
    expect(calledUrl).toContain(encodeURIComponent('en-US'));
    // No space literal — must be percent-encoded
    expect(calledUrl).not.toContain(' ');
  });

  it('treats fetch abort (timeout) as transient and retries', async () => {
    const abortError = new Error('The user aborted a request.');
    abortError.name = 'AbortError';

    vi.mocked(fetch)
      .mockRejectedValueOnce(abortError); // first attempt: timeout → transient path

    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      blob: async () => new Blob(['audio']),
    } as any); // second attempt succeeds

    const result = await fetchTtsAudio('hello', 'en', config);
    expect(result).toBe('blob:url');
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('clears the timeout after successful response', async () => {
    const clearTimeoutSpy = vi.spyOn(globalThis, 'clearTimeout');

    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      blob: async () => new Blob(['audio']),
    } as any);

    await fetchTtsAudio('hello', 'en', config);

    expect(clearTimeoutSpy).toHaveBeenCalled();
  });
});
