import { describe, it, expect } from 'vitest';
import { extractParagraphsFromTextItems } from '../lib/extractors/extract-pdf';

describe('extractParagraphsFromTextItems', () => {
  it('should handle empty or whitespace-only strings', () => {
    const items = [
      { str: ' ', transform: [1, 0, 0, 1, 0, 700], height: 12 },
      { str: '', transform: [1, 0, 0, 1, 0, 650], height: 12 }
    ];
    expect(extractParagraphsFromTextItems(items)).toEqual([]);
  });


  it('should extract single paragraph', () => {
    const items = [
      { str: 'Hello world', transform: [1, 0, 0, 1, 0, 700], height: 12 }
    ];
    expect(extractParagraphsFromTextItems(items)).toEqual(['Hello world']);
  });

  it('should split paragraphs based on vertical gap', () => {
    const items = [
      { str: 'First paragraph', transform: [1, 0, 0, 1, 0, 700], height: 12 },
      { str: 'Second paragraph', transform: [1, 0, 0, 1, 0, 650], height: 12 } // gap 50 > 27
    ];
    expect(extractParagraphsFromTextItems(items)).toEqual(['First paragraph', 'Second paragraph']);
  });

  it('should handle hyphenated line breaks', () => {
    const items = [
      { str: 'This is a long-', transform: [1, 0, 0, 1, 0, 700], height: 12 },
      { str: 'word', transform: [1, 0, 0, 1, 0, 690], height: 12 } // gap 10 <= 27
    ];
    expect(extractParagraphsFromTextItems(items)).toEqual(['This is a long word']);
  });

  it('should handle " - " hyphenation', () => {
    const items = [
      { str: 'This is a long -', transform: [1, 0, 0, 1, 0, 700], height: 12 },
      { str: 'word', transform: [1, 0, 0, 1, 0, 690], height: 12 }
    ];
    expect(extractParagraphsFromTextItems(items)).toEqual(['This is a long word']);
  });

  it('should handle line spacing accurately', () => {
    const items = [
      { str: 'Line 1', transform: [1, 0, 0, 1, 0, 700], height: 12 },
      { str: 'Line 2', transform: [1, 0, 0, 1, 0, 675], height: 12 }, // gap 25 <= 27
      { str: 'Line 3', transform: [1, 0, 0, 1, 0, 650], height: 12 } // gap 25 <= 27
    ];
    expect(extractParagraphsFromTextItems(items)).toEqual(['Line 1 Line 2 Line 3']);
  });

  it('should handle large gaps between paragraphs', () => {
    const items = [
      { str: 'Para 1', transform: [1, 0, 0, 1, 0, 700], height: 12 },
      { str: 'Para 2', transform: [1, 0, 0, 1, 0, 600], height: 12 } // gap 100 > 27
    ];
    expect(extractParagraphsFromTextItems(items)).toEqual(['Para 1', 'Para 2']);
  });

  it('should handle empty strings in items', () => {
    const items = [
      { str: 'Para 1', transform: [1, 0, 0, 1, 0, 700], height: 12 },
      { str: '', transform: [1, 0, 0, 1, 0, 673], height: 12 },
      { str: 'Para 2', transform: [1, 0, 0, 1, 0, 600], height: 12 }
    ];
    expect(extractParagraphsFromTextItems(items)).toEqual(['Para 1', 'Para 2']);
  });
});
