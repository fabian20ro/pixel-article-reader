import { describe, it, expect } from 'vitest';
import { extractYoutubeVideoId } from '../lib/extractors/extract-youtube';

describe('extractYoutubeVideoId bug reproduction', () => {
  it('extracts ID even with trailing slash', () => {
    expect(extractYoutubeVideoId('https://youtu.be/abc12345678/')).toBe('abc12345678');
  });
});
