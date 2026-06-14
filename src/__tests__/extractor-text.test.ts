import { describe, it, expect } from 'vitest';
import { createArticleFromText, createArticleFromTextFile } from '../lib/extractor.js';

describe('createArticleFromText', () => {
  it('creates an article from valid text', () => {
    const text = 'This is a valid article with enough words to be processed correctly. It has multiple sentences.';
    const article = createArticleFromText(text);
    
    expect(article.title).toBe('This is a valid article with enough words to be processed correctly. It has multiple sentences.');
    expect(article.textContent).toContain('This is a valid article');
    expect(article.paragraphs.length).toBeGreaterThan(0);
  });

  it('throws error for very short text', () => {
    // 'A' is too short (charCount < 4)
    expect(() => createArticleFromText('A')).toThrow();
  });

  it('handles empty text by throwing error', () => {
    expect(() => createArticleFromText('')).toThrow();
  });
});

describe('createArticleFromTextFile', () => {
  it('creates an article from a valid file', async () => {
    const file = new File(['This is a valid article with enough words to be processed correctly.'], {
      type: 'text/plain',
    });
    const article = await createArticleFromTextFile(file);
    expect(article.title).toBe('blob');
    expect(article.wordCount).toBeGreaterThan(0);
  });

  it('throws error for too large file', async () => {
    const hugeFile = new File(['a'.repeat(3 * 1024 * 1024)], {
      type: 'text/plain',
    });
    await expect(createArticleFromTextFile(hugeFile)).rejects.toThrow('File is too large');
  });

  it('throws error for empty file', async () => {
    const emptyFile = new File([''], {
      type: 'text/plain',
    });
    await expect(createArticleFromTextFile(emptyFile)).rejects.toThrow('The text file is empty.');
  });
});
