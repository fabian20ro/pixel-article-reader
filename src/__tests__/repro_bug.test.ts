import { describe, it, expect } from 'vitest';
import { extractYoutubeVideoId } from '../lib/extractors/extract-youtube';

describe('extractYoutubeVideoId bug reproduction', () => {
  it('extracts ID even with trailing slash', () => {
    expect(extractYoutubeVideoId('https://youtu.be/abc12345678/')).toBe('abc12345678');
  });

  it('extracts ID from plain youtu.be short link', () => {
    expect(extractYoutubeVideoId('https://youtu.be/abc12345678')).toBe('abc12345678');
  });

  it('extracts ID from /watch?v= URL', () => {
    expect(extractYoutubeVideoId('https://www.youtube.com/watch?v=abc12345678')).toBe('abc12345678');
  });

  it('extracts ID from /embed/ URL', () => {
    expect(extractYoutubeVideoId('https://www.youtube.com/embed/abc12345678')).toBe('abc12345678');
  });

  it('extracts ID from /shorts/ URL', () => {
    expect(extractYoutubeVideoId('https://www.youtube.com/shorts/abc12345678')).toBe('abc12345678');
  });

  it('extracts ID from /v/ URL', () => {
    expect(extractYoutubeVideoId('https://www.youtube.com/v/abc12345678')).toBe('abc12345678');
  });

  it('extracts ID from /live/ URL', () => {
    expect(extractYoutubeVideoId('https://www.youtube.com/live/abc12345678')).toBe('abc12345678');
  });

  it('returns null for non-YouTube hostnames with no valid path', () => {
    expect(extractYoutubeVideoId('https://example.com/')).toBeNull();
  });

  it('returns null when ID is too short', () => {
    expect(extractYoutubeVideoId('https://www.youtube.com/watch?v=abc1234567')).toBeNull();
  });

  it('returns null for an unparseable URL string (catch path)', () => {
    expect(extractYoutubeVideoId('not-a-url-at-all')).toBeNull();
  });

  it('extracts ID from /watch fallback when v param is missing but path has valid ID', () => {
    expect(extractYoutubeVideoId('https://www.youtube.com/watch/abc12345678')).toBe('abc12345678');
  });

  it('returns null for invalid characters in v query param', () => {
    expect(extractYoutubeVideoId('https://www.youtube.com/watch?v=invalid!@#chars')).toBeNull();
  });
});
