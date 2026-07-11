import { describe, it, expect, vi } from 'vitest';
import { extractYoutubeVideoId } from '../lib/extractors/extract-youtube.js';

describe('extractYoutubeVideoId', () => {
  it('extracts from URL with extra parameters', () => {
    expect(extractYoutubeVideoId('https://www.youtube.com/watch?v=dQw4w9WgXcQ&feature=emb_rel_pause')).toBe('dQw4w9WgXcQ');
  });
  it('extracts from /watch/ URL format', () => {
    expect(extractYoutubeVideoId('https://www.youtube.com/watch/abc12345678')).toBe('abc12345678');
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

  it('extracts from /watch/ path with multiple query parameters', () => {
    expect(extractYoutubeVideoId('https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=120&feature=share')).toBe('dQw4w9WgXcQ');
  });
});
