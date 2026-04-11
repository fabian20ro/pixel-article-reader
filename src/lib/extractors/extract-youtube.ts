/**
 * YouTube transcript and metadata extraction.
 *
 * Worker-only path. Browser callers should go through the worker `/parse` API.
 */

import { detectLanguage } from '../lang-detect.js';
import {
  type Article,
  WORDS_PER_MINUTE,
} from './types.js';
import {
  buildArticleFromParagraphs,
  countWords,
} from './utils.js';

const USER_AGENT =
  'Mozilla/5.0 (Linux; Android 14; Pixel 9a) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Mobile Safari/537.36';

const XML_ENTITY_MAP: Record<string, string> = {
  '&amp;': '&',
  '&lt;': '<',
  '&gt;': '>',
  '&quot;': '"',
  '&#39;': "'",
  '&apos;': "'",
};

const XML_TEXT_RE = /<text start="([^"]*)" dur="([^"]*)">([^<]*)<\/text>/g;

type TranscriptSegment = {
  text: string;
  duration: number;
  offset: number;
  lang: string;
};

type TranscriptTrack = {
  baseUrl?: string;
  url?: string;
  languageCode?: string;
};

/** Extract video ID from various YouTube URL formats. */
export function extractYoutubeVideoId(url: string): string | null {
  try {
    const parsed = new URL(url);
    if (parsed.hostname.includes('youtu.be')) {
      const id = parsed.pathname.slice(1);
      return /^[\w-]{11}$/.test(id) ? id : null;
    }
    if (parsed.pathname.startsWith('/watch')) {
      const id = parsed.searchParams.get('v');
      return id && /^[\w-]{11}$/.test(id) ? id : null;
    }
    if (parsed.pathname.startsWith('/embed/') || parsed.pathname.startsWith('/shorts/')) {
      const id = parsed.pathname.split('/')[2];
      return id && /^[\w-]{11}$/.test(id) ? id : null;
    }
    return null;
  } catch {
    return null;
  }
}

export async function extractArticleFromYoutube(
  url: string,
  fetcher: typeof fetch = globalThis.fetch,
): Promise<Article> {
  const videoId = extractYoutubeVideoId(url);
  if (!videoId) {
    throw new Error('Invalid YouTube URL.');
  }

  try {
    const watchResponse = await fetchYoutubePage(videoId, fetcher);
    const html = await watchResponse.text();
    const metadata = parseYoutubeMetadata(html);
    const apiKey = extractInnertubeApiKey(html);
    const playerJson = await fetchPlayerJson(videoId, apiKey, fetcher);
    const track = pickTranscriptTrack(playerJson);
    const transcriptItems = await fetchTranscriptSegments(track, fetcher);

    if (transcriptItems.length === 0) {
      throw new Error('No transcript found for this video. Captions may be disabled.');
    }

    const paragraphs = groupTranscriptIntoParagraphs(transcriptItems.map((item) => item.text));
    const title = `Transcript for: ${metadata.title}`;
    const description = metadata.description.trim();
    const textContent = paragraphs.join('\n\n');
    const markdownParts = [`# ${title}`];
    if (description) {
      markdownParts.push(`> ${description.replace(/\n/g, '\n> ')}`);
    }
    markdownParts.push(textContent);

    const article = buildArticleFromParagraphs(paragraphs, title, 'YouTube', markdownParts.join('\n\n'));
    article.lang = detectLanguage(textContent);
    article.excerpt = description.slice(0, 200) || textContent.slice(0, 200);
    article.wordCount = countWords(textContent);
    article.estimatedMinutes = Math.max(1, Math.round(article.wordCount / WORDS_PER_MINUTE));
    article.resolvedUrl = url;
    return article;
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`YouTube extraction failed: ${msg}`);
  }
}

async function fetchYoutubePage(videoId: string, fetcher: typeof fetch): Promise<Response> {
  const response = await fetcher(`https://www.youtube.com/watch?v=${videoId}`, {
    headers: { 'User-Agent': USER_AGENT },
  });
  if (!response.ok) {
    throw new Error(`YouTube returned ${response.status} when fetching video page.`);
  }
  return response;
}

function extractInnertubeApiKey(html: string): string {
  const match = html.match(/"INNERTUBE_API_KEY":"([^"]+)"/)
    || html.match(/INNERTUBE_API_KEY\\":\\"([^\\"]+)\\"/);
  if (!match) {
    throw new Error('Could not find YouTube API key for transcript lookup.');
  }
  return match[1];
}

async function fetchPlayerJson(videoId: string, apiKey: string, fetcher: typeof fetch): Promise<any> {
  const response = await fetcher(`https://www.youtube.com/youtubei/v1/player?key=${apiKey}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'User-Agent': USER_AGENT,
    },
    body: JSON.stringify({
      context: {
        client: {
          clientName: 'ANDROID',
          clientVersion: '20.10.38',
        },
      },
      videoId,
    }),
  });

  if (!response.ok) {
    throw new Error(`YouTube returned ${response.status} when fetching transcript metadata.`);
  }

  return await response.json();
}

function pickTranscriptTrack(playerJson: any): TranscriptTrack {
  const tracklist =
    playerJson?.captions?.playerCaptionsTracklistRenderer
    || playerJson?.playerCaptionsTracklistRenderer;
  const tracks = tracklist?.captionTracks;

  if (!playerJson?.captions || !tracklist) {
    if (playerJson?.playabilityStatus?.status === 'OK') {
      throw new Error('No transcript found for this video. Captions may be disabled.');
    }
    throw new Error('Transcript metadata is not available for this video.');
  }

  if (!Array.isArray(tracks) || tracks.length === 0) {
    throw new Error('No transcript found for this video. Captions may be disabled.');
  }

  return tracks[0];
}

async function fetchTranscriptSegments(track: TranscriptTrack, fetcher: typeof fetch): Promise<TranscriptSegment[]> {
  const transcriptUrl = (track.baseUrl || track.url || '').replace(/&fmt=[^&]+/, '');
  if (!transcriptUrl) {
    throw new Error('Transcript track is missing a fetch URL.');
  }

  const response = await fetcher(transcriptUrl, {
    headers: { 'User-Agent': USER_AGENT },
  });
  if (!response.ok) {
    throw new Error(`YouTube transcript fetch failed with status ${response.status}.`);
  }

  const xml = await response.text();
  return [...xml.matchAll(XML_TEXT_RE)].map((match) => ({
    text: decodeXmlEntities(match[3]),
    duration: parseFloat(match[2]),
    offset: parseFloat(match[1]),
    lang: track.languageCode || 'en',
  }));
}

/** Extract title and description from YouTube video page HTML using ytInitialPlayerResponse. */
function parseYoutubeMetadata(html: string): { title: string; description: string } {
  let title = 'YouTube Video';
  let description = '';

  try {
    const match = html.match(/ytInitialPlayerResponse\s*=\s*({.+?});/);
    if (match) {
      const data = JSON.parse(match[1]);
      title = data.videoDetails?.title || title;
      description = data.videoDetails?.shortDescription || '';
    } else {
      const titleMatch = html.match(/<title>([^<]+)<\/title>/);
      if (titleMatch) {
        title = titleMatch[1].replace(' - YouTube', '').trim();
      }
    }
  } catch {
    // Ignore malformed metadata and keep fallback title.
  }

  return { title, description };
}

function decodeXmlEntities(text: string): string {
  return text.replace(/&(?:amp|lt|gt|quot|apos|#39);/g, (match) => XML_ENTITY_MAP[match] ?? match);
}

/** Group short transcript segments into readable paragraphs. */
function groupTranscriptIntoParagraphs(texts: string[]): string[] {
  const paragraphs: string[] = [];
  let currentParagraph = '';

  for (const text of texts) {
    const cleaned = text.trim();
    if (!cleaned) continue;

    if (
      currentParagraph
      && !currentParagraph.endsWith('.')
      && !currentParagraph.endsWith('?')
      && !currentParagraph.endsWith('!')
    ) {
      currentParagraph += ' ' + cleaned;
      continue;
    }

    if (currentParagraph.length > 400) {
      paragraphs.push(currentParagraph.trim());
      currentParagraph = cleaned;
      continue;
    }

    currentParagraph += (currentParagraph ? '\n\n' : '') + cleaned;
  }

  if (currentParagraph.trim()) {
    paragraphs.push(currentParagraph.trim());
  }

  return paragraphs.map((paragraph) => paragraph.replace(/\n/g, ' ').replace(/\s+/g, ' ').trim());
}
