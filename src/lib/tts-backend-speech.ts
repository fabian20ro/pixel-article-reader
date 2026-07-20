/**
 * speechSynthesis-based TTS backend — uses the browser's built-in
 * Web Speech API. Foreground-only on Android.
 */

import type { TTSBackend, TTSBackendCallbacks } from './tts-backend.js';

export class SpeechTTSBackend implements TTSBackend {
  private resumeTimer: ReturnType<typeof setTimeout> | null = null;
  private defaultRate = 1.0;

  speak(
    text: string,
    lang: string,
    rate: number,
    voice: SpeechSynthesisVoice | null,
    callbacks: TTSBackendCallbacks,
  ): void {
    const utter = new SpeechSynthesisUtterance(text);
    // Use provided rate; if zero or invalid, fall back to the last setRate() default.
    utter.rate = rate > 0 ? rate : this.defaultRate;
    utter.lang = lang;
    if (voice) utter.voice = voice;

    utter.onend = () => {
      callbacks.onEnd();
    };

    utter.onerror = (ev) => {
      if (ev.error === 'interrupted' || ev.error === 'canceled') return;
      callbacks.onError(false);
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

  setRate(rate: number): void {
    if (rate > 0) this.defaultRate = rate;
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
