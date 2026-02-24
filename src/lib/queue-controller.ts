/**
 * Queue controller — orchestrates the article queue, auto-advance,
 * and media-session integration for playlist-style playback.
 */

import type { ArticleController } from './article-controller.js';
import type { TTSEngine } from './tts-engine.js';
import type { Article } from './extractor.js';
import { isValidArticleUrl } from './url-utils.js';
import {
  loadQueue,
  saveQueue,
  addToQueue,
  removeFromQueue,
  reorderQueue,
  clearQueue,
  createQueueItem,
  type QueueItem,
} from './queue-store.js';

export interface QueueCallbacks {
  onQueueChange(items: QueueItem[], currentIndex: number): void;
  onAutoAdvanceCountdown(nextTitle: string, secondsLeft: number): void;
  onAutoAdvanceCancelled(): void;
  onError(msg: string): void;
}

export interface QueueControllerOptions {
  articleController: ArticleController;
  tts: TTSEngine;
  callbacks: QueueCallbacks;
}

const AUTO_ADVANCE_DELAY_MS = 2000;

export class QueueController {
  private items: QueueItem[];
  private currentIndex = -1;
  private autoAdvanceTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly ac: ArticleController;
  private readonly tts: TTSEngine;
  private readonly cb: QueueCallbacks;

  constructor(opts: QueueControllerOptions) {
    this.ac = opts.articleController;
    this.tts = opts.tts;
    this.cb = opts.callbacks;
    this.items = loadQueue();
  }

  // ── Accessors ───────────────────────────────────────────────────

  getItems(): QueueItem[] {
    return this.items;
  }

  getCurrentIndex(): number {
    return this.currentIndex;
  }

  getCurrentItem(): QueueItem | null {
    return this.items[this.currentIndex] ?? null;
  }

  hasNext(): boolean {
    return this.currentIndex < this.items.length - 1;
  }

  hasPrevious(): boolean {
    return this.currentIndex > 0;
  }

  getNextItem(): QueueItem | null {
    return this.items[this.currentIndex + 1] ?? null;
  }

  // ── Queue mutations ─────────────────────────────────────────────

  /** Add a freshly-extracted article to the queue. Returns the new item. */
  addArticle(article: Article): QueueItem {
    const item = createQueueItem(article);
    this.items = addToQueue(this.items, item);
    this.notify();
    return item;
  }

  /** Remove an item by id. Adjusts currentIndex if needed. */
  removeItem(id: string): void {
    const removedIdx = this.items.findIndex((i) => i.id === id);
    if (removedIdx === -1) return;

    this.items = removeFromQueue(this.items, id);

    if (removedIdx < this.currentIndex) {
      this.currentIndex--;
    } else if (removedIdx === this.currentIndex) {
      // Removed the currently playing item — stop playback
      this.tts.stop();
      this.currentIndex = -1;
    }
    this.notify();
  }

  /** Replace entire queue order. */
  reorder(newOrder: QueueItem[]): void {
    // Find where the current item ended up
    const currentId = this.getCurrentItem()?.id;
    this.items = reorderQueue(newOrder);
    if (currentId) {
      this.currentIndex = this.items.findIndex((i) => i.id === currentId);
    }
    this.notify();
  }

  /** Clear the entire queue. Stops playback. */
  clearAll(): void {
    this.tts.stop();
    this.items = [];
    this.currentIndex = -1;
    clearQueue();
    this.notify();
  }

  // ── Playback ────────────────────────────────────────────────────

  /**
   * Set an item as current (by id) and load it for playback.
   * Does NOT start playing — caller should call tts.play() after.
   */
  async playItem(id: string): Promise<void> {
    const idx = this.items.findIndex((i) => i.id === id);
    if (idx === -1) return;

    this.currentIndex = idx;
    const item = this.items[idx];
    this.notify();

    if (item.url && isValidArticleUrl(item.url)) {
      await this.ac.loadArticleFromUrl(item.url);
    }
  }

  /** Advance to the next queue item and start playing. */
  async playNext(): Promise<void> {
    if (!this.hasNext()) return;
    this.currentIndex++;
    const item = this.items[this.currentIndex];
    this.notify();

    if (item.url && isValidArticleUrl(item.url)) {
      await this.ac.loadArticleFromUrl(item.url);
      this.tts.play();
    }
  }

  /** Go back to the previous queue item and start playing. */
  async playPrevious(): Promise<void> {
    if (!this.hasPrevious()) return;
    this.currentIndex--;
    const item = this.items[this.currentIndex];
    this.notify();

    if (item.url && isValidArticleUrl(item.url)) {
      await this.ac.loadArticleFromUrl(item.url);
      this.tts.play();
    }
  }

  /**
   * Mark an item as current by matching the article URL.
   * Used when ArticleController loads an article and we need to sync queue state.
   */
  syncCurrentByUrl(url: string): void {
    const idx = this.items.findIndex((i) => i.url === url);
    if (idx !== -1) {
      this.currentIndex = idx;
      this.notify();
    }
  }

  // ── Auto-advance ───────────────────────────────────────────────

  /**
   * Called when TTSEngine.onEnd fires.
   * If there's a next item, starts the auto-advance countdown.
   */
  handleArticleEnd(): void {
    if (!this.hasNext()) return;

    const next = this.getNextItem();
    if (!next) return;

    let secondsLeft = AUTO_ADVANCE_DELAY_MS / 1000;
    this.cb.onAutoAdvanceCountdown(next.title, secondsLeft);

    this.autoAdvanceTimer = setTimeout(() => {
      this.autoAdvanceTimer = null;
      void this.playNext();
    }, AUTO_ADVANCE_DELAY_MS);
  }

  /** Cancel an in-progress auto-advance countdown. */
  cancelAutoAdvance(): void {
    if (this.autoAdvanceTimer !== null) {
      clearTimeout(this.autoAdvanceTimer);
      this.autoAdvanceTimer = null;
      this.cb.onAutoAdvanceCancelled();
    }
  }

  /** Skip the countdown and advance immediately. */
  skipToNext(): void {
    this.cancelAutoAdvance();
    void this.playNext();
  }

  // ── Share ──────────────────────────────────────────────────────

  async shareItem(item: QueueItem): Promise<void> {
    if (!item.url || !isValidArticleUrl(item.url)) return;

    try {
      if (navigator.share) {
        await navigator.share({ title: item.title, url: item.url });
      } else {
        await navigator.clipboard.writeText(item.url);
      }
    } catch {
      // Share cancelled or clipboard failed — ignore
    }
  }

  // ── Private ────────────────────────────────────────────────────

  private notify(): void {
    this.cb.onQueueChange(this.items, this.currentIndex);
  }
}
