/**
 * Detect paragraph boundaries from PDF text items using vertical position gaps.
 * PDF text items include position data: transform[5] is the Y coordinate.
 * A gap larger than 1.8x line height suggests a paragraph break.
 */
export function extractParagraphsFromTextItems(items: PdfJsTextItem[]): string[] {
  if (items.length === 0) return [];

  const paragraphs: string[] = [];
  let currentParagraph = '';
  let lastY: number | null = null;
  let lastHeight = 0;

  for (const item of items) {
    const text = item.str.trim();
    if (!text) continue;

    const y = item.transform[5];
    const height = item.height || 12;

    if (lastY !== null) {
      const gap = Math.abs(lastY - y);
      const lineSpacing = lastHeight * 1.5;

      if (gap > lineSpacing * 1.5) {
        // Large vertical gap — paragraph break
        if (currentParagraph.trim()) {
          paragraphs.push(currentParagraph.trim());
        }
        currentParagraph = text;
      } else {
        // Same paragraph — join with space (handle hyphenation)
        if (currentParagraph.endsWith('-')) {
          currentParagraph = currentParagraph.slice(0, -1) + text;
        } else if (currentParagraph.endsWith('- ')) {
          currentParagraph = currentParagraph.slice(0, -2) + text;
        } else {
          currentParagraph += (currentParagraph ? ' ' : '') + text;
        }
      }
    } else {
      currentParagraph = text;
    }

    lastY = y;
    lastHeight = height;
  }

  if (currentParagraph.trim()) {
    paragraphs.push(currentParagraph.trim());
  }

  return paragraphs;
}
