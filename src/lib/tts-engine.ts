/**
 * TTS Engine — Web Speech API wrapper with robust Android chunking.
 *
 * Key design decisions:
 *  - Each *sentence* becomes one SpeechSynthesisUtterance to avoid the
 *    15-second cutoff bug on Chrome/Android.
 *  - Sentences are enqueued one at a time via the `onend` callback chain.
 *  - Pause/resume has a fallback: if resume fails, we cancel and re-create
 *    from the same position.
 */

import type { Language } from './lang-detect.js';
import { MediaSessionController } from './media-session.js';

// ── Types ──────────────────────────────────────────────────────────────

export interface TTSState {
  isPlaying: boolean;
  isPaused: boolean;
  currentParagraph: number;
  currentSentence: number;
  totalParagraphs: number;
}

export interface TTSCallbacks {
  onStateChange?: (state: TTSState) => void;
  onProgress?: (current: number, total: number) => void;
  onParagraphChange?: (index: number, text: string) => void;
  onEnd?: () => void;
  onError?: (error: string) => void;
}

// ── Sentence splitting ────────────────────────────────────────────────

/**
 * Minimum character length for a sentence to stand alone as its own
 * utterance.  Fragments shorter than this (e.g. "Ilene S.", "Ph.", "D.")
 * are merged with the next fragment so that names and abbreviations don't
 * produce tiny utterances with unnatural pauses between them.
 */
const MIN_SENTENCE_LENGTH = 40;

/**
 * After merging short fragments we still want to stay well under the
 * ~15-second Android cutoff.  At normal speaking rate (~150 wpm) 15 s ≈
 * 37 words ≈ 200 chars.  This cap prevents over-merging.
 */
const MAX_UTTERANCE_LENGTH = 200;

