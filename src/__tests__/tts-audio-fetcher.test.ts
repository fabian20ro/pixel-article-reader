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
});
