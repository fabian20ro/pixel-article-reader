/**
 * IndexedDB-backed store for article content.
 * Used to persist local file article content (paragraphs, markdown, title)
 * so that queue items for local files can be replayed.
 * URL-based articles are re-fetched, so they don't need this.
 */

export interface StoredArticleContent {
  /** Matches QueueItem.id */
  id: string;
  title: string;
  markdown: string;
  paragraphs: string[];
  textContent: string;
  lang: string;
  htmlLang: string;
  siteName: string;
  excerpt: string;
  wordCount: number;
  estimatedMinutes: number;
}

const DB_NAME = 'article-reader-content';
const DB_VERSION = 1;
const STORE_NAME = 'articles';

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'id' });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

/** Save article content for a queue item (local files only). */
export async function saveArticleContent(content: StoredArticleContent): Promise<void> {
  try {
    const db = await openDB();
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).put(content);
    await new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    db.close();
  } catch {
    // IndexedDB unavailable or quota exceeded — content just won't persist
  }
}

/** Load stored article content by queue item id. Returns null if not found. */
export async function loadArticleContent(id: string): Promise<StoredArticleContent | null> {
  try {
    const db = await openDB();
    const tx = db.transaction(STORE_NAME, 'readonly');
    const request = tx.objectStore(STORE_NAME).get(id);
    const result = await new Promise<StoredArticleContent | null>((resolve, reject) => {
      request.onsuccess = () => resolve(request.result ?? null);
      request.onerror = () => reject(request.error);
    });
    db.close();
    return result;
  } catch {
    return null;
  }
}

/** Delete stored article content for a queue item. */
export async function deleteArticleContent(id: string): Promise<void> {
  try {
    const db = await openDB();
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).delete(id);
    await new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    db.close();
  } catch {
    // Ignore — content is already gone or DB unavailable
  }
}

/** Delete all stored article content. */
export async function clearArticleContent(): Promise<void> {
  try {
    const db = await openDB();
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).clear();
    await new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    db.close();
  } catch {
    // Ignore
  }
}
