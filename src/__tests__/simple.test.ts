import { describe, it, expect } from 'vitest';
import { createArticleFromText } from '../lib/extractors/extract-text.js';

describe('edge cases', () => {
  it('throws on empty', () => {
    expect(() => createArticleFromText('')).toThrow();
  });
  it('throws on whitespace', () => {
    expect(() => createArticleFromText('   ')).toThrow();
  });
  it('handles punctuation', () => {
    expect(() => createArticleFromText('!!! ??? ...')).toThrow();
  });
});
