/**
 * TTS Engine — audio-based TTS via Cloudflare Worker, speechSynthesis fallback.
 *
 * Key design decisions:
 *  - Primary: fetch MP3 audio per sentence from Worker (?action=tts) and play
 *    through an <audio> element.  Audio elements survive Android backgrounding.
 *  - Fallback: Web Speech API speechSynthesis (foreground-only, used when
 *    audio fetch fails).
 *  - Each sentence becomes one audio fetch / utterance to keep chunks short.
 *  - Pre-fetches next 2 sentences while current one plays.
 *  - Dead-man's switch auto-stops after 30 s of no audible progress.
 */

import type { Language } from './lang-detect.js';
import { MediaSessionController } from './media-session.js';
import { fetchTtsAudio, type TtsAudioFetcherConfig } from './tts-audio-fetcher.js';

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

export interface TTSConfig {
  proxyBase: string;
  proxySecret: string;
  callbacks?: TTSCallbacks;
}

// ── Sentence splitting ────────────────────────────────────────────────

const MIN_SENTENCE_LENGTH = 40;
const MAX_UTTERANCE_LENGTH = 200;

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

export function splitSentences(text: string): string[] {
  const raw = text.match(/[^.!?]*[.!?]+[\s]?|[^.!?]+$/g);
  if (!raw) return [text];
  const pieces = raw.map((s) => s.trim()).filter((s) => s.length > 0);
  return mergeShortSentences(pieces);
}

// ── Voice helpers (kept for speechSynthesis fallback + voice UI) ──────

function langToCode(lang: Language): string {
  return lang === 'ro' ? 'ro' : 'en';
}

function langMatches(voiceLang: string, prefix: string): boolean {
  return voiceLang === prefix || voiceLang.startsWith(prefix + '-');
}

function waitForVoices(timeout = 3000): Promise<SpeechSynthesisVoice[]> {
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
    setTimeout(() => {
      speechSynthesis.removeEventListener('voiceschanged', onVoices);
      resolve(speechSynthesis.getVoices());
    }, timeout);
  });
}

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
  const enhanced = matching.filter((v) => /google|enhanced|premium/i.test(v.name));
  if (enhanced.length > 0) return enhanced[0];
  if (matching.length > 0) return matching[0];
  return null;
}

// ── Timeline estimation ───────────────────────────────────────────────

const CHARS_PER_SEC_AT_1X = 14;

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

// ── Dead-man's switch ─────────────────────────────────────────────────

/** Auto-stop if no audible progress for this many milliseconds. */
const DEAD_MAN_TIMEOUT_MS = 30_000;
const DEAD_MAN_CHECK_MS = 5_000;

// ── TTSEngine ─────────────────────────────────────────────────────────

export class TTSEngine {
  private paragraphs: string[][] = [];
  private rawParagraphs: string[] = [];
  private lang: Language = 'en';
  private rate = 1.0;
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

  // Generation counter — incremented before every cancel to invalidate stale callbacks.
  private _speakGen = 0;

  // Audio-based TTS
  private audioConfig: TtsAudioFetcherConfig | null = null;
  private ttsAudio: HTMLAudioElement | null = null;
  private audioCache = new Map<string, Promise<string | null>>();

  // Dead-man's switch: auto-stop if no progress for 30 s
  private _lastProgressTime = 0;
  private _deadManTimer: ReturnType<typeof setInterval> | null = null;

  // speechSynthesis fallback resume watchdog
  private resumeTimer: ReturnType<typeof setTimeout> | null = null;

  // Named handler for cleanup
  private readonly _onVisibilityChange: () => void;

