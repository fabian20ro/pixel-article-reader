/**
 * Voice gender detection and filtering helpers.
 *
 * Extracted from app.ts for testability and reuse.
 */

import { SUPPORTED_LANGUAGES } from './language-config.js';
import type { TTSEngine } from './tts-engine.js';

const KNOWN_FEMALE: ReadonlySet<string> = new Set([
  'samantha', 'victoria', 'karen', 'moira', 'tessa', 'fiona', 'veena',
  'ioana', 'sara', 'paulina', 'monica', 'luciana', 'joana', 'carmit',
  'ellen', 'mariska', 'milena', 'katya', 'yelda', 'lekha', 'damayanti',
  'alice', 'amelie', 'anna', 'helena', 'nora', 'zosia', 'ting-ting',
  'sin-ji', 'mei-jia', 'yuna', 'kyoko',
  'google us english', 'google uk english female',
]);

const KNOWN_MALE: ReadonlySet<string> = new Set([
  'daniel', 'alex', 'tom', 'thomas', 'oliver', 'james', 'fred', 'ralph',
  'jorge', 'diego', 'juan', 'luca', 'xander', 'maged', 'tarik', 'rishi',
  'aaron', 'neel', 'gordon', 'lee',
  'google uk english male',
]);

/** Detect voice gender from name heuristics. Returns null if unknown. */
export function detectVoiceGender(name: string): 'male' | 'female' | null {
  const lower = name.toLowerCase();
  if (/\bfemale\b/.test(lower) || /\bwoman\b/.test(lower)) return 'female';
  if (/\bmale\b/.test(lower)) return 'male';
  const sep = /[-_]/;
  for (const n of KNOWN_FEMALE) {
    if (lower === n || lower.startsWith(n + ' ') || lower.startsWith(n + '-')) return 'female';
    // Handle suffix-style voice names: e.g. "samantha-us" or "daniel_en"
    const sIdx = lower.indexOf(n);
    if (sIdx >= 0 && sep.test(lower.charAt(sIdx + n.length))) return 'female';
  }
  for (const n of KNOWN_MALE) {
    if (lower === n || lower.startsWith(n + ' ') || lower.startsWith(n + '-')) return 'male';
    const sIdx = lower.indexOf(n);
    if (sIdx >= 0 && sep.test(lower.charAt(sIdx + n.length))) return 'male';
  }
  return null;
}

/** Get voices filtered to supported languages. */
export function getAllowedVoices(tts: TTSEngine): SpeechSynthesisVoice[] {
  return tts
    .getAvailableVoices()
    .filter((v) => SUPPORTED_LANGUAGES.some((p) => v.lang === p || v.lang.startsWith(p + '-')));
}
