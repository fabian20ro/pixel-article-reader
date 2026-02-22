import type { Language } from './lang-detect.js';

export interface AppSettings {
  rate: number;
  lang: 'auto' | Language;
  voiceName: string;
  wakeLock: boolean;
}

export interface SettingsDefaults {
  defaultRate: number;
  defaultLang: 'auto' | Language;
}

const STORAGE_KEY = 'articlevoice-settings';

function isLanguage(value: unknown): value is Language {
  return value === 'en' || value === 'ro';
}

function clampRate(rate: unknown, fallback: number): number {
  if (typeof rate !== 'number' || Number.isNaN(rate)) return fallback;
  return Math.max(0.5, Math.min(3.0, rate));
}

function toLang(value: unknown, fallback: 'auto' | Language): 'auto' | Language {
  if (value === 'auto' || isLanguage(value)) return value;
  return fallback;
}

export function createDefaultSettings(defaults: SettingsDefaults): AppSettings {
  return {
    rate: defaults.defaultRate,
    lang: defaults.defaultLang,
    voiceName: '',
    wakeLock: true,
  };
}

export function loadSettings(defaults: SettingsDefaults): AppSettings {
  const fallback = createDefaultSettings(defaults);

  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return fallback;

    const parsed = JSON.parse(raw) as Partial<AppSettings>;
    return {
      rate: clampRate(parsed.rate, fallback.rate),
      lang: toLang(parsed.lang, fallback.lang),
      voiceName: typeof parsed.voiceName === 'string' ? parsed.voiceName : '',
      wakeLock: typeof parsed.wakeLock === 'boolean' ? parsed.wakeLock : true,
    };
  } catch {
    return fallback;
  }
}

export function saveSettings(settings: AppSettings): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
}
