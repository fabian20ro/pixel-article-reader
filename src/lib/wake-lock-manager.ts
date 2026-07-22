/**
 * Screen Wake Lock lifecycle manager.
 *
 * Extracted from TTSEngine for separation of concerns.
 * Handles acquiring and releasing the screen wake lock, with guards
 * for state changes during the async acquisition.
 */

export class WakeLockManager {
  private wakeLock: WakeLockSentinel | null = null;
  private _enabled = false;

  get enabled(): boolean {
    return this._enabled;
  }

  setEnabled(enabled: boolean): void {
    this._enabled = enabled;
    if (!enabled) this.release();
  }

  async acquire(isStillActive: () => boolean): Promise<void> {
    if (!this._enabled) return;
    if (!('wakeLock' in navigator)) return;
    try {
      const sentinel = await navigator.wakeLock.request('screen');
      // Guard: if state changed while awaiting, release immediately
      if (!isStillActive()) {
        sentinel.release().catch(() => {});
      } else {
        this.wakeLock = sentinel;
        // Browser may release the lock externally (e.g. system sleep).
        // Detect it so we don't hold a stale reference.
        sentinel.addEventListener('release', () => {
          if (this.wakeLock === sentinel) {
            this.wakeLock = null;
          }
        });
      }
    } catch {
      // Wake Lock request can fail (e.g., low battery mode)
    }
  }

  release(): void {
    this.wakeLock?.release().catch(() => {});
    this.wakeLock = null;
  }
}