  constructor(config: TTSConfig) {
    if (config.callbacks) this.cb = config.callbacks;

    if (config.proxyBase) {
      this.audioConfig = {
        proxyBase: config.proxyBase,
        proxySecret: config.proxySecret,
      };
    }

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

    this._onVisibilityChange = () => {
      if (document.visibilityState === 'hidden') {
        // Clear any pending resume watchdog — it shouldn't fire while
        // the page is backgrounded (speechSynthesis is suspended anyway).
        this.clearResumeTimer();
      } else if (document.visibilityState === 'visible' && this._isPlaying) {
        // Reset dead-man's switch so it doesn't false-trigger after the
        // browser suspended JS execution while backgrounded.
        this._lastProgressTime = Date.now();
        this.acquireWakeLock();
        if (!this._isPaused) {
          this.mediaSession.activate(this.articleTitle);
        }
      }
    };
    document.addEventListener('visibilitychange', this._onVisibilityChange);
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
    this.clearAudioCache();
    this.rawParagraphs = paragraphs;
    this.paragraphs = paragraphs.map((p) => splitSentences(p));
    this.lang = lang;
    this.articleTitle = title || '';
    this.paraIdx = 0;
    this.sentIdx = 0;
    // Reset _stopped so that a subsequent play() → speakCurrent() is not
    // short-circuited.  stop() sets _stopped = true, but after loading new
    // content the engine is in a "ready to play" state, not "stopped".
    this._stopped = false;
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
    this._lastProgressTime = Date.now();
    this.acquireWakeLock();
    this.mediaSession.activate(this.articleTitle);
    this.ensureTtsAudio();
    this.startDeadManSwitch();
    this.speakCurrent();
    this.emitState();
  }

  pause(): void {
    if (!this._isPlaying) return;
    this._isPaused = true;
    this.stopDeadManSwitch();

    if (this.ttsAudio && !this.ttsAudio.paused && this.ttsAudio.src) {
      this.ttsAudio.pause();
    } else {
      speechSynthesis.pause();
    }
    // Fully deactivate the media session so other apps (e.g. YouTube Music)
    // can reclaim audio focus without being interrupted by our silent audio loop.
    this.mediaSession.deactivate();
    this.emitState();
  }

  resume(): void {
    if (!this._isPaused) return;
    this._isPaused = false;
    this._lastProgressTime = Date.now();
    this.startDeadManSwitch();
    this.acquireWakeLock();

    if (this.ttsAudio && this.ttsAudio.src && this.ttsAudio.paused && this.ttsAudio.currentTime > 0) {
      Promise.resolve(this.ttsAudio.play()).catch(() => {});
      this.mediaSession.activate(this.articleTitle);
    } else {
      // speechSynthesis fallback resume
      speechSynthesis.resume();
      this.mediaSession.activate(this.articleTitle);
      this.clearResumeTimer();
      this.resumeTimer = setTimeout(() => {
        if (speechSynthesis.paused || (!speechSynthesis.speaking && !speechSynthesis.pending)) {
          this._speakGen++;
          speechSynthesis.cancel();
          this.speakCurrent();
        }
      }, 500);
    }
    this.emitState();
  }

