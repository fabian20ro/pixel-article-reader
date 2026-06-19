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
  it('returns null for invalid video id', () => {
    expect(extractYoutubeVideoId('https://www.youtube.com/watch?v=short')).toBeNull();
    expect(extractYoutubeVideoId('https://www.youtube.com/watch?v=not-a-video-id-123')).toBeNull();
    expect(extractYoutubeVideoId('https://not-really-youtu.be.com/abc12345678')).toBeNull();
  });
});
