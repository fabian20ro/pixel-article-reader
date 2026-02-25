/**
 * speechSynthesis-based TTS backend — uses the browser's built-in
 * Web Speech API. Foreground-only on Android.
 */

import type { TTSBackend, TTSBackendCallbacks } from './tts-backend.js';

export class SpeechTTSBackend implements TTSBackend {
  private resumeTimer: ReturnType<typeof setTimeout> | null = null;
  private onErrorCb: ((msg: string) => void) | null = null;

  constructor(onError?: (msg: string) => void) {
    this.onErrorCb = onError ?? null;
  }

  speak(
    text: string,
    lang: string,
    rate: number,
    voice: SpeechSynthesisVoice | null,
    callbacks: TTSBackendCallbacks,
  ): void {
    const utter = new SpeechSynthesisUtterance(text);
    utter.rate = rate;
    utter.lang = lang;
    if (voice) utter.voice = voice;

    utter.onend = () => {
      callbacks.onEnd();
    };

    utter.onerror = (ev) => {
      if (ev.error === 'interrupted' || ev.error === 'canceled') return;
      this.onErrorCb?.(`TTS error: ${ev.error}`);
    };

    speechSynthesis.speak(utter);
  }

  pause(): void {
    speechSynthesis.pause();
  }

  resume(onNeedsRespeak: () => void): void {
    speechSynthesis.resume();
    this.clearResumeTimer();
    this.resumeTimer = setTimeout(() => {
      if (speechSynthesis.paused || (!speechSynthesis.speaking && !speechSynthesis.pending)) {
        onNeedsRespeak();
      }
    }, 500);
  }

  cancel(): void {
    this.clearResumeTimer();
    speechSynthesis.cancel();
  }

  setRate(_rate: number): void {
    // Rate is set per-utterance in speak(), nothing to do here
  }

  dispose(): void {
    this.cancel();
  }

  /** Clear the resume watchdog timer. Called by engine on visibility change. */
  clearResumeTimer(): void {
    if (this.resumeTimer !== null) {
      clearTimeout(this.resumeTimer);
      this.resumeTimer = null;
    }
  }
}