  stop(): void {
    this._isPlaying = false;
    this._isPaused = false;
    this._stopped = true;
    this.clearResumeTimer();
    this.stopDeadManSwitch();
    this._speakGen++;
    this.cancelCurrentAudio();
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
    this.cancelCurrentAudio();
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
    this.cancelCurrentAudio();
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
      this._speakGen++;
      this.cancelCurrentAudio();
      speechSynthesis.cancel();
      this.sentIdx++;
    } else if (this.paraIdx < this.paragraphs.length - 1) {
      this._speakGen++;
      this.cancelCurrentAudio();
      speechSynthesis.cancel();
      this.paraIdx++;
      this.sentIdx = 0;
      this.emitParagraphChange();
    } else {
      return;
    }
    if (this._isPlaying && !this._isPaused) {
      this.speakCurrent();
    }
    this.emitState();
  }

  skipSentenceBackward(): void {
    if (this.paragraphs.length === 0) return;
    if (this.sentIdx > 0) {
      this._speakGen++;
      this.cancelCurrentAudio();
      speechSynthesis.cancel();
      this.sentIdx--;
    } else if (this.paraIdx > 0) {
      this._speakGen++;
      this.cancelCurrentAudio();
      speechSynthesis.cancel();
      this.paraIdx--;
      this.sentIdx = this.paragraphs[this.paraIdx].length - 1;
      this.emitParagraphChange();
    } else {
      return;
    }
    if (this._isPlaying && !this._isPaused) {
      this.speakCurrent();
    }
    this.emitState();
  }

  seekToTime(seconds: number): void {
    if (this.paragraphs.length === 0) return;
    const targetChars = seconds * CHARS_PER_SEC_AT_1X * this.rate;
    let accumulated = 0;

    for (let p = 0; p < this.paragraphs.length; p++) {
      for (let s = 0; s < this.paragraphs[p].length; s++) {
        accumulated += this.paragraphs[p][s].length;
        if (accumulated >= targetChars) {
          this._speakGen++;
          this.cancelCurrentAudio();
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
    this.jumpToParagraph(this.paragraphs.length - 1);
  }

  jumpToParagraph(index: number): void {
    if (index < 0 || index >= this.paragraphs.length) return;
    this._speakGen++;
    this.cancelCurrentAudio();
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
    if (this.ttsAudio) {
      this.ttsAudio.playbackRate = this.rate;
    }
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

  /** Clean up all resources. Call on page unload. */
  dispose(): void {
    this.stop();
    this.clearAudioCache();
    document.removeEventListener('visibilitychange', this._onVisibilityChange);
    if (this.ttsAudio) {
      this.ttsAudio.remove();
      this.ttsAudio = null;
    }
    this.mediaSession.dispose();
  }

  // ── Internal: Audio-based TTS ───────────────────────────────────

  private ensureTtsAudio(): void {
    if (this.ttsAudio) return;
    this.ttsAudio = document.createElement('audio');
    this.ttsAudio.setAttribute('playsinline', '');
    document.body.appendChild(this.ttsAudio);
  }

  private cancelCurrentAudio(): void {
    if (this.ttsAudio) {
      this.ttsAudio.onended = null;
      this.ttsAudio.onerror = null;
      this.ttsAudio.pause();
      this.ttsAudio.removeAttribute('src');
      this.ttsAudio.load();
    }
  }

  private fetchSentenceAudio(text: string): Promise<string | null> {
    if (!this.audioConfig) return Promise.resolve(null);
    const key = `${this.lang}:${text}`;
    const cached = this.audioCache.get(key);
    if (cached) return cached;
    const promise = fetchTtsAudio(text, langToCode(this.lang), this.audioConfig);
    this.audioCache.set(key, promise);
    return promise;
  }

  private prefetchUpcoming(): void {
    if (!this.audioConfig) return;
    let p = this.paraIdx;
    let s = this.sentIdx + 1;
    let count = 0;

    while (count < 2 && p < this.paragraphs.length) {
      if (s >= this.paragraphs[p].length) {
        p++;
        s = 0;
        continue;
      }
      const text = this.paragraphs[p][s];
      this.fetchSentenceAudio(text); // fire-and-forget, caches the promise
      s++;
      count++;
    }
  }

  private clearAudioCache(): void {
    for (const p of this.audioCache.values()) {
      p.then((url) => {
        if (url) URL.revokeObjectURL(url);
      });
    }
    this.audioCache.clear();
  }

  // ── Internal: speak orchestrator ────────────────────────────────

  private speakCurrent(): void {
    if (this._stopped) return;
    if (this.paraIdx >= this.paragraphs.length) {
      this.handleEnd();
      return;
    }

    const sentences = this.paragraphs[this.paraIdx];
    if (this.sentIdx >= sentences.length) {
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

    if (this.sentIdx === 0) {
      this.emitParagraphChange();
    }

    // Pre-fetch upcoming sentences
    this.prefetchUpcoming();

    // Try audio-based TTS first (works in background)
    if (this.audioConfig) {
      const gen = this._speakGen;
      this.fetchSentenceAudio(text).then((audioUrl) => {
        if (gen !== this._speakGen || this._stopped) {
          if (audioUrl) URL.revokeObjectURL(audioUrl);
          return;
        }
        if (audioUrl) {
          this.playTtsAudio(audioUrl, gen);
        } else {
          // Audio fetch failed — fall back to speechSynthesis
          this.speakViaSpeechSynthesis(text, gen);
        }
      });
      this.emitProgress();
      return;
    }

    // No audio config — use speechSynthesis directly
    const gen = this._speakGen;
    this.speakViaSpeechSynthesis(text, gen);
    this.emitProgress();
  }

  private playTtsAudio(url: string, gen: number): void {
    this.ensureTtsAudio();
    if (!this.ttsAudio) return;

    this.ttsAudio.src = url;
    this.ttsAudio.playbackRate = this.rate;

    this.ttsAudio.onended = () => {
      URL.revokeObjectURL(url);
      if (this._stopped || gen !== this._speakGen) return;
      this._lastProgressTime = Date.now();
      this.sentIdx++;
      this.emitProgress();
      this.speakCurrent();
    };

    this.ttsAudio.onerror = () => {
      URL.revokeObjectURL(url);
      if (this._stopped || gen !== this._speakGen) return;
      // Fall back to speechSynthesis for this sentence
      const text = this.paragraphs[this.paraIdx]?.[this.sentIdx];
      if (text) this.speakViaSpeechSynthesis(text, gen);
    };

    Promise.resolve(this.ttsAudio.play()).catch(() => {
      URL.revokeObjectURL(url);
      if (this._stopped || gen !== this._speakGen) return;
      const text = this.paragraphs[this.paraIdx]?.[this.sentIdx];
      if (text) this.speakViaSpeechSynthesis(text, gen);
    });
  }

  private speakViaSpeechSynthesis(text: string, gen: number): void {
    const utter = new SpeechSynthesisUtterance(text);
    utter.rate = this.rate;
    utter.lang = langToCode(this.lang);
    if (this.voice) utter.voice = this.voice;

    utter.onend = () => {
      if (this._stopped || gen !== this._speakGen) return;
      this._lastProgressTime = Date.now();
      this.sentIdx++;
      this.emitProgress();
      this.speakCurrent();
    };

    utter.onerror = (ev) => {
      if (ev.error === 'interrupted' || ev.error === 'canceled') return;
      this.cb.onError?.(`TTS error: ${ev.error}`);
    };

    speechSynthesis.speak(utter);
  }

  // ── Internal: lifecycle ─────────────────────────────────────────

  private handleEnd(): void {
    this._isPlaying = false;
    this._isPaused = false;
    this._stopped = true;
    this.clearResumeTimer();
    this.stopDeadManSwitch();
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

  // ── Dead-man's switch ───────────────────────────────────────────

  private startDeadManSwitch(): void {
    this.stopDeadManSwitch();
    this._lastProgressTime = Date.now();
    this._deadManTimer = setInterval(() => {
      if (!this._isPlaying || this._isPaused || this._stopped) return;
      if (Date.now() - this._lastProgressTime > DEAD_MAN_TIMEOUT_MS) {
        this.cb.onError?.('Playback stalled — auto-stopping to save battery.');
        this.stop();
      }
    }, DEAD_MAN_CHECK_MS);
  }

  private stopDeadManSwitch(): void {
    if (this._deadManTimer !== null) {
      clearInterval(this._deadManTimer);
      this._deadManTimer = null;
    }
  }

  // ── Wake Lock ─────────────────────────────────────────────────────

  private async acquireWakeLock(): Promise<void> {
    if (!this.useWakeLock) return;
    if (!('wakeLock' in navigator)) return;
    try {
      const sentinel = await navigator.wakeLock.request('screen');
      // Guard: if stopped or paused while awaiting, release immediately
      if (this._stopped || this._isPaused) {
        sentinel.release().catch(() => {});
      } else {
        this.wakeLock = sentinel;
      }
    } catch {
      // Wake Lock request can fail (e.g., low battery mode)
    }
  }

  private releaseWakeLock(): void {
    this.wakeLock?.release().catch(() => {});
    this.wakeLock = null;
  }
}