/** Merge short fragments so abbreviations / names aren't separate utterances. */
function mergeShortSentences(sentences: string[]): string[] {
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

/** Split text into sentences, then merge short fragments back together. */
export function splitSentences(text: string): string[] {
  // Split on sentence-ending punctuation followed by whitespace or end-of-string.
  // Keep the punctuation with the sentence.
  const raw = text.match(/[^.!?]*[.!?]+[\s]?|[^.!?]+$/g);
  if (!raw) return [text];
  const pieces = raw.map((s) => s.trim()).filter((s) => s.length > 0);
  return mergeShortSentences(pieces);
}

// ── Voice helpers ─────────────────────────────────────────────────────

function langToCode(lang: Language): string {
  return lang === 'ro' ? 'ro' : 'en';
}

/** BCP 47 prefix match: 'en' matches 'en', 'en-US', 'en-GB' but not 'enx'. */
function langMatches(voiceLang: string, prefix: string): boolean {
  return voiceLang === prefix || voiceLang.startsWith(prefix + '-');
}

/** Wait for voices to be loaded (handles the async voiceschanged event). */
export function waitForVoices(timeout = 3000): Promise<SpeechSynthesisVoice[]> {
  return new Promise((resolve) => {
    const voices = speechSynthesis.getVoices();
    if (voices.length > 0) {
      resolve(voices);
      return;
    }
    const onVoices = () => {
      speechSynthesis.removeEventListener('voiceschanged', onVoices);
      resolve(speechSynthesis.getVoices());
    };
    speechSynthesis.addEventListener('voiceschanged', onVoices);
    // Timeout fallback
    setTimeout(() => {
      speechSynthesis.removeEventListener('voiceschanged', onVoices);
      resolve(speechSynthesis.getVoices());
    }, timeout);
  });
}

/** Pick the best voice for a language, preferring enhanced/premium voices. */
export function selectVoice(
  voices: SpeechSynthesisVoice[],
  lang: Language,
  preferred?: string,
): SpeechSynthesisVoice | null {
  const code = langToCode(lang);

  if (preferred) {
    const match = voices.find((v) => v.name === preferred && langMatches(v.lang, code));
    if (match) return match;
  }
  const matching = voices.filter((v) => langMatches(v.lang, code));

  // Prefer enhanced/premium voices (Google on Android, "Enhanced"/"Premium" on iOS/Samsung)
  const enhanced = matching.filter((v) => /google|enhanced|premium/i.test(v.name));
  if (enhanced.length > 0) return enhanced[0];

  // Any voice for the language
  if (matching.length > 0) return matching[0];

  // Absolute fallback
  return null;
}

// ── Timeline estimation ───────────────────────────────────────────────

/**
 * Approximate characters-per-second at 1× speech rate.
 * ~150 wpm × 5 chars/word ÷ 60 s ≈ 12.5.  We use 14 to account for
 * pauses between utterances being shorter than natural speech pauses.
 */
const CHARS_PER_SEC_AT_1X = 14;

/** Compute estimated duration and current position for setPositionState. */
export function computeTimeline(
  paragraphs: string[][],
  paraIdx: number,
  sentIdx: number,
  rate: number,
): { duration: number; position: number } {
  const charsPerSec = CHARS_PER_SEC_AT_1X * rate;
  let totalChars = 0;
  let currentChars = 0;

  for (let p = 0; p < paragraphs.length; p++) {
    for (let s = 0; s < paragraphs[p].length; s++) {
      const len = paragraphs[p][s].length;
      totalChars += len;
      if (p < paraIdx || (p === paraIdx && s < sentIdx)) {
        currentChars += len;
      }
    }
  }

  return {
    duration: totalChars / charsPerSec,
    position: currentChars / charsPerSec,
  };
}

// ── TTSEngine ─────────────────────────────────────────────────────────

export class TTSEngine {
  private paragraphs: string[][] = []; // paragraphs → sentences
  private rawParagraphs: string[] = [];
  private lang: Language = 'en';
  private rate = 1.0;
  private pitch = 1.0;
  private voice: SpeechSynthesisVoice | null = null;
  private allVoices: SpeechSynthesisVoice[] = [];
  private preferredVoiceName = '';

  // Position tracking
  private paraIdx = 0;
  private sentIdx = 0;

  // Playback state
  private _isPlaying = false;
  private _isPaused = false;
  private _stopped = true;

  // Wake Lock
  private wakeLock: WakeLockSentinel | null = null;
  private useWakeLock = false;

  // Media session (background audio + lock screen controls)
  private mediaSession = new MediaSessionController();
  private articleTitle = '';

  // Callbacks
  private cb: TTSCallbacks = {};

  // Generation counter — incremented before every cancel() to invalidate
  // stale onend callbacks (prevents double-advancement on skip).
  private _speakGen = 0;

  // Resume watchdog
  private resumeTimer: ReturnType<typeof setTimeout> | null = null;

  // Background TTS watchdog — periodically restarts speechSynthesis if it
  // stalled while the page was hidden (Chrome Android may silently drop
  // speak() calls made from a backgrounded page).
  private ttsWatchdogTimer: ReturnType<typeof setInterval> | null = null;

  constructor(callbacks?: TTSCallbacks) {
    if (callbacks) this.cb = callbacks;

    this.mediaSession.setActions({
      play: () => this.play(),
      pause: () => this.pause(),
      stop: () => this.stop(),
      nexttrack: () => this.skipForward(),
      previoustrack: () => this.skipBackward(),
      seekforward: () => this.skipSentenceForward(),
      seekbackward: () => this.skipSentenceBackward(),
      seekto: (seconds) => this.seekToTime(seconds),
    });

    // Handle visibility change — re-acquire wake lock (released automatically
    // when page becomes hidden per W3C spec) and resume TTS if it was killed.
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible' && this._isPlaying && !this._isPaused) {
        this.acquireWakeLock();
        // Re-ensure silent audio is still playing (Android may have paused it)
        this.mediaSession.notifyResume();
        // If synth stopped while we were in background, restart from current pos
        if (!speechSynthesis.speaking && !speechSynthesis.pending) {
          this.speakCurrent();
        }
      }
    });
  }

  // ── Public API ────────────────────────────────────────────────────

  async init(): Promise<void> {
    this.allVoices = await waitForVoices();
  }

  getAvailableVoices(): SpeechSynthesisVoice[] {
    return this.allVoices;
  }

  loadArticle(paragraphs: string[], lang: Language, title?: string): void {
    this.stop();
    this.rawParagraphs = paragraphs;
    this.paragraphs = paragraphs.map((p) => splitSentences(p));
    this.lang = lang;
    this.articleTitle = title || '';
    this.paraIdx = 0;
    this.sentIdx = 0;
    this.voice = selectVoice(this.allVoices, lang, this.preferredVoiceName);
    this.emitState();
  }

  play(): void {
    if (this.paragraphs.length === 0) return;

    if (this._isPaused) {
      this.resume();
      return;
    }

    this._isPlaying = true;
    this._isPaused = false;
    this._stopped = false;
    this.acquireWakeLock();
    this.mediaSession.activate(this.articleTitle);
    this.startTtsWatchdog();
    this.speakCurrent();
    this.emitState();
  }

  pause(): void {
    if (!this._isPlaying) return;
    this._isPaused = true;
    this.stopTtsWatchdog();
    speechSynthesis.pause();
    this.mediaSession.notifyPause();
    this.emitState();
  }

  resume(): void {
    if (!this._isPaused) return;
    this._isPaused = false;
    this.startTtsWatchdog();

    // Try native resume
    speechSynthesis.resume();
    this.mediaSession.notifyResume();

    // Watchdog: if still paused after 500 ms, cancel and re-speak
    this.clearResumeTimer();
    this.resumeTimer = setTimeout(() => {
      if (speechSynthesis.paused || (!speechSynthesis.speaking && !speechSynthesis.pending)) {
        speechSynthesis.cancel();
        this.speakCurrent();
      }
    }, 500);

    this.emitState();
  }

  stop(): void {
    this._isPlaying = false;
    this._isPaused = false;
    this._stopped = true;
    this.clearResumeTimer();
    this.stopTtsWatchdog();
    this._speakGen++;
    speechSynthesis.cancel();
    this.releaseWakeLock();
    this.mediaSession.deactivate();
    this.paraIdx = 0;
    this.sentIdx = 0;
    this.emitState();
  }

  skipForward(): void {
    if (this.paraIdx >= this.paragraphs.length - 1) return;
    this._speakGen++;
    speechSynthesis.cancel();
    this.paraIdx++;
    this.sentIdx = 0;
    this.emitParagraphChange();
    if (this._isPlaying && !this._isPaused) {
      this.speakCurrent();
    }
    this.emitState();
  }

  skipBackward(): void {
    if (this.paraIdx <= 0) return;
    this._speakGen++;
    speechSynthesis.cancel();
    this.paraIdx--;
    this.sentIdx = 0;
    this.emitParagraphChange();
    if (this._isPlaying && !this._isPaused) {
      this.speakCurrent();
    }
    this.emitState();
  }

  skipSentenceForward(): void {
    if (this.paragraphs.length === 0) return;
    const sentences = this.paragraphs[this.paraIdx];
    if (this.sentIdx < sentences.length - 1) {
      // Move to next sentence within current paragraph
      this._speakGen++;
      speechSynthesis.cancel();
      this.sentIdx++;
    } else if (this.paraIdx < this.paragraphs.length - 1) {
      // Move to first sentence of next paragraph
      this._speakGen++;
      speechSynthesis.cancel();
      this.paraIdx++;
      this.sentIdx = 0;
      this.emitParagraphChange();
    } else {
      return; // Already at last sentence of last paragraph
    }
    if (this._isPlaying && !this._isPaused) {
      this.speakCurrent();
    }
    this.emitState();
  }

  skipSentenceBackward(): void {
    if (this.paragraphs.length === 0) return;
    if (this.sentIdx > 0) {
      // Move to previous sentence within current paragraph
      this._speakGen++;
      speechSynthesis.cancel();
      this.sentIdx--;
    } else if (this.paraIdx > 0) {
      // Move to last sentence of previous paragraph
      this._speakGen++;
      speechSynthesis.cancel();
      this.paraIdx--;
      this.sentIdx = this.paragraphs[this.paraIdx].length - 1;
      this.emitParagraphChange();
    } else {
      return; // Already at first sentence of first paragraph
    }
    if (this._isPlaying && !this._isPaused) {
      this.speakCurrent();
    }
    this.emitState();
  }

  /**
   * Seek to an estimated time position (in seconds).  Reverse-maps the
   * character-count timeline to find the paragraph/sentence closest to
   * the requested time, then jumps there.
   */
  seekToTime(seconds: number): void {
    if (this.paragraphs.length === 0) return;
    const targetChars = seconds * CHARS_PER_SEC_AT_1X * this.rate;
    let accumulated = 0;

    for (let p = 0; p < this.paragraphs.length; p++) {
      for (let s = 0; s < this.paragraphs[p].length; s++) {
        accumulated += this.paragraphs[p][s].length;
        if (accumulated >= targetChars) {
          this._speakGen++;
          speechSynthesis.cancel();
          this.paraIdx = p;
          this.sentIdx = s;
          this.emitParagraphChange();
          if (this._isPlaying && !this._isPaused) {
            this.speakCurrent();
          }
          this.emitState();
          return;
        }
      }
    }
    // Past the end — jump to last paragraph
    this.jumpToParagraph(this.paragraphs.length - 1);
  }

  jumpToParagraph(index: number): void {
    if (index < 0 || index >= this.paragraphs.length) return;
    this._speakGen++;
    speechSynthesis.cancel();
    this.paraIdx = index;
    this.sentIdx = 0;
    this.emitParagraphChange();
    if (this._isPlaying && !this._isPaused) {
      this.speakCurrent();
    }
    this.emitState();
  }

  setRate(rate: number): void {
    this.rate = Math.max(0.5, Math.min(3.0, rate));
  }

  setVoice(name: string): void {
    this.preferredVoiceName = name;
    const match = this.allVoices.find((v) => v.name === name);
    if (match) this.voice = match;
  }

  setLang(lang: Language): void {
    this.lang = lang;
    this.voice = selectVoice(this.allVoices, lang, this.preferredVoiceName);
  }

  setWakeLock(enabled: boolean): void {
    this.useWakeLock = enabled;
    if (!enabled) this.releaseWakeLock();
    else if (this._isPlaying) this.acquireWakeLock();
  }

  get state(): TTSState {
    return {
      isPlaying: this._isPlaying,
      isPaused: this._isPaused,
      currentParagraph: this.paraIdx,
      currentSentence: this.sentIdx,
      totalParagraphs: this.paragraphs.length,
    };
  }

  // ── Internal ──────────────────────────────────────────────────────

  private speakCurrent(): void {
    if (this._stopped) return;
    if (this.paraIdx >= this.paragraphs.length) {
      this.handleEnd();
      return;
    }

    const sentences = this.paragraphs[this.paraIdx];
    if (this.sentIdx >= sentences.length) {
      // Move to next paragraph
      this.paraIdx++;
      this.sentIdx = 0;
      if (this.paraIdx >= this.paragraphs.length) {
        this.handleEnd();
        return;
      }
      this.emitParagraphChange();
      this.speakCurrent();
      return;
    }

    const text = sentences[this.sentIdx];
    const utter = new SpeechSynthesisUtterance(text);
    utter.rate = this.rate;
    utter.pitch = this.pitch;
    utter.lang = langToCode(this.lang);
    if (this.voice) utter.voice = this.voice;

    const gen = this._speakGen;
    utter.onend = () => {
      if (this._stopped || gen !== this._speakGen) return;
      this.sentIdx++;
      this.emitProgress();
      this.speakCurrent();
    };

    utter.onerror = (ev) => {
      // 'interrupted' and 'canceled' are normal during skip/stop
      if (ev.error === 'interrupted' || ev.error === 'canceled') return;
      this.cb.onError?.(`TTS error: ${ev.error}`);
    };

    // Emit paragraph change on first sentence of each paragraph
    if (this.sentIdx === 0) {
      this.emitParagraphChange();
    }

    speechSynthesis.speak(utter);
    this.emitProgress();
  }

  private handleEnd(): void {
    this._isPlaying = false;
    this._isPaused = false;
    this._stopped = true;
    this.stopTtsWatchdog();
    this.releaseWakeLock();
    this.mediaSession.deactivate();
    this.emitState();
    this.cb.onEnd?.();
  }

  private emitState(): void {
    this.cb.onStateChange?.(this.state);
  }

  private emitProgress(): void {
    this.cb.onProgress?.(this.paraIdx, this.paragraphs.length);
    this.updateMediaPositionState();
  }

  /** Push the estimated timeline position to the OS notification seekbar. */
  private updateMediaPositionState(): void {
    if (this.paragraphs.length === 0) return;
    const { duration, position } = computeTimeline(
      this.paragraphs,
      this.paraIdx,
      this.sentIdx,
      this.rate,
    );
    this.mediaSession.updatePositionState(duration, position, this.rate);
  }

  private emitParagraphChange(): void {
    if (this.paraIdx < this.rawParagraphs.length) {
      this.cb.onParagraphChange?.(this.paraIdx, this.rawParagraphs[this.paraIdx]);
    }
  }

  private clearResumeTimer(): void {
    if (this.resumeTimer !== null) {
      clearTimeout(this.resumeTimer);
      this.resumeTimer = null;
    }
  }

  /**
   * Start a periodic watchdog (every 3 s) that restarts the utterance chain
   * if speechSynthesis has silently stalled.  Chrome on Android may drop
   * speak() calls made while the page is hidden; this detects the stall and
   * re-invokes speakCurrent() from the same position.
   */
  private startTtsWatchdog(): void {
    this.stopTtsWatchdog();
    this.ttsWatchdogTimer = setInterval(() => {
      if (this._isPlaying && !this._isPaused && !this._stopped) {
        if (!speechSynthesis.speaking && !speechSynthesis.pending) {
          this.speakCurrent();
        }
      }
    }, 3000);
  }

  private stopTtsWatchdog(): void {
    if (this.ttsWatchdogTimer !== null) {
      clearInterval(this.ttsWatchdogTimer);
      this.ttsWatchdogTimer = null;
    }
  }

  // ── Wake Lock ─────────────────────────────────────────────────────

  private async acquireWakeLock(): Promise<void> {
    if (!this.useWakeLock) return;
    if (!('wakeLock' in navigator)) return;
    try {
      this.wakeLock = await navigator.wakeLock.request('screen');
    } catch {
      // Wake Lock request can fail (e.g., low battery mode)
    }
  }

  private releaseWakeLock(): void {
    this.wakeLock?.release().catch(() => {});
    this.wakeLock = null;
  }
}
