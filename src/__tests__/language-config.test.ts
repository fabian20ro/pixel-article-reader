import { describe, it, expect } from 'vitest';
import {
  SUPPORTED_LANGUAGES,
  LANG_TTS_CODES,
  langToCode,
  isLanguage,
  DEFAULT_TRANSLATION_TARGET,
} from '../lib/language-config.js';

// ── SUPPORTED_LANGUAGES ─────────────────────────────────────────────

describe('SUPPORTED_LANGUAGES', () => {
  it('contains English and Romanian', () => {
    expect(SUPPORTED_LANGUAGES).toContain('en');
    expect(SUPPORTED_LANGUAGES).toContain('ro');
  });

  it('is a readonly tuple', () => {
    expect(SUPPORTED_LANGUAGES.length).toBe(2);
  });
});

// ── LANG_TTS_CODES ──────────────────────────────────────────────────

describe('LANG_TTS_CODES', () => {
  it('maps English to en-US', () => {
    expect(LANG_TTS_CODES.en).toBe('en-US');
  });

  it('maps Romanian to ro', () => {
    expect(LANG_TTS_CODES.ro).toBe('ro');
  });

  it('has an entry for every supported language', () => {
    for (const lang of SUPPORTED_LANGUAGES) {
      expect(LANG_TTS_CODES[lang]).toBeDefined();
    }
  });
});

// ── langToCode ──────────────────────────────────────────────────────

describe('langToCode', () => {
  it('returns "en" for English', () => {
    expect(langToCode('en')).toBe('en');
  });

  it('returns "ro" for Romanian', () => {
    expect(langToCode('ro')).toBe('ro');
  });

  // Regression: silent fallback must not change when new languages are added.
  it('falls back to "en" for any unsupported language', () => {
    expect(langToCode('fr' as Language)).toBe('en');
    expect(langToCode('de' as Language)).toBe('en');
  });
});

// ── isLanguage ──────────────────────────────────────────────────────

describe('isLanguage', () => {
  it('returns true for "en"', () => {
    expect(isLanguage('en')).toBe(true);
  });

  it('returns true for "ro"', () => {
    expect(isLanguage('ro')).toBe(true);
  });

  it('returns false for unsupported language codes', () => {
    expect(isLanguage('de')).toBe(false);
    expect(isLanguage('fr')).toBe(false);
    expect(isLanguage('ja')).toBe(false);
  });

  it('returns false for non-string values', () => {
    expect(isLanguage(null)).toBe(false);
    expect(isLanguage(undefined)).toBe(false);
    expect(isLanguage(123)).toBe(false);
    expect(isLanguage(true)).toBe(false);
    expect(isLanguage({})).toBe(false);
  });

  it('returns false for empty string', () => {
    expect(isLanguage('')).toBe(false);
  });

  it('returns false for region-tagged codes (e.g. "en-US")', () => {
    expect(isLanguage('en-US')).toBe(false);
    expect(isLanguage('ro-RO')).toBe(false);
  });
});

// ── DEFAULT_TRANSLATION_TARGET ──────────────────────────────────────

describe('DEFAULT_TRANSLATION_TARGET', () => {
  it('defaults to English', () => {
    expect(DEFAULT_TRANSLATION_TARGET).toBe('en');
  });

  it('is a supported language', () => {
    expect(isLanguage(DEFAULT_TRANSLATION_TARGET)).toBe(true);
  });
});
