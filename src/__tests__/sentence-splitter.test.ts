import { describe, it, expect } from 'vitest';
import { 
  mergeShortSentences, 
  splitLongSentence, 
  splitSentences 
} from '../lib/sentence-splitter';

describe('sentence-splitter', () => {
  describe('mergeShortSentences', () => {
    it('should return original if only one sentence', () => {
      expect(mergeShortSentences(['Hello.'])).toEqual(['Hello.']);
    });

    it('should merge sentences shorter than MIN_SENTENCE_LENGTH (40)', () => {
      const input = ['Short.', 'Another short one.'];
      expect(mergeShortSentences(input)).toEqual(['Short. Another short one.']);
    });

    it('should not merge sentences if the result exceeds MAX_UTTERANCE_LENGTH', () => {
      const longPart = 'A'.repeat(150);
      const input = [longPart + '.', 'Next sentence.'];
      expect(mergeShortSentences(input)).toEqual([longPart + '.', 'Next sentence.']);
    });
  });

  describe('splitLongSentence', () => {
    it('should return original if below maxLen', () => {
      const text = 'This is fine.';
      expect(splitLongSentence(text, 20)).toEqual(['This is fine.']);
    });

    it('should split at semicolons', () => {
      const text = 'Part 1; Part 2';
      expect(splitLongSentence(text, 5)).toEqual(['Part 1;', 'Part 2']);
    });

    it('should split at colons', () => {
       const text = 'Wait: here it is.';
       expect(splitLongSentence(text, 10)[0]).toBe('Wait:');
    });

    it('should split at commas if needed', () => {
       const text = 'One, two, three';
       expect(splitLongSentence(text, 5)).toEqual(['One,', 'two,', 'three']);
    });
  });

  describe('splitSentences', () => {
    it('should split basic sentences', () => {
      // Using long enough sentences to avoid merging during testing
      const text = 'This is a much longer first sentence with enough words. This is another long sentence with enough words.';
      expect(splitSentences(text)).toEqual([
        'This is a much longer first sentence with enough words.',
        'This is another long sentence with enough words.'
      ]);
    });

    it('should handle no punctuation', () => {
      const text = 'No punctuation here';
      expect(splitSentences(text)).toEqual(['No punctuation here']);
    });

    it('should handle empty string', () => {
      expect(splitSentences('')).toEqual(['']);
    });

    it('should merge very short fragments into one sentence', () => {
      const text = 'A. B. C. D.';
      expect(splitSentences(text)).toEqual(['A. B. C. D.']);
    });
  });
});
