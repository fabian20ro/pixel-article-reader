/**
 * Queue persistence — localStorage-backed article queue with schema validation.
 * Follows the same patterns as settings-store.ts (validate on load, drop corrupt entries).
 */

import { isValidArticleUrl } from './url-utils.js';
import type { Article } from './extractor.js';

export interface QueueItem {
  id: string;
  url: string;
  title: string;
  siteName: string;
  wordCount: number;
  estimatedMinutes: number;
  lang: string;
  dateAdded: number;
}

const STORAGE_KEY = 'article-reader-queue';
const MAX_QUEUE_SIZE = 50;

/** Strip HTML tags and cap string length — used for titles and site names. */
function sanitizeMetadata(value: string, maxLength: number): string {
  return value.replace(/<[^>]+>/g, '').trim().slice(0, maxLength);
}

/** Type guard: validates every field of a QueueItem read from storage. */
function isValidQueueItem(item: unknown): item is QueueItem {
  if (!item || typeof item !== 'object') return false;
  const i = item as Record<string, unknown>;
  return (
    typeof i.id === 'string' && i.id.length > 0 &&
    typeof i.url === 'string' && isValidArticleUrl(i.url) &&
    typeof i.title === 'string' &&
    typeof i.siteName === 'string' &&
    typeof i.wordCount === 'number' && Number.isFinite(i.wordCount) &&
    typeof i.estimatedMinutes === 'number' && Number.isFinite(i.estimatedMinutes) &&
    typeof i.lang === 'string' &&
    typeof i.dateAdded === 'number' && Number.isFinite(i.dateAdded)
  );
}

/** Load queue from localStorage, dropping any corrupt entries. */
export function loadQueue(): QueueItem[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isValidQueueItem);
  } catch {
    return [];
  }
}

/** Persist queue to localStorage. Catches QuotaExceededError silently. */
export function saveQueue(items: QueueItem[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
  } catch {
    // QuotaExceededError — queue is still in memory, just not persisted.
  }
}

/** Create a QueueItem from an extracted Article, sanitizing metadata. */
export function createQueueItem(article: Article): QueueItem {
  return {
    id: crypto.randomUUID(),
    url: article.resolvedUrl || '',
    title: sanitizeMetadata(article.title, 300),
    siteName: sanitizeMetadata(article.siteName, 100),
    wordCount: article.wordCount,
    estimatedMinutes: article.estimatedMinutes,
    lang: article.lang,
    dateAdded: Date.now(),
  };
}

/** Add an item to the queue. Enforces max size. Returns the new queue. */
export function addToQueue(items: QueueItem[], item: QueueItem): QueueItem[] {
  // Prevent duplicates by URL
  const filtered = items.filter((i) => i.url !== item.url || !item.url);
  const updated = [...filtered, item].slice(-MAX_QUEUE_SIZE);
  saveQueue(updated);
  return updated;
}

/** Remove an item by id. Returns the new queue. */
export function removeFromQueue(items: QueueItem[], id: string): QueueItem[] {
  const updated = items.filter((i) => i.id !== id);
  saveQueue(updated);
  return updated;
}

/** Replace the entire queue (for reordering). Returns the saved queue. */
export function reorderQueue(items: QueueItem[]): QueueItem[] {
  saveQueue(items);
  return items;
}

/** Clear the entire queue. */
export function clearQueue(): void {
  localStorage.removeItem(STORAGE_KEY);
}
