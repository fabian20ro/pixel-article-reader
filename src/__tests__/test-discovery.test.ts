import { describe, it, expect } from 'vitest';
import { extractParagraphsFromTextItems } from '../lib/extractor.js';

describe('extractParagraphsFromTextItems', () => {
  it('splits paragraphs when gap is large', () => {
    const items = [
      { str: 'Paragraph 1', transform: [1, 0, 0, 1, 12, 100], height: 12 },
      { str: 'Paragraph 2', transform: [1, 0, 0, 1, 12, 50], height: 12 },
    ] as any;
    const result = extractParagraphsFromTextItems(items);
    expect(result).toEqual(['Paragraph 1', 'Paragraph 2']);
  });

  it('joins items when gap is small', () => {
    const items = [
      { str: 'Part 1', transform: [1, 0, 0, 1, 12, 100], height: 12 },
      { str: 'Part 2', transform: [1, 0, 0, 1, 12, 95], height: 12 },
    ] as any;
    const result = extractParagraphsFromTextItems(items);
    expect(result).toEqual(['Part 1 Part 2']);
  });

  it('handles complex spacing', () => {
    const items = [
      { str: 'Part 1', transform: [1, 0, 0, 1, 12, 100], height: 12 },
      { str: 'Part 2', transform: [1, 0, 0, 1, 12, 82], height: 12 },
      { str: 'Part 3', transform: [1, 0, 0, 1, 12, 50], height: 12 },
    ] as any;
    const result = extractParagraphsFromTextItems(items);
    expect(result).toEqual(['Part 1 Part 2', 'Part 3']);
  });

  it('joins hyphenated words with a space', () => {
    const items = [
      { str: 'Part 1-', transform: [1, 0, 0, 1, 12, 100], height: 12 },
      { str: 'else', transform: [1, 0, 0, 1, 12, 95], height: 12 },
    ] as any;
    const result = extractParagraphsFromTextItems(items);
    expect(result).toEqual(['Part 1 else']);
  });

  it('returns empty array for no items', () => {
    const items = [] as any[];
    const result = extractParagraphsFromTextItems(items);
    expect(result).toEqual([]);
  });

  it('returns a single paragraph for one item', () => {
    const items = [
      { str: 'Single piece of text', transform: [1, 0, 0, 1, 12, 100], height: 12 },
    ] as any;
    const result = extractParagraphsFromTextItems(items);
    expect(result).toEqual(['Single piece of text']);
  });

  it('merges items at identical y-coordinates into one paragraph', () => {
    const items = [
      { str: 'Line A', transform: [1, 0, 0, 1, 0, 50], height: 12 },
      { str: 'Line B', transform: [1, 0, 0, 1, 0, 50], height: 12 },
      { str: 'Line C', transform: [1, 0, 0, 1, 0, 50], height: 12 },
    ] as any;
    const result = extractParagraphsFromTextItems(items);
    expect(result).toEqual(['Line A Line B Line C']);
  });

  it('skips whitespace-only items without breaking subsequent paragraphs', () => {
    const items = [
      { str: 'Para A', transform: [1, 0, 0, 1, 0, 100], height: 12 },
      { str: '', transform: [1, 0, 0, 1, 0, 98], height: 12 },
      { str: '   ', transform: [1, 0, 0, 1, 0, 96], height: 12 },
      { str: 'Para B', transform: [1, 0, 0, 1, 0, 50], height: 12 },
    ] as any;
    const result = extractParagraphsFromTextItems(items);
    expect(result).toEqual(['Para A', 'Para B']);
  });

  it('handles hyphenated words followed by non-hyphened continuation in the same paragraph', () => {
    const items = [
      { str: 'long-', transform: [1, 0, 0, 1, 0, 100], height: 12 },
      { str: 'word', transform: [1, 0, 0, 1, 0, 98], height: 12 },
      { str: 'continued', transform: [1, 0, 0, 1, 0, 96], height: 12 },
    ] as any;
    const result = extractParagraphsFromTextItems(items);
    expect(result).toEqual(['long word continued']);
  });

  it('returns empty array when all items are whitespace-only', () => {
    const items = [
      { str: '', transform: [1, 0, 0, 1, 0, 50], height: 12 },
      { str: '   ', transform: [1, 0, 0, 1, 0, 48], height: 12 },
    ] as any;
    const result = extractParagraphsFromTextItems(items);
    expect(result).toEqual([]);
  });

  it('uses default height when item.height is absent', () => {
    const items = [
      { str: 'Item A', transform: [1, 0, 0, 1, 0, 50] },
      { str: 'Item B', transform: [1, 0, 0, 1, 0, 10], height: 48 },
    ] as any;
    const result = extractParagraphsFromTextItems(items);
    expect(result).toEqual(['Item A', 'Item B']);
  });

  it('treats invalid transform as y=0 for gap detection', () => {
    const items = [
      { str: 'Top item', transform: [] as any, height: 12 },
      { str: 'Bottom item', transform: [1, 0, 0, 1, 0, 100], height: 12 },
    ] as any;
    const result = extractParagraphsFromTextItems(items);
    expect(result).toEqual(['Top item', 'Bottom item']);
  });
});
