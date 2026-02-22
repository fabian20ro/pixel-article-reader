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
// ── Sentence splitting ────────────────────────────────────────────────
/** Split text into sentences. Handles abbreviations reasonably well. */
function splitSentences(text) {
    // Split on sentence-ending punctuation followed by whitespace or end-of-string.
    // Keep the punctuation with the sentence.
    const raw = text.match(/[^.!?]*[.!?]+[\s]?|[^.!?]+$/g);
    if (!raw)
        return [text];
    return raw.map((s) => s.trim()).filter((s) => s.length > 0);
}
// ── Voice helpers ─────────────────────────────────────────────────────
function langToCode(lang) {
    return lang === 'ro' ? 'ro' : 'en';
}
/** Wait for voices to be loaded (handles the async voiceschanged event). */
export function waitForVoices(timeout = 3000) {
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
/** Pick the best voice for a language, preferring Google voices. */
export function selectVoice(voices, lang, preferred) {
    if (preferred) {
        const match = voices.find((v) => v.name === preferred);
        if (match)
            return match;
    }
    const code = langToCode(lang);
    const matching = voices.filter((v) => v.lang.startsWith(code));
    // Prefer Google enhanced / premium voices
    const google = matching.filter((v) => /google/i.test(v.name));
    if (google.length > 0)
        return google[0];
    // Any voice for the language
    if (matching.length > 0)
        return matching[0];
    // Absolute fallback
    return null;
}
// ── TTSEngine ─────────────────────────────────────────────────────────
export class TTSEngine {
    constructor(callbacks) {
        this.paragraphs = []; // paragraphs → sentences
        this.rawParagraphs = [];
        this.lang = 'en';
        this.rate = 1.0;
        this.pitch = 1.0;
        this.voice = null;
        this.allVoices = [];
        // Position tracking
        this.paraIdx = 0;
        this.sentIdx = 0;
        // Playback state
        this._isPlaying = false;
        this._isPaused = false;
        this._stopped = true;
        // Wake Lock
        this.wakeLock = null;
        this.useWakeLock = false;
        // Callbacks
        this.cb = {};
        // Resume watchdog
        this.resumeTimer = null;
        if (callbacks)
            this.cb = callbacks;
        // Handle visibility change — try to resume if TTS was killed in background
        document.addEventListener('visibilitychange', () => {
            if (document.visibilityState === 'visible' && this._isPlaying && !this._isPaused) {
                // If synth stopped while we were in background, restart from current pos
                if (!speechSynthesis.speaking && !speechSynthesis.pending) {
                    this.speakCurrent();
                }
            }
        });
    }
    // ── Public API ────────────────────────────────────────────────────
    async init() {
        this.allVoices = await waitForVoices();
    }
    getAvailableVoices() {
        return this.allVoices;
    }
    loadArticle(paragraphs, lang) {
        this.stop();
        this.rawParagraphs = paragraphs;
        this.paragraphs = paragraphs.map((p) => splitSentences(p));
        this.lang = lang;
        this.paraIdx = 0;
        this.sentIdx = 0;
        this.voice = selectVoice(this.allVoices, lang);
        this.emitState();
    }
    play() {
        if (this.paragraphs.length === 0)
            return;
        if (this._isPaused) {
            this.resume();
            return;
        }
        this._isPlaying = true;
        this._isPaused = false;
        this._stopped = false;
        this.acquireWakeLock();
        this.speakCurrent();
        this.emitState();
    }
    pause() {
        if (!this._isPlaying)
            return;
        this._isPaused = true;
        speechSynthesis.pause();
        this.emitState();
    }
    resume() {
        if (!this._isPaused)
            return;
        this._isPaused = false;
        // Try native resume
        speechSynthesis.resume();
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
    stop() {
        this._isPlaying = false;
        this._isPaused = false;
        this._stopped = true;
        this.clearResumeTimer();
        speechSynthesis.cancel();
        this.releaseWakeLock();
        this.paraIdx = 0;
        this.sentIdx = 0;
        this.emitState();
    }
    skipForward() {
        if (this.paraIdx >= this.paragraphs.length - 1)
            return;
        speechSynthesis.cancel();
        this.paraIdx++;
        this.sentIdx = 0;
        this.emitParagraphChange();
        if (this._isPlaying && !this._isPaused) {
            this.speakCurrent();
        }
        this.emitState();
    }
    skipBackward() {
        if (this.paraIdx <= 0)
            return;
        speechSynthesis.cancel();
        this.paraIdx--;
        this.sentIdx = 0;
        this.emitParagraphChange();
        if (this._isPlaying && !this._isPaused) {
            this.speakCurrent();
        }
        this.emitState();
    }
    skipSentenceForward() {
        if (this.paragraphs.length === 0)
            return;
        const sentences = this.paragraphs[this.paraIdx];
        if (this.sentIdx < sentences.length - 1) {
            // Move to next sentence within current paragraph
            speechSynthesis.cancel();
            this.sentIdx++;
        }
        else if (this.paraIdx < this.paragraphs.length - 1) {
            // Move to first sentence of next paragraph
            speechSynthesis.cancel();
            this.paraIdx++;
            this.sentIdx = 0;
            this.emitParagraphChange();
        }
        else {
            return; // Already at last sentence of last paragraph
        }
        if (this._isPlaying && !this._isPaused) {
            this.speakCurrent();
        }
        this.emitState();
    }
    skipSentenceBackward() {
        if (this.paragraphs.length === 0)
            return;
        if (this.sentIdx > 0) {
            // Move to previous sentence within current paragraph
            speechSynthesis.cancel();
            this.sentIdx--;
        }
        else if (this.paraIdx > 0) {
            // Move to last sentence of previous paragraph
            speechSynthesis.cancel();
            this.paraIdx--;
            this.sentIdx = this.paragraphs[this.paraIdx].length - 1;
            this.emitParagraphChange();
        }
        else {
            return; // Already at first sentence of first paragraph
        }
        if (this._isPlaying && !this._isPaused) {
            this.speakCurrent();
        }
        this.emitState();
    }
    jumpToParagraph(index) {
        if (index < 0 || index >= this.paragraphs.length)
            return;
        speechSynthesis.cancel();
        this.paraIdx = index;
        this.sentIdx = 0;
        this.emitParagraphChange();
        if (this._isPlaying && !this._isPaused) {
            this.speakCurrent();
        }
        this.emitState();
    }
    setRate(rate) {
        this.rate = Math.max(0.5, Math.min(3.0, rate));
    }
    setVoice(name) {
        const match = this.allVoices.find((v) => v.name === name);
        if (match)
            this.voice = match;
    }
    setLang(lang) {
        this.lang = lang;
        this.voice = selectVoice(this.allVoices, lang);
    }
    setWakeLock(enabled) {
        this.useWakeLock = enabled;
        if (!enabled)
            this.releaseWakeLock();
        else if (this._isPlaying)
            this.acquireWakeLock();
    }
    get state() {
        return {
            isPlaying: this._isPlaying,
            isPaused: this._isPaused,
            currentParagraph: this.paraIdx,
            currentSentence: this.sentIdx,
            totalParagraphs: this.paragraphs.length,
        };
    }
    // ── Internal ──────────────────────────────────────────────────────
    speakCurrent() {
        if (this._stopped)
            return;
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
        if (this.voice)
            utter.voice = this.voice;
        utter.onend = () => {
            if (this._stopped)
                return;
            this.sentIdx++;
            this.emitProgress();
            this.speakCurrent();
        };
        utter.onerror = (ev) => {
            // 'interrupted' and 'canceled' are normal during skip/stop
            if (ev.error === 'interrupted' || ev.error === 'canceled')
                return;
            this.cb.onError?.(`TTS error: ${ev.error}`);
        };
        // Emit paragraph change on first sentence of each paragraph
        if (this.sentIdx === 0) {
            this.emitParagraphChange();
        }
        speechSynthesis.speak(utter);
        this.emitProgress();
    }
    handleEnd() {
        this._isPlaying = false;
        this._isPaused = false;
        this._stopped = true;
        this.releaseWakeLock();
        this.emitState();
        this.cb.onEnd?.();
    }
    emitState() {
        this.cb.onStateChange?.(this.state);
    }
    emitProgress() {
        this.cb.onProgress?.(this.paraIdx, this.paragraphs.length);
    }
    emitParagraphChange() {
        if (this.paraIdx < this.rawParagraphs.length) {
            this.cb.onParagraphChange?.(this.paraIdx, this.rawParagraphs[this.paraIdx]);
        }
    }
    clearResumeTimer() {
        if (this.resumeTimer !== null) {
            clearTimeout(this.resumeTimer);
            this.resumeTimer = null;
        }
    }
    // ── Wake Lock ─────────────────────────────────────────────────────
    async acquireWakeLock() {
        if (!this.useWakeLock)
            return;
        if (!('wakeLock' in navigator))
            return;
        try {
            this.wakeLock = await navigator.wakeLock.request('screen');
        }
        catch {
            // Wake Lock request can fail (e.g., low battery mode)
        }
    }
    releaseWakeLock() {
        this.wakeLock?.release().catch(() => { });
        this.wakeLock = null;
    }
}
