import { describe, it, expect } from 'vitest';
import { createArticleFromText, createArticleFromTextFile } from '../lib/extractor.js';

describe('createArticleFromText', () => {
  it('creates an article from valid text', () => {
    const text = 'Title Line\nThis is a valid article with enough words to be processed correctly. It has multiple sentences.';
    const article = createArticleFromText(text);
    
    expect(article.title).toBe('Title Line');
    expect(article.textContent).toContain('This is a valid article');
    expect(article.paragraphs.length).toBeGreaterThan(0);
  });

  it('throws error for very short text', () => {
    // 'A' is too short (charCount < 4)
    expect(() => createArticleFromText('A')).toThrow('Pasted text is too short to read as an article.');
  });

  it('handles empty text by throwing error', () => {
    expect(() => createArticleFromText('')).toThrow();
  });

  it('throws for single-line paste (title-only, no body)', () => {
    // Single line with no newline: the entire string becomes the title,
    // leaving zero words of body content.
    expect(() => createArticleFromText('Just one line of plain text here.')).toThrow(
      'Pasted text is too short to read as an article.',
    );
  });

  it('uses "Pasted Article" when first line exceeds 150 chars', () => {
    const title = 'x'.repeat(200);
    const body = 'This is a valid article with enough words to be processed correctly. It has multiple sentences.';
    const text = `${title}\n${body}`;
    const article = createArticleFromText(text);

    expect(article.title).toBe('Pasted Article');
    expect(article.textContent).toContain(body);
  });
});

describe('createArticleFromTextFile', () => {
  it('creates an article from a valid file', async () => {
    const file = new File(['This is a valid article with enough words to be processed correctly.'], 'test.txt', {
      type: 'text/plain',
    });
    const article = await createArticleFromTextFile(file);
    expect(article.title).toBe('test');
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
