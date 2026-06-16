import { describe, it, expect } from 'vitest';
import { isSpeakableText } from '../lib/extractors/utils.js';

describe('isSpeakableText', () => {
  it('returns true for a long paragraph', () => {
    expect(isSpeakableText('This is a normal paragraph of text that should be speakable.')).toBe(true);
  });

  it('returns false for a very short string', () => {
    expect(isSpeakableText('A')).toBe(false);
    expect(isSpeakableText('Hi')).toBe(false);
  });

  it('returns false for string with only special characters', () => {
    expect(isSpeakableText('!!! ??? ...')).toBe(false);
  });

  it('returns false for short strings with no "real" words', () => {
    expect(isSpeakableText('a b c')).toBe(false);
  });

  it('returns true for string with a few real words', () => {
    expect(isSpeakableText('The cat sat.')).toBe(true);
  });
});
