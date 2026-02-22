import { describe, it, expect } from 'vitest';
import { detectLanguage } from '../lib/lang-detect.js';

describe('detectLanguage', () => {
  // ── English detection ───────────────────────────────────────────

  it('detects English text', () => {
    const text =
      'The quick brown fox jumps over the lazy dog. This is a sample English article about technology and science. We will explore many topics in this comprehensive guide.';
    expect(detectLanguage(text)).toBe('en');
  });

  it('detects English for a longer passage', () => {
    const text =
      'Artificial intelligence has transformed the way we interact with technology. Machine learning models can now process natural language, recognize images, and even generate creative content. The implications for society are profound and far-reaching.';
    expect(detectLanguage(text)).toBe('en');
  });

  it('defaults to English for empty text', () => {
    expect(detectLanguage('')).toBe('en');
  });

  it('defaults to English for short ambiguous text', () => {
    expect(detectLanguage('Hello world')).toBe('en');
  });

  // ── Romanian detection ──────────────────────────────────────────

  it('detects Romanian via diacritics', () => {
    const text =
      'România este o țară situată în sud-estul Europei. Capitala și cel mai mare oraș este București.';
    expect(detectLanguage(text)).toBe('ro');
  });

  it('detects Romanian via common words', () => {
    const text =
      'Acest articol este despre tehnologie și despre cum poate schimba viața pentru toți oamenii care sunt interesați.';
    expect(detectLanguage(text)).toBe('ro');
  });

  it('detects Romanian with heavy diacritics', () => {
    const text = 'Îți mulțumesc că ai venit. Această întâlnire a fost foarte importantă.';
    expect(detectLanguage(text)).toBe('ro');
  });

  it('detects Romanian with uppercase diacritics', () => {
    const text = 'BUCUREȘTI este capitala României. Țara este în Uniunea Europeană.';
    expect(detectLanguage(text)).toBe('ro');
  });

  // ── Edge cases ────────────────────────────────────────────────

  it('only examines the first ~1000 characters', () => {
    // English text padded to >1000 chars, followed by heavy Romanian
    const englishPart = 'This is English. '.repeat(70); // ~1190 chars
    const romanianPart = 'Această țară este România și sunt foarte fericit.';
    expect(detectLanguage(englishPart + romanianPart)).toBe('en');
  });

  it('detects Romanian when diacritics appear early', () => {
    const text = 'Aceasta este o întâmplare ciudată și neașteptată în orașul nostru.';
    expect(detectLanguage(text)).toBe('ro');
  });

  it('treats text with exactly 3 Romanian diacritics as English (threshold is >3)', () => {
    // Exactly 3 diacritics but no Romanian common words
    const text = 'The café résumé naïveté is wonderful and beautiful.';
    // ă, é, ë are not all Romanian diacritics — only ă counts
    // Actually café has no Romanian diacritics. Let's construct carefully:
    // We need exactly 3 hits on [ăâîșț]
    const crafted = 'Word ă word â word î and nothing else in this text about science.';
    expect(detectLanguage(crafted)).toBe('en');
  });

  it('detects Romanian when exactly 4 diacritics are present', () => {
    const text = 'Word ă word â word î word ș and nothing else here.';
    expect(detectLanguage(text)).toBe('ro');
  });
});
