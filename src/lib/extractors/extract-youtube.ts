/**
 * YouTube transcript and metadata extraction.
 */

import { YoutubeTranscript } from 'youtube-transcript-plus';
import { detectLanguage } from '../lang-detect.js';
import {
  type Article,
  WORDS_PER_MINUTE,
} from './types.js';
import {
  countWords,
} from './utils.js';

/**
 * Fetch YouTube transcript and metadata.
 * Uses a lightweight InnerTube-based fetcher that works in both Worker and Browser.
 */
export async function extractArticleFromYoutube(
  url: string,
  fetcher: typeof fetch = globalThis.fetch,
): Promise<Article> {
  const videoId = extractYoutubeVideoId(url);
  if (!videoId) {
    throw new Error('Invalid YouTube URL.');
  }

  try {
    // Phase 1: Fetch metadata (title, description) from video page
    // Note: We fetch the video page to get ytInitialPlayerResponse.
    // In Browser, this will go through the CORS proxy if the caller wraps the fetcher.
    const pageResp = await fetcher(`https://www.youtube.com/watch?v=${videoId}`);
    if (!pageResp.ok) {
      throw new Error(`YouTube returned ${pageResp.status} when fetching video page.`);
    }
    const html = await pageResp.text();
    const metadata = parseYoutubeMetadata(html);

    // Phase 2: Fetch transcript
    // youtube-transcript-plus allows passing a custom fetcher.
    const transcriptLoader = new YoutubeTranscript({ fetcher });
    const transcriptItems = await transcriptLoader.fetchTranscript(videoId);

    if (!transcriptItems || transcriptItems.length === 0) {
      throw new Error('No transcript found for this video. Captions may be disabled.');
    }

    // Phase 3: Format transcript into paragraphs
    const paragraphs = groupTranscriptIntoParagraphs(transcriptItems.map(item => item.text));
    
    const title = `Transcript for: ${metadata.title}`;
    const textContent = paragraphs.join('\n\n');
    const wordCount = countWords(textContent);
    const markdown = `# ${title}\n\n> ${metadata.description.replace(/\n/g, '\n> ')}\n\n${textContent}`;

    return {
      title,
      content: '',
      textContent,
      markdown,
      paragraphs,
      lang: detectLanguage(textContent),
      htmlLang: '',
      siteName: 'YouTube',
      excerpt: metadata.description.slice(0, 200),
      wordCount,
      estimatedMinutes: Math.max(1, Math.round(wordCount / WORDS_PER_MINUTE)),
      resolvedUrl: url,
    };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`YouTube extraction failed: ${msg}`);
  }
}

/** Extract video ID from various YouTube URL formats. */
export function extractYoutubeVideoId(url: string): string | null {
  try {
    const parsed = new URL(url);
    if (parsed.hostname.includes('youtu.be')) {
      return parsed.pathname.slice(1);
    }
    if (parsed.pathname.startsWith('/watch')) {
      return parsed.searchParams.get('v');
    }
    if (parsed.pathname.startsWith('/embed/') || parsed.pathname.startsWith('/shorts/')) {
      return parsed.pathname.split('/')[2];
    }
    return null;
  } catch {
    return null;
  }
}

/** Extract title and description from YouTube video page HTML using ytInitialPlayerResponse. */
function parseYoutubeMetadata(html: string): { title: string; description: string } {
  let title = 'YouTube Video';
  let description = '';

  try {
    // Find the player response JSON
    const match = html.match(/ytInitialPlayerResponse\s*=\s*({.+?});/);
    if (match) {
      const data = JSON.parse(match[1]);
      title = data.videoDetails?.title || title;
      description = data.videoDetails?.shortDescription || '';
    } else {
      // Fallback: <title> tag
      const titleMatch = html.match(/<title>([^<]+)<\/title>/);
      if (titleMatch) {
        title = titleMatch[1].replace(' - YouTube', '').trim();
      }
    }
  } catch { /* ignore parse errors */ }

  return { title, description };
}

/** Group short transcript segments into readable paragraphs. */
function groupTranscriptIntoParagraphs(texts: string[]): string[] {
  const paragraphs: string[] = [];
  let currentParagraph = '';

  for (const text of texts) {
    const cleaned = text.trim();
    if (!cleaned) continue;

    // Join sentences/segments
    if (currentParagraph && !currentParagraph.endsWith('.') && !currentParagraph.endsWith('?') && !currentParagraph.endsWith('!')) {
      currentParagraph += ' ' + cleaned;
    } else {
      // Start a new paragraph every ~400 characters OR if the previous one ended with a strong break
      if (currentParagraph.length > 400) {
        paragraphs.push(currentParagraph.trim());
        currentParagraph = cleaned;
      } else {
        currentParagraph += (currentParagraph ? '\n\n' : '') + cleaned;
      }
    }
  }

  if (currentParagraph.trim()) {
    paragraphs.push(currentParagraph.trim());
  }

  // Flatten any single newlines that were added in the loop
  return paragraphs.map(p => p.replace(/\n/g, ' ').replace(/\s+/g, ' ').trim());
}
