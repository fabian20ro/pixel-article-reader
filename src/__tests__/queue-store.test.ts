import { beforeEach, describe, expect, it } from 'vitest';
import {
  loadQueue,
  saveQueue,
  addToQueue,
  removeFromQueue,
  clearQueue,
  createQueueItem,
  type QueueItem,
} from '../lib/queue-store.js';
import type { Article } from '../lib/extractor.js';

function createStorageMock() {
  const map = new Map<string, string>();
  return {
    getItem: (key: string) => map.get(key) ?? null,
    setItem: (key: string, value: string) => {
      map.set(key, value);
    },
    removeItem: (key: string) => {
      map.delete(key);
    },
    clear: () => {
      map.clear();
    },
  };
}

function makeItem(overrides: Partial<QueueItem> = {}): QueueItem {
  return {
    id: overrides.id ?? crypto.randomUUID(),
    url: overrides.url ?? 'https://example.com/article',
    title: overrides.title ?? 'Test Article',
    siteName: overrides.siteName ?? 'Example',
    wordCount: overrides.wordCount ?? 500,
    estimatedMinutes: overrides.estimatedMinutes ?? 3,
    lang: overrides.lang ?? 'en',
    dateAdded: overrides.dateAdded ?? Date.now(),
  };
}

function makeArticle(overrides: Partial<Article> = {}): Article {
  return {
    title: overrides.title ?? 'Test Article',
    content: '',
    textContent: 'Some text content.',
    markdown: 'Some **markdown** content.',
    paragraphs: ['Some text content.'],
    lang: (overrides.lang as 'en' | 'ro') ?? 'en',
    htmlLang: 'en',
    siteName: overrides.siteName ?? 'Example',
    excerpt: '',
    wordCount: overrides.wordCount ?? 500,
    estimatedMinutes: overrides.estimatedMinutes ?? 3,
    resolvedUrl: overrides.resolvedUrl ?? 'https://example.com/article',
  };
}

describe('queue-store', () => {
  beforeEach(() => {
    Object.defineProperty(globalThis, 'localStorage', {
      value: createStorageMock(),
      configurable: true,
    });
    localStorage.clear();
  });

  describe('loadQueue', () => {
    it('returns empty array when storage is empty', () => {
      expect(loadQueue()).toEqual([]);
    });

    it('returns empty array when JSON is malformed', () => {
      localStorage.setItem('article-reader-queue', '{not-valid');
      expect(loadQueue()).toEqual([]);
    });

    it('returns empty array when stored value is not an array', () => {
      localStorage.setItem('article-reader-queue', '{"foo":"bar"}');
      expect(loadQueue()).toEqual([]);
    });

    it('drops invalid items and keeps valid ones', () => {
      const valid = makeItem();
      const invalid = { id: '', url: 'not-a-url', title: 123 };
      localStorage.setItem('article-reader-queue', JSON.stringify([valid, invalid]));

      const loaded = loadQueue();
      expect(loaded).toHaveLength(1);
      expect(loaded[0].id).toBe(valid.id);
    });

    it('loads valid items from storage', () => {
      const items = [makeItem({ id: 'a' }), makeItem({ id: 'b', url: 'https://other.com/x' })];
      localStorage.setItem('article-reader-queue', JSON.stringify(items));

      const loaded = loadQueue();
      expect(loaded).toHaveLength(2);
      expect(loaded[0].id).toBe('a');
      expect(loaded[1].id).toBe('b');
    });
  });

  describe('addToQueue', () => {
    it('adds an item to empty queue', () => {
      const item = makeItem();
      const result = addToQueue([], item);
      expect(result).toHaveLength(1);
      expect(result[0].id).toBe(item.id);
    });

    it('deduplicates by URL', () => {
      const existing = makeItem({ url: 'https://example.com/dup' });
      const duplicate = makeItem({ url: 'https://example.com/dup' });
      const result = addToQueue([existing], duplicate);
      expect(result).toHaveLength(1);
      expect(result[0].id).toBe(duplicate.id);
    });

    it('enforces max queue size of 50', () => {
      const items: QueueItem[] = [];
      for (let i = 0; i < 50; i++) {
        items.push(makeItem({ id: `item-${i}`, url: `https://example.com/${i}` }));
      }
      const newItem = makeItem({ id: 'overflow', url: 'https://example.com/overflow' });
      const result = addToQueue(items, newItem);
      expect(result).toHaveLength(50);
      expect(result[result.length - 1].id).toBe('overflow');
      // First item should have been dropped
      expect(result[0].id).toBe('item-1');
    });

    it('persists to localStorage', () => {
      const item = makeItem();
      addToQueue([], item);
      const stored = JSON.parse(localStorage.getItem('article-reader-queue') ?? '[]');
      expect(stored).toHaveLength(1);
    });
  });

  describe('removeFromQueue', () => {
    it('removes item by id', () => {
      const a = makeItem({ id: 'a' });
      const b = makeItem({ id: 'b', url: 'https://other.com' });
      const result = removeFromQueue([a, b], 'a');
      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('b');
    });

    it('returns unchanged queue when id not found', () => {
      const a = makeItem({ id: 'a' });
      const result = removeFromQueue([a], 'nonexistent');
      expect(result).toHaveLength(1);
    });
  });

  describe('clearQueue', () => {
    it('removes the storage key', () => {
      localStorage.setItem('article-reader-queue', '[]');
      clearQueue();
      expect(localStorage.getItem('article-reader-queue')).toBeNull();
    });
  });

  describe('createQueueItem', () => {
    it('creates a queue item from an article', () => {
      const article = makeArticle();
      const item = createQueueItem(article);
      expect(item.title).toBe('Test Article');
      expect(item.url).toBe('https://example.com/article');
      expect(item.siteName).toBe('Example');
      expect(item.wordCount).toBe(500);
      expect(item.lang).toBe('en');
      expect(item.id).toBeTruthy();
      expect(item.dateAdded).toBeGreaterThan(0);
    });

    it('sanitizes HTML in title', () => {
      const article = makeArticle({ title: 'Title <script>alert(1)</script> End' });
      const item = createQueueItem(article);
      expect(item.title).toBe('Title scriptalert(1)/script End');
    });

    it('truncates long titles to 300 chars', () => {
      const article = makeArticle({ title: 'A'.repeat(500) });
      const item = createQueueItem(article);
      expect(item.title.length).toBe(300);
    });

    it('sanitizes HTML in siteName', () => {
      const article = makeArticle({ siteName: '<img onerror="x" src="y">Site' });
      const item = createQueueItem(article);
      expect(item.siteName).toBe('img onerror="x" src="y"Site');
    });
  });
});
