import { describe, it, expect } from 'vitest';
import {
  detectLanguage,
  detectLangFromHtml,
  detectLangFromUrl,
  needsTranslation,
  getSourceLang,
} from '../lib/lang-detect.js';

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

// ── detectLangFromHtml ─────────────────────────────────────────────

describe('detectLangFromHtml', () => {
  it('normalizes "de-DE" to "de"', () => {
    expect(detectLangFromHtml('de-DE')).toBe('de');
  });

  it('normalizes "en-US" to "en"', () => {
    expect(detectLangFromHtml('en-US')).toBe('en');
  });

  it('handles simple code like "fr"', () => {
    expect(detectLangFromHtml('fr')).toBe('fr');
  });

  it('handles underscore variant "pt_BR"', () => {
    expect(detectLangFromHtml('pt_BR')).toBe('pt');
  });

  it('lowercases the result', () => {
    expect(detectLangFromHtml('DE')).toBe('de');
  });

  it('trims whitespace', () => {
    expect(detectLangFromHtml('  de  ')).toBe('de');
  });

  it('returns empty string for empty input', () => {
    expect(detectLangFromHtml('')).toBe('');
  });
});

// ── detectLangFromUrl ──────────────────────────────────────────────

describe('detectLangFromUrl', () => {
  it('detects German from .de TLD', () => {
    expect(detectLangFromUrl('https://web.de/magazine/article')).toBe('de');
  });

  it('detects French from .fr TLD', () => {
    expect(detectLangFromUrl('https://lemonde.fr/article')).toBe('fr');
  });

  it('detects English from .uk TLD', () => {
    expect(detectLangFromUrl('https://bbc.co.uk/news')).toBe('en');
  });

  it('returns empty for .com TLD', () => {
    expect(detectLangFromUrl('https://example.com/article')).toBe('');
  });

  it('returns empty for .org TLD', () => {
    expect(detectLangFromUrl('https://wikipedia.org/wiki/Test')).toBe('');
  });

  it('returns empty for .io TLD', () => {
    expect(detectLangFromUrl('https://app.io/page')).toBe('');
  });

  it('returns empty for empty URL', () => {
    expect(detectLangFromUrl('')).toBe('');
  });

  it('returns empty for invalid URL', () => {
    expect(detectLangFromUrl('not-a-url')).toBe('');
  });

  it('detects Romanian from .ro TLD', () => {
    expect(detectLangFromUrl('https://digi24.ro/stiri/test')).toBe('ro');
  });
});

// ── needsTranslation ───────────────────────────────────────────────

describe('needsTranslation', () => {
  it('returns false for English htmlLang', () => {
    expect(needsTranslation('en', 'https://example.com/article')).toBe(false);
  });

  it('returns false for English with region code in htmlLang', () => {
    expect(needsTranslation('en-US', 'https://example.com/article')).toBe(false);
  });

  it('returns false for Romanian htmlLang', () => {
    expect(needsTranslation('ro', 'https://example.com/article')).toBe(false);
  });

  it('returns true for German htmlLang', () => {
    expect(needsTranslation('de', 'https://example.com/article')).toBe(true);
  });

  it('returns true for French htmlLang', () => {
    expect(needsTranslation('fr-FR', 'https://example.com/article')).toBe(true);
  });

  it('returns false for English URL TLD when htmlLang is empty', () => {
    expect(needsTranslation('', 'https://bbc.co.uk/news')).toBe(false);
  });

  it('returns false for Romanian URL TLD when htmlLang is empty', () => {
    expect(needsTranslation('', 'https://digi24.ro/stiri')).toBe(false);
  });

  it('returns true for German URL TLD when htmlLang is empty', () => {
    expect(needsTranslation('', 'https://web.de/magazine')).toBe(true);
  });

  it('returns false when textLang is ro and no other signals', () => {
    expect(needsTranslation('', '', 'ro')).toBe(false);
  });

  it('defaults to true (needs translation) with no signals', () => {
    expect(needsTranslation('', '', 'en')).toBe(true);
  });

  it('defaults to true with no signals at all', () => {
    expect(needsTranslation('', '')).toBe(true);
  });

  it('htmlLang takes priority over URL TLD', () => {
    // English htmlLang on a .de domain → no translation needed
    expect(needsTranslation('en', 'https://web.de/article')).toBe(false);
  });
});

// ── getSourceLang ──────────────────────────────────────────────────

describe('getSourceLang', () => {
  it('returns language from htmlLang when available', () => {
    expect(getSourceLang('de-DE', 'https://example.com/article')).toBe('de');
  });

  it('falls back to URL TLD when htmlLang is empty', () => {
    expect(getSourceLang('', 'https://web.de/article')).toBe('de');
  });

  it('returns auto when no signals available', () => {
    expect(getSourceLang('', 'https://example.com/article')).toBe('auto');
  });

  it('returns auto when URL is empty', () => {
    expect(getSourceLang('', '')).toBe('auto');
  });
});
