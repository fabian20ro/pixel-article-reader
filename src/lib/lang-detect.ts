/**
 * Lightweight language detection for English vs Romanian.
 * Uses character-based heuristics and common-word frequency.
 */

export type Language = 'en' | 'ro';

const RO_CHARS = /[ăâîșțĂÂÎȘȚ]/g;
const RO_WORDS = [
  'și', 'este', 'care', 'pentru', 'într', 'sunt',
  'acest', 'poate', 'prin', 'doar', 'mai', 'sau',
  'fost', 'avea', 'acesta', 'despre', 'când', 'toate',
  'numai', 'după', 'foarte', 'acum', 'unde',
];

/**
 * Detect whether `text` is Romanian or English.
 * Examines the first ~1 000 characters for Romanian-specific indicators.
 */
export function detectLanguage(text: string): Language {
  const sample = text.slice(0, 1000).toLowerCase();

  // Count Romanian diacritics
  const roCharMatches = sample.match(RO_CHARS);
  const roCharCount = roCharMatches ? roCharMatches.length : 0;

  // Count Romanian common words
  const roWordCount = RO_WORDS.filter((w) => {
    // Match whole word (or start of word for prefix entries like 'într')
    const re = new RegExp(`\\b${w}`, 'i');
    return re.test(sample);
  }).length;

  if (roCharCount > 3 || roWordCount > 2) return 'ro';
  return 'en';
}
