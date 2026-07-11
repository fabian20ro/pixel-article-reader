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

  it('uses character-count fallback when word count is below threshold but chars are sufficient', () => {
    // Two valid tokens (wordCount=2 < 3) triggers the char-count fallback;
    // stripped characters "abcd" has length 4 >= 4, so returns true.
    expect(isSpeakableText('ab cd')).toBe(true);
  });

  it('returns false when word count is below threshold and chars are insufficient', () => {
    // Two valid tokens (wordCount=2 < 3), but only "a" left after stripping punctuation — charCount=1 < 4.
    expect(isSpeakableText('a b!')).toBe(false);
  });

  it('treats strings with digits as speakable', () => {
    // Digits count toward wordCount via the /[a-zA-Z0-9]/ check.
    expect(isSpeakableText('Version 2 is out.')).toBe(true);
  });

  it('returns false for a single-character string', () => {
    expect(isSpeakableText('X')).toBe(false);
    expect(isSpeakableText('5')).toBe(false);
  });

  it('treats HTML-like strings with embedded alphanumeric content as speakable', () => {
    // isSpeakableText receives plain text only after stripNonTextContent pre-strips tags.
    // If raw HTML reaches this function, the tag body letters (e.g., "img", "br") count toward wordCount.
    expect(isSpeakableText('<img><br>')).toBe(true);
  });

  it('returns true for a long string with only one valid word', () => {
    // After whitespace split: ["a", "b", "c"] → wordCount=3 (each token has >=2 chars with alnum), so direct pass.
    expect(isSpeakableText('x'.repeat(10) + ' y'.repeat(10))).toBe(true);
  });

  it('returns true for a string whose only long token is digits', () => {
    // wordCount=1 (<3), triggers char fallback; stripped "1234567890" ≥ 4 → true.
    expect(isSpeakableText('1234567890')).toBe(true);
  });

  it('returns false for a short digit-only string', () => {
    // wordCount=1 (<3), char fallback: stripped "12" length=2 < 4 → false.
    expect(isSpeakableText('12')).toBe(false);
  });

  it('handles whitespace-heavy strings correctly', () => {
    const text = '   hello world this is a test of the speakability check function   ';
    expect(isSpeakableText(text)).toBe(true);
  });

  it('returns false for punctuation-only string longer than minimum length', () => {
    // No alphanumeric tokens survive the wordCount filter; char fallback stripped = '' → false.
    expect(isSpeakableText('!!! ???? ....')).toBe(false);
  });
});
