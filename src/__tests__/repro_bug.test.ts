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

  // --- error paths and fallback edge cases (recently added) ---

  it('extracts ID from youtu.be URL with fragment hash', () => {
    expect(extractYoutubeVideoId('https://youtu.be/abc12345678#t=30s')).toBe('abc12345678');
  });

  it('extracts ID from watch URL with extra query params (ignores time & list)', () => {
    expect(extractYoutubeVideoId('https://www.youtube.com/watch?v=abc12345678&t=30&list=PLx')).toBe('abc12345678');
  });

  it('extracts ID from watch URL where v param is present but pathname lacks trailing slash', () => {
    expect(extractYoutubeVideoId('https://www.youtube.com/watch?v=abc12345678')).toBe('abc12345678');
  });

  it('returns null for empty string (catch path)', () => {
    expect(extractYoutubeVideoId('')).toBeNull();
  });

  it('returns null for whitespace-only string (catch path)', () => {
    expect(extractYoutubeVideoId('   ')).toBeNull();
  });

  it('returns null when embed/shorts/live/v path has fewer than 2 segments', () => {
    expect(extractYoutubeVideoId('https://www.youtube.com/embed/')).toBeNull();
  });

  it('returns null for a valid-looking YouTube URL whose ID is too long (13 chars)', () => {
    expect(extractYoutubeVideoId('https://www.youtube.com/watch?v=abcdefghijklm')).toBeNull();
  });

  it('extracts ID from m.youtube.com watch URL', () => {
    expect(extractYoutubeVideoId('https://m.youtube.com/watch?v=abc12345678')).toBe('abc12345678');
  });

  // --- character-class edge cases for the [\w-]{11} regex ---

  it('extracts ID containing hyphens (valid YouTube format)', () => {
    expect(extractYoutubeVideoId('https://www.youtube.com/watch?v=abc-1234567')).toBe('abc-1234567');
  });

  it('extracts uppercase-alphanumeric ID (case-insensitive match)', () => {
    expect(extractYoutubeVideoId('https://youtu.be/ABCDEFghijk')).toBe('ABCDEFghijk');
  });

  it('returns null when hyphen is at a non-allowed position in the ID', () => {
    // Hyphens are valid inside [\w-], but an all-hyphen string fails length+pattern check
    expect(extractYoutubeVideoId('https://www.youtube.com/watch?v=---------')).toBeNull();
  });
});
