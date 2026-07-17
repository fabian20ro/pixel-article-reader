import { describe, it, expect, vi } from 'vitest';
import { extractYoutubeVideoId } from '../lib/extractors/extract-youtube.js';

describe('extractYoutubeVideoId', () => {
  it('extracts from URL with extra parameters', () => {
    expect(extractYoutubeVideoId('https://www.youtube.com/watch?v=dQw4w9WgXcQ&feature=emb_rel_pause')).toBe('dQw4w9WgXcQ');
  });
  it('extracts from /watch/ URL format', () => {
    expect(extractYoutubeVideoId('https://www.youtube.com/watch/abc12345678')).toBe('abc12345678');
  });

  it('rejects non-11-char path ID on /watch/', () => {
    expect(extractYoutubeVideoId('https://www.youtube.com/watch/shortID')).toBeNull();
    expect(extractYoutubeVideoId('https://www.youtube.com/watch/not-a-video-id-123')).toBeNull();
  });

  it('rejects invalid IDs on /embed/, /shorts/, and /live/', () => {
    expect(extractYoutubeVideoId('https://www.youtube.com/embed/short')).toBeNull();
    expect(extractYoutubeVideoId('https://www.youtube.com/shorts/not-valid-id!@#')).toBeNull();
    expect(extractYoutubeVideoId('https://www.youtube.com/live/xYz')).toBeNull();
  });

  it('extracts from /watch/ pathname with extra query parameters', () => {
    expect(extractYoutubeVideoId('https://www.youtube.com/watch/abc12345678?t=30&list=PLxyz')).toBe('abc12345678');
  });

  it('extracts from /embed/ with trailing slash and query parameters', () => {
    expect(extractYoutubeVideoId('https://www.youtube.com/embed/dQw4w9WgXcQ?rel=0&fs=1')).toBe('dQw4w9WgXcQ');
  });
  it('extracts from standard URL', () => {
    expect(extractYoutubeVideoId('https://www.youtube.com/watch?v=dQw4w9WgXcQ')).toBe('dQw4w9WgXcQ');
  });
  it('extracts from short URL', () => {
    expect(extractYoutubeVideoId('https://youtu.be/dQw4w9WgXcQ')).toBe('dQw4w9WgXcQ');
  });
  it('extracts from embed URL', () => {
    expect(extractYoutubeVideoId('https://www.youtube.com/embed/dQw4w9WgXcQ')).toBe('dQw4w9WgXcQ');
  });
  it('extracts from shorts URL', () => {
    expect(extractYoutubeVideoId('https://www.youtube.com/shorts/dQw4w9WgXcQ')).toBe('dQw4w9WgXcQ');
  });
  it('extracts from live URL', () => {
    expect(extractYoutubeVideoId('https://www.youtube.com/live/dQw4w9WgXcQ')).toBe('dQw4w9WgXcQ');
  });
  it('extracts from v/ URL', () => {
    expect(extractYoutubeVideoId('https://www.youtube.com/v/dQw4w9WgXcQ')).toBe('dQw4w9WgXcQ');
  });
  it('extracts from URL with parameters in different order', () => {
    expect(extractYoutubeVideoId('https://www.youtube.com/watch?feature=emb_rel_pause&v=dQw4w9WgXcQ')).toBe('dQw4w9WgXcQ');
  });
  it('extracts from mobile URL', () => {
    expect(extractYoutubeVideoId('https://m.youtube.com/watch?v=dQw4w9WgXcQ')).toBe('dQw4w9WgXcQ');
  });
  it('extracts from YouTube Music URL', () => {
    expect(extractYoutubeVideoId('https://music.youtube.com/watch?v=dQw4w9WgXcQ')).toBe('dQw4w9WgXcQ');
  });
  it('extracts from URL with trailing slash in pathname', () => {
    expect(extractYoutubeVideoId('https://www.youtube.com/embed/dQw4w9WgXcQ/')).toBe('dQw4w9WgXcQ');
  });
  it('handles parameters in embed and shorts URLs', () => {
    expect(extractYoutubeVideoId('https://www.youtube.com/embed/dQw4w9WgXcQ?rel=0')).toBe('dQw4w9WgXcQ');
    expect(extractYoutubeVideoId('https://www.youtube.com/shorts/dQw4w9WgXcQ?feature=share')).toBe('dQw4w9WgXcQ');
  });
  it('handles parameters in short URLs', () => {
    expect(extractYoutubeVideoId('https://youtu.be/dQw4w9WgXcQ?si=abc')).toBe('dQw4w9WgXcQ');
  });
  it('returns null for invalid video id', () => {
    expect(extractYoutubeVideoId('https://www.youtube.com/watch?v=short')).toBeNull();
    expect(extractYoutubeVideoId('https://www.youtube.com/watch?v=not-a-video-id-123')).toBeNull();
    expect(extractYoutubeVideoId('https://not-really-youtu.be.com/abc12345678')).toBeNull();
    expect(extractYoutubeVideoId('https://www.youtube.com/watch')).toBeNull();
    expect(extractYoutubeVideoId('https://www.youtube.com/watch?v=')).toBeNull();
  });

  it('handles youtu.be trailing slash', () => {
    expect(extractYoutubeVideoId('https://youtu.be/dQw4w9WgXcQ/')).toBe('dQw4w9WgXcQ');
  });

  it('returns null for empty and unparseable input', () => {
    expect(extractYoutubeVideoId('')).toBeNull();
    expect(extractYoutubeVideoId('not a url at all')).toBeNull();
    expect(extractYoutubeVideoId('   ')).toBeNull();
  });

  it('extracts from watch URL with mixed parameter order', () => {
    expect(extractYoutubeVideoId('https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=30&list=PLxyz')).toBe('dQw4w9WgXcQ');
  });

  it('extracts from youtu.be with trailing slash and query params', () => {
    expect(extractYoutubeVideoId('https://youtu.be/dQw4w9WgXcQ/?si=abc')).toBe('dQw4w9WgXcQ');
  });

  it('returns null for watch URL without v= parameter', () => {
    expect(extractYoutubeVideoId('https://www.youtube.com/watch?t=30&list=PLxyz')).toBeNull();
  });

  it('rejects malformed embed paths where the ID contains non-allowed chars', () => {
    // v= embedded in path instead of query string — regex rejects '=' character.
    expect(extractYoutubeVideoId('https://www.youtube.com/embed/v=dQw4w9WgXcQ')).toBeNull();
  });

  it('extracts ID at index [2] even when extra segments follow', () => {
    // The function takes pathname[2] and validates via regex; trailing junk is ignored.
    expect(extractYoutubeVideoId('https://www.youtube.com/shorts/dQw4w9WgXcQ/extra')).toBe('dQw4w9WgXcQ');
  });

  it('returns null for bare path segments with no valid ID', () => {
    // Trailing slash on /watch/ — pathname[2] is empty string, regex rejects.
    expect(extractYoutubeVideoId('https://www.youtube.com/watch/')).toBeNull();
  });

  it('extracts from /watch/ path with multiple query parameters', () => {
    expect(extractYoutubeVideoId('https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=120&feature=share')).toBe('dQw4w9WgXcQ');
  });
});
