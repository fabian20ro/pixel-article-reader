import { beforeEach, describe, expect, it } from 'vitest';
import {
  createDefaultSettings,
  loadSettings,
  saveSettings,
  type AppSettings,
} from '../lib/settings-store.js';

const defaults = {
  defaultRate: 1,
  defaultLang: 'auto' as const,
};

function createStorageMock() {
  const map = new Map<string, string>();
  return {
    getItem: (key: string) => map.get(key) ?? null,
    setItem: (key: string, value: string) => {
      map.set(key, value);
    },
    removeItem: (key: string) => {
      map.delete(key);
    },
    clear: () => {
      map.clear();
    },
  };
}

describe('settings-store', () => {
  beforeEach(() => {
    Object.defineProperty(globalThis, 'localStorage', {
      value: createStorageMock(),
      configurable: true,
    });
    localStorage.clear();
  });

  it('returns default settings when storage is empty', () => {
    const settings = loadSettings(defaults);
    expect(settings).toEqual(createDefaultSettings(defaults));
  });

  it('returns default settings when JSON is malformed', () => {
    localStorage.setItem('articlevoice-settings', '{not-valid-json');
    const settings = loadSettings(defaults);
    expect(settings).toEqual(createDefaultSettings(defaults));
  });

  it('sanitizes invalid stored values', () => {
    localStorage.setItem(
      'articlevoice-settings',
      JSON.stringify({
        rate: 99,
        lang: 'xx',
        voiceName: 123,
        wakeLock: 'yes',
      }),
    );

    const settings = loadSettings(defaults);
    expect(settings.rate).toBe(3);
    expect(settings.lang).toBe('auto');
    expect(settings.voiceName).toBe('');
    expect(settings.wakeLock).toBe(true);
  });

  it('persists and reloads valid settings', () => {
    const expected: AppSettings = {
      rate: 1.25,
      lang: 'en',
      voiceName: 'Samantha',
      wakeLock: false,
    };

    saveSettings(expected);

    expect(loadSettings(defaults)).toEqual(expected);
  });
});
