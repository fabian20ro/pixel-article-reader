/**
 * TTS Audio Fetcher — fetches sentence-level TTS audio from the Worker.
 *
 * Stateless: each call fetches one sentence's audio from the proxy's
 * ?action=tts endpoint and returns a blob URL for <audio> playback.
 */

const FETCH_TIMEOUT_MS = 10_000;

export interface TtsAudioFetcherConfig {
  proxyBase: string;
  proxySecret: string;
}

/**
 * Fetch TTS audio for a single sentence.
 * Returns a blob URL that can be assigned to audio.src, or null on failure.
 */
export async function fetchTtsAudio(
  text: string,
  lang: string,
  config: TtsAudioFetcherConfig,
): Promise<string | null> {
  const url =
    `${config.proxyBase}/?action=tts` +
    `&text=${encodeURIComponent(text)}` +
    `&lang=${encodeURIComponent(lang)}`;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  try {
    const headers: Record<string, string> = {};
    if (config.proxySecret) {
      headers['X-Proxy-Key'] = config.proxySecret;
    }

    const resp = await fetch(url, { signal: controller.signal, headers });
    if (!resp.ok) return null;

    const blob = await resp.blob();
    return URL.createObjectURL(blob);
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}
