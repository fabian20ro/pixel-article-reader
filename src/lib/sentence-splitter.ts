/**
 * Sentence splitting — splits text into TTS-friendly sentence chunks.
 *
 * Extracted from tts-engine.ts for reusability and testability.
 * Pure functions with no side effects.
 */

const MIN_SENTENCE_LENGTH = 40;
const MAX_UTTERANCE_LENGTH = 200;

export function mergeShortSentences(sentences: string[]): string[] {
  if (sentences.length <= 1) return sentences;

  const merged: string[] = [];
  let current = sentences[0];

  for (let i = 1; i < sentences.length; i++) {
    const next = sentences[i];
    if (
      current.length < MIN_SENTENCE_LENGTH &&
      current.length + 1 + next.length <= MAX_UTTERANCE_LENGTH
    ) {
      current += ' ' + next;
    } else {
      merged.push(current);
      current = next;
    }
  }
  merged.push(current);

  return merged;
}

// ── Long sentence splitting ───────────────────────────────────────────

/** Delimiter tiers for splitting long sentences, from most to least natural. */
const LONG_SPLIT_DELIMITERS: RegExp[] = [
  /;\s*/,           // semicolons
  /\s[—–]\s/,      // em/en dashes with surrounding spaces
  /:\s*/,           // colons
  /,\s*/,           // commas
];

/**
 * Split a sentence exceeding maxLen at natural breakpoints.
 * Tries delimiters in priority order, falls back to word boundaries.
 */
export function splitLongSentence(sentence: string, maxLen: number): string[] {
  if (sentence.length <= maxLen) return [sentence];

  for (const delim of LONG_SPLIT_DELIMITERS) {
    const segments = splitKeepingDelimiter(sentence, delim);
    if (segments.length <= 1) continue;

    const chunks = greedyMerge(segments, maxLen);
    // Recursively split any chunks that still exceed maxLen
    const result = chunks.flatMap((c) =>
      c.length > maxLen ? splitLongSentence(c, maxLen) : [c],
    );
    if (result.length > 1) return result;
  }

  return splitAtWordBoundary(sentence, maxLen);
}

/**
 * Split text on a delimiter, keeping the delimiter attached to the
 * end of the preceding segment (natural pause point).
 */
export function splitKeepingDelimiter(text: string, delim: RegExp): string[] {
  const global = new RegExp(delim.source, 'g');
  const segments: string[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = global.exec(text)) !== null) {
    const end = match.index + match[0].length;
    const seg = text.slice(lastIndex, end).trim();
    if (seg.length > 0) segments.push(seg);
    lastIndex = end;
  }

  const tail = text.slice(lastIndex).trim();
  if (tail.length > 0) segments.push(tail);

  return segments;
}

/** Greedily merge small segments, keeping each chunk within maxLen. */
export function greedyMerge(segments: string[], maxLen: number): string[] {
  const result: string[] = [];
  let current = segments[0];

  for (let i = 1; i < segments.length; i++) {
    const candidate = current + ' ' + segments[i];
    if (candidate.length <= maxLen) {
      current = candidate;
    } else {
      result.push(current);
      current = segments[i];
    }
  }
  result.push(current);
  return result;
}

/** Hard split at word boundaries as a last resort. */
export function splitAtWordBoundary(text: string, maxLen: number): string[] {
  const words = text.split(/\s+/);
  const chunks: string[] = [];
  let current = '';

  for (const word of words) {
    if (current.length === 0) {
      current = word;
    } else if (current.length + 1 + word.length <= maxLen) {
      current += ' ' + word;
    } else {
      chunks.push(current);
      current = word;
    }
  }
  if (current.length > 0) chunks.push(current);

  return chunks;
}

export function splitSentences(text: string): string[] {
  const raw = text.match(/[^.!?]*[.!?]+[\s]?|[^.!?]+$/g);
  if (!raw) return [text];
  const pieces = raw.map((s) => s.trim()).filter((s) => s.length > 0);
  const merged = mergeShortSentences(pieces);
  return merged.flatMap((s) =>
    s.length > MAX_UTTERANCE_LENGTH ? splitLongSentence(s, MAX_UTTERANCE_LENGTH) : [s],
  );
}
