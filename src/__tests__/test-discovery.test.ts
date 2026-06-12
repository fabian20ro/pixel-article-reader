import { describe, it, expect } from 'vitest';
import { extractParagraphsFromTextItems } from '../lib/extractor.js';

describe('extractParagraphsFromTextItems', () => {
  it('splits paragraphs when gap is large', () => {
    const items = [
      { str: 'Paragraph 1', transform: [1, 0, 0, 1, 100, 12], height: 12 },
      { str: 'Paragraph 2', transform: [1, 0, 0, 1, 50, 12], height: 12 },
    ] as any;
    const result = extractParagraphsFromTextItems(items);
    expect(result).toEqual(['Paragraph 1', 'Paragraph 2']);
  });

  it('joins items when gap is small', () => {
    const items = [
      { str: 'Part 1', transform: [1, 0, 0, 1, 100, 12], height: 12 },
      { str: 'Part 2', transform: [1, 0, 0, 1, 95, 12], height: 12 },
    ] as any;
    const result = extractParagraphsFromTextItems(items);
    expect(result).toEqual(['Part 1 Part 2']);
  });

  it('handles hyphenation', () => {
    const items = [
      { str: 'Hyphen-ated', transform: [1, 0, 0, 1, 100, 12], height: 12 },
      { str: 'word', transform: [1, 0, 0, 1, 95, 12], height: 12 },
    ] as any;
    const result = extractParagraphsFromTextItems(items);
    expect(result).toEqual(['Hyphenated word']);
  });
});
// comment
