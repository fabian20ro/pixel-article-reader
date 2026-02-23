/**
 * Media Session controller — keeps PWA alive in background on Android.
 *
 * Chrome on Android suspends JavaScript when a PWA goes to background,
 * which kills the speechSynthesis callback chain.  Playing an inaudible
 * <audio> track creates a real media session that Android keeps alive.
 * Registering navigator.mediaSession handlers adds lock-screen controls.
 */

export interface MediaSessionActions {
  play: () => void;
  pause: () => void;
  stop: () => void;
  nexttrack: () => void;
  previoustrack: () => void;
}

/**
 * Build a blob URL for a 1-second silent WAV (8 kHz, 8-bit, mono).
 * Sample value 128 = zero crossing in unsigned 8-bit PCM = silence.
 */
function createSilentWavUrl(): string {
  const sampleRate = 8000;
  const numSamples = sampleRate; // 1 second
  const headerSize = 44;
  const dataSize = numSamples;
  const fileSize = headerSize + dataSize;

  const buffer = new ArrayBuffer(fileSize);
  const view = new DataView(buffer);

  const writeStr = (offset: number, str: string): void => {
    for (let i = 0; i < str.length; i++) {
      view.setUint8(offset + i, str.charCodeAt(i));
    }
  };

  // RIFF header
  writeStr(0, 'RIFF');
  view.setUint32(4, fileSize - 8, true);
  writeStr(8, 'WAVE');

  // fmt chunk
  writeStr(12, 'fmt ');
  view.setUint32(16, 16, true); // chunk size
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate, true); // byte rate
  view.setUint16(32, 1, true); // block align
  view.setUint16(34, 8, true); // bits per sample

  // data chunk
  writeStr(36, 'data');
  view.setUint32(40, dataSize, true);
  new Uint8Array(buffer, headerSize).fill(128);

  return URL.createObjectURL(new Blob([buffer], { type: 'audio/wav' }));
}

export class MediaSessionController {
  private audio: HTMLAudioElement | null = null;
  private silentUrl: string | null = null;
  private actions: MediaSessionActions | null = null;

  setActions(actions: MediaSessionActions): void {
    this.actions = actions;
    this.registerHandlers();
  }

  /**
   * Start silent audio loop and set media session to "playing".
   * Must be called from a user-gesture call stack (click handler)
   * so the browser allows audio.play().
   */
  activate(title?: string): void {
    this.ensureAudio();
    if (!this.audio) return;

    Promise.resolve(this.audio.play()).catch(() => {});
    this.updateMetadata(title);
    this.setPlaybackState('playing');
  }

  /** Signal pause to OS lock screen — keeps session alive. */
  notifyPause(): void {
    this.setPlaybackState('paused');
  }

  /** Signal resume to OS lock screen and ensure audio is still running. */
  notifyResume(): void {
    if (this.audio?.paused) {
      Promise.resolve(this.audio.play()).catch(() => {});
    }
    this.setPlaybackState('playing');
  }

  /** Stop silent audio and clear media session. */
  deactivate(): void {
    if (this.audio) {
      this.audio.pause();
      this.audio.currentTime = 0;
    }
    this.setPlaybackState('none');
  }

  updateMetadata(title?: string): void {
    if (!('mediaSession' in navigator)) return;
    navigator.mediaSession.metadata = new MediaMetadata({
      title: title || 'ArticleVoice',
      artist: 'ArticleVoice',
    });
  }

  dispose(): void {
    this.deactivate();
    if (this.silentUrl) {
      URL.revokeObjectURL(this.silentUrl);
      this.silentUrl = null;
    }
    if (this.audio) {
      this.audio.remove();
      this.audio = null;
    }
  }

  private ensureAudio(): void {
    if (this.audio) return;
    this.silentUrl = createSilentWavUrl();
    this.audio = document.createElement('audio');
    this.audio.src = this.silentUrl;
    this.audio.loop = true;
  }

  private registerHandlers(): void {
    if (!('mediaSession' in navigator) || !this.actions) return;
    const ms = navigator.mediaSession;
    ms.setActionHandler('play', () => this.actions?.play());
    ms.setActionHandler('pause', () => this.actions?.pause());
    ms.setActionHandler('stop', () => this.actions?.stop());
    ms.setActionHandler('nexttrack', () => this.actions?.nexttrack());
    ms.setActionHandler('previoustrack', () => this.actions?.previoustrack());
  }

  private setPlaybackState(state: MediaSessionPlaybackState): void {
    if (!('mediaSession' in navigator)) return;
    navigator.mediaSession.playbackState = state;
  }
}
