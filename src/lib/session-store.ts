import type { Article } from './extractor.js';

const LAST_ARTICLE_KEY = 'article-reader-last-article';

export interface LastSessionData {
  article: Article;
  savedAt: number;
}

function isValidArticleShape(value: unknown): value is Article {
  if (!value || typeof value !== 'object') return false;
  const a = value as Record<string, unknown>;
  return (
    typeof a.title === 'string' &&
    typeof a.content === 'string' &&
    typeof a.textContent === 'string' &&
    typeof a.markdown === 'string' &&
    Array.isArray(a.paragraphs) &&
    typeof a.lang === 'string' &&
    typeof a.htmlLang === 'string' &&
    typeof a.siteName === 'string' &&
    typeof a.excerpt === 'string' &&
    typeof a.wordCount === 'number' &&
    typeof a.estimatedMinutes === 'number' &&
    typeof a.resolvedUrl === 'string'
  );
}

export function saveLastArticle(article: Article): void {
  const payload: LastSessionData = {
    article,
    savedAt: Date.now(),
  };
  localStorage.setItem(LAST_ARTICLE_KEY, JSON.stringify(payload));
}

export function loadLastArticle(): LastSessionData | null {
  try {
    const raw = localStorage.getItem(LAST_ARTICLE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<LastSessionData>;
    if (!parsed || typeof parsed.savedAt !== 'number' || !isValidArticleShape(parsed.article)) {
      localStorage.removeItem(LAST_ARTICLE_KEY);
      return null;
    }
    return { article: parsed.article, savedAt: parsed.savedAt };
  } catch {
    localStorage.removeItem(LAST_ARTICLE_KEY);
    return null;
  }
}
