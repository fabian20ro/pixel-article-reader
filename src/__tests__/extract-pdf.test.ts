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

  it('should handle multiple items on the same line', () => {
    const items = [
      { str: 'Word 1', transform: [1, 0, 0, 1, 0, 700], height: 12 },
      { str: 'Word 2', transform: [1, 0, 0, 1, 0, 700], height: 12 },
      { str: 'Word 3', transform: [1, 0, 0, 1, 0, 650], height: 12 } // gap 50 > 27
    ];
    expect(extractParagraphsFromTextItems(items)).toEqual(['Word 1 Word 2', 'Word 3']);
  });

  it('should handle multiple lines with a hyphenated word in the middle', () => {
    const items = [
      { str: 'This is a long-', transform: [1, 0, 0, 1, 0, 700], height: 12 },
      { str: 'word that spans lines', transform: [1, 0, 0, 1, 0, 690], height: 12 },
      { str: 'on a new line', transform: [1, 0, 0, 1, 0, 680], height: 12 },
      { str: 'next paragraph', transform: [1, 0, 0, 1, 0, 600], height: 12 }
    ];
    expect(extractParagraphsFromTextItems(items)).toEqual([
      'This is a long word that spans lines on a new line',
      'next paragraph'
    ]);
  });

  it('should handle multiple lines with varying heights on the same line', () => {
    const items = [
      { str: 'Line 1', transform: [1, 0, 0, 1, 0, 700], height: 20 },
      { str: 'Line 2', transform: [1, 0, 0, 1, 0, 650], height: 10 },
      { str: 'Line 3', transform: [1, 0, 0, 1, 0, 640], height: 10 }
    ];
    // gap 1: |700-650|=50. threshold=30. 50 > 30 -> new para.
    // gap 2: |650-640|=10. threshold=15. 10 < 15 -> same para.
    expect(extractParagraphsFromTextItems(items)).toEqual(['Line 1', 'Line 2 Line 3']);
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

  it('should handle items with zero height', () => {
    const items = [
      { str: 'Para 1', transform: [1, 0, 0, 1, 0, 700], height: 0 },
      { str: 'Para 2', transform: [1, 0, 0, 1, 0, 650], height: 12 }
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

  it('should respect the paragraph boundary threshold', () => {
    const items = [
      { str: 'Para 1', transform: [1, 0, 0, 1, 0, 700], height: 12 },
      { str: 'Para 2', transform: [1, 0, 0, 1, 0, 673], height: 12 }, // gap 27 (threshold 27)
      { str: 'Para 3', transform: [1, 0, 0, 1, 0, 645], height: 12 }, // gap 28 (threshold 27)
    ];
    expect(extractParagraphsFromTextItems(items)).toEqual(['Para 1 Para 2', 'Para 3']);
  });

  it('should handle a single hyphen as a text item', () => {
    const items = [
      { str: 'Hello', transform: [1, 0, 0, 1, 0, 700], height: 12 },
      { str: '-', transform: [1, 0, 0, 1, 0, 690], height: 12 },
      { str: 'world', transform: [1, 0, 0, 1, 0, 680], height: 12 }
    ];
    expect(extractParagraphsFromTextItems(items)).toEqual(['Hello world']);
  });






  it('should ignore items with only whitespace', () => {
    const items = [
      { str: 'Para 1', transform: [1, 0, 0, 1, 0, 700], height: 12 },
      { str: '   ', transform: [1, 0, 0, 1, 0, 650], height: 12 },
      { str: 'Para 2', transform: [1, 0, 0, 1, 0, 600], height: 12 }
    ];
    expect(extractParagraphsFromTextItems(items)).toEqual(['Para 1', 'Para 2']);
  });

  it('should handle a hyphenated word at the start of a line', () => {
    const items = [
      { str: 'Part', transform: [1, 0, 0, 1, 0, 700], height: 12 },
      { str: '-part', transform: [1, 0, 0, 1, 0, 690], height: 12 }
    ];
    expect(extractParagraphsFromTextItems(items)).toEqual(['Part -part']);
  });

  it('should handle multiple lines where each line ends with a hyphen', () => {
    const items = [
      { str: 'This is a long-', transform: [1, 0, 0, 1, 0, 700], height: 12 },
      { str: 'line-break-', transform: [1, 0, 0, 1, 0, 690], height: 12 },
      { str: 'test', transform: [1, 0, 0, 1, 0, 680], height: 12 }
    ];
    expect(extractParagraphsFromTextItems(items)).toEqual(['This is a long line-break test']);
  });

  it('should handle multiple hyphenated words in a single paragraph', () => {
    const items = [
      { str: 'a-', transform: [1, 0, 0, 1, 0, 700], height: 12 },
      { str: 'b-', transform: [1, 0, 0, 1, 0, 690], height: 12 },
      { str: 'c', transform: [1, 0, 0, 1, 0, 680], height: 12 }
    ];
    expect(extractParagraphsFromTextItems(items)).toEqual(['a b c']);
  });

  it('should not have a leading space when the first item is a single hyphen', () => {
    const items = [
      { str: '-', transform: [1, 0, 0, 1, 0, 700], height: 12 },
      { str: 'world', transform: [1, 0, 0, 1, 0, 690], height: 12 }
    ];
    expect(extractParagraphsFromTextItems(items)).toEqual(['world']);
  });

  it('should not have a leading space when the first item is a single hyphen', () => {
    const items = [
      { str: '-', transform: [1, 0, 0, 1, 0, 700], height: 12 },
      { str: 'world', transform: [1, 0, 0, 1, 0, 690], height: 12 }
    ];
    expect(extractParagraphsFromTextItems(items)).toEqual(['world']);
  });
});
