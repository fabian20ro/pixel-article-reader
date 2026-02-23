import { getUrlFromParams, extractUrl, clearQueryParams } from './url-utils.js';
import {
  extractArticle,
  extractArticleWithJina,
  createArticleFromText,
  type Article,
} from './extractor.js';
import { needsTranslation, getSourceLang, type Language } from './lang-detect.js';
import { translateParagraphs } from './translator.js';
import type { TTSEngine } from './tts-engine.js';
import type { AppDomRefs } from './dom-refs.js';

// marked is loaded as a global via <script> tag (vendor/marked.js)
declare const marked: { parse(md: string): string };

/**
 * TTS paragraph minimum length.  Blocks whose normalised text is shorter
 * than this are merged with the following block so that short items like
 * author bylines ("Ilene S. Cohen, Ph.D."), photo credits, or short
 * headings don't produce their own pause-bounded TTS utterance.
 */
const MIN_TTS_PARAGRAPH = 80;

const MARKDOWN_BLOCK_SELECTOR = [
  ':scope > h1',
  ':scope > h2',
  ':scope > h3',
  ':scope > h4',
  ':scope > h5',
  ':scope > h6',
  ':scope > p',
  ':scope > ul',
  ':scope > ol',
  ':scope > blockquote',
  ':scope > pre',
  ':scope > hr',
  ':scope > figure',
].join(', ');

export interface ArticleControllerOptions {
  refs: AppDomRefs;
  tts: TTSEngine;
  proxyBase: string;
  proxySecret: string;
  initialLangOverride: 'auto' | Language;
  onArticleRendered?: (totalParagraphs: number) => void;
}

export class ArticleController {
  private currentArticle: Article | null = null;
  private currentArticleUrl = '';
  private langOverride: 'auto' | Language;

  constructor(private readonly options: ArticleControllerOptions) {
    this.langOverride = options.initialLangOverride;
  }

  init(): void {
    const { refs } = this.options;

    refs.goBtn.addEventListener('click', () => this.handleUrlSubmit());
    refs.urlInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') this.handleUrlSubmit();
    });

    refs.translateBtn.addEventListener('click', () => {
      void this.translateCurrentArticle();
    });

    refs.jinaRetryBtn.addEventListener('click', () => {
      void this.retryWithJina();
    });

    refs.copyMdBtn.addEventListener('click', () => {
      void this.copyMarkdown();
    });

    refs.errorRetry.addEventListener('click', () => {
      this.showView('input');
      refs.urlInput.focus();
    });

    this.syncLanguageControls();
  }

  async handleInitialSharedUrl(): Promise<void> {
    const sharedUrl = getUrlFromParams();
    if (!sharedUrl) return;

    clearQueryParams();
    this.options.refs.urlInput.value = sharedUrl;
    await this.loadArticle(sharedUrl);
  }

  setLangOverride(lang: 'auto' | Language): void {
    this.langOverride = lang;
    this.syncLanguageControls();

    if (!this.currentArticle) return;

    const resolved = this.langOverride === 'auto' ? this.currentArticle.lang : this.langOverride;
    this.options.tts.setLang(resolved);
    this.updateArticleInfo(this.currentArticle, resolved);
  }

  getCurrentArticle(): Article | null {
    return this.currentArticle;
  }

  private handleUrlSubmit(): void {
    const raw = this.options.refs.urlInput.value.trim();
    if (!raw) return;

    const url = extractUrl(raw);
    if (url) {
      void this.loadArticle(url);
      return;
    }

    this.options.tts.stop();
    try {
      const article = createArticleFromText(raw);
      this.currentArticle = article;
      this.currentArticleUrl = '';
      this.displayArticle(article);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Could not parse the pasted text.';
      this.showError(msg);
    }
  }

  private async loadArticle(url: string): Promise<void> {
    this.showView('loading');
    this.options.refs.loadingMessage.textContent = 'Extracting article...';
    this.options.tts.stop();

    try {
      const article = await extractArticle(url, this.options.proxyBase, this.options.proxySecret);
      this.currentArticle = article;
      this.currentArticleUrl = article.resolvedUrl;
      this.displayArticle(article);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Unknown error occurred.';
      this.showError(msg);
    }
  }

  private displayArticle(article: Article): void {
    const { refs } = this.options;
    refs.articleTitle.textContent = article.title;

    const resolvedLang = this.langOverride === 'auto' ? article.lang : this.langOverride;
    this.updateArticleInfo(article, resolvedLang);

    const showTranslate = needsTranslation(article.htmlLang, this.currentArticleUrl, article.lang);
    refs.translateBtn.classList.toggle('hidden', !showTranslate);
    refs.translateBtn.disabled = false;
    refs.translateBtn.textContent = 'Translate to English';

    refs.jinaRetryBtn.classList.toggle('hidden', !this.currentArticleUrl);
    refs.jinaRetryBtn.disabled = false;
    refs.jinaRetryBtn.textContent = 'Try with Jina Reader';

    refs.copyMdBtn.classList.toggle('hidden', !article.markdown);
    refs.copyMdBtn.disabled = false;
    refs.copyMdBtn.textContent = 'Copy as Markdown';

    const ttsParagraphs = this.renderArticleBody(article);

    this.options.tts.loadArticle(ttsParagraphs, resolvedLang, article.title);
    this.syncLanguageControls();

    this.showView('article');
    refs.playerControls.classList.remove('hidden');
    this.options.onArticleRendered?.(ttsParagraphs.length);
  }

  private renderArticleBody(article: Article): string[] {
    const { refs } = this.options;
    refs.articleText.innerHTML = '';

    if (article.markdown) {
      const rendered = this.renderMarkdownHtml(article.markdown);
      if (rendered) {
        refs.articleText.innerHTML = rendered;

        const blocks = this.getMarkdownBlocks(refs.articleText);

        // Merge short blocks (bylines, credits, short headings) with the
        // next block so they don't produce their own pause-bounded TTS
        // utterance.  All merged visual blocks share the same TTS index.
        const ttsParagraphs: string[] = [];
        let pendingText = '';
        let pendingBlocks: HTMLElement[] = [];

        // IMPORTANT: data-index is the canonical TTS paragraph index.
        // Multiple DOM blocks may share the same data-index when short
        // blocks are merged.  Consumers (highlightParagraph, click-to-seek)
        // MUST use data-index, never ordinal DOM position, to map between
        // TTS and DOM.
        const flush = () => {
          if (!pendingText) return;
          const index = ttsParagraphs.length;
          ttsParagraphs.push(pendingText);
          for (const b of pendingBlocks) {
            b.classList.add('paragraph');
            b.dataset.index = String(index);
            b.addEventListener('click', () => {
              this.options.tts.jumpToParagraph(index);
              if (!this.options.tts.state.isPlaying) this.options.tts.play();
            });
          }
          pendingText = '';
          pendingBlocks = [];
        };

        blocks.forEach((block) => {
          // Skipped blocks stay in the DOM but never receive the
          // .paragraph class or a data-index, so they are invisible
          // to highlightParagraph() and click-to-seek.
          if (block.tagName === 'PRE') return;

          let text: string;
          if (block.tagName === 'FIGURE') {
            const figcaption = block.querySelector('figcaption');
            text = this.normalizeTtsText(figcaption?.textContent ?? '');
          } else {
            text = this.normalizeTtsText(block.textContent ?? '');
          }
          if (!text) return;

          pendingText = pendingText ? pendingText + ' ' + text : text;
          pendingBlocks.push(block);

          if (pendingText.length >= MIN_TTS_PARAGRAPH) {
            flush();
          }
        });
        flush();

        if (ttsParagraphs.length > 0) {
          article.paragraphs = ttsParagraphs;
          article.textContent = ttsParagraphs.join('\n\n');
          return ttsParagraphs;
        }
      }
    }

    article.paragraphs.forEach((paragraph, index) => {
      const div = document.createElement('div');
      div.className = 'paragraph';
      div.textContent = paragraph;
      div.dataset.index = String(index);
      div.addEventListener('click', () => {
        this.options.tts.jumpToParagraph(index);
        if (!this.options.tts.state.isPlaying) this.options.tts.play();
      });
      refs.articleText.appendChild(div);
    });

    return article.paragraphs;
  }

  private renderMarkdownHtml(markdown: string): string {
    if (!markdown) return '';
    if (typeof marked === 'undefined' || typeof marked.parse !== 'function') return '';

    try {
      // Strip raw HTML <img> tags from markdown before parsing.
      // Without this, marked's escapeHtml converts them to literal "&lt;img&gt;"
      // text visible in rendered paragraphs.
      const cleaned = markdown.replace(/<img[^>]*\/?>/gi, '');
      const html = marked.parse(cleaned);
      return sanitizeRenderedHtml(String(html));
    } catch {
      return '';
    }
  }

  private normalizeTtsText(text: string): string {
    return text.replace(/\s+/g, ' ').trim();
  }

  private getMarkdownBlocks(container: HTMLElement): HTMLElement[] {
    try {
      return Array.from(container.querySelectorAll<HTMLElement>(MARKDOWN_BLOCK_SELECTOR));
    } catch {
      const ALLOWED = new Set(['H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'P', 'UL', 'OL', 'BLOCKQUOTE', 'PRE', 'HR', 'FIGURE']);
      return Array.from(container.children).filter((el) => ALLOWED.has(el.tagName)) as HTMLElement[];
    }
  }

  private async retryWithJina(): Promise<void> {
    const { refs } = this.options;
    if (!this.currentArticleUrl) return;

    refs.jinaRetryBtn.disabled = true;
    refs.jinaRetryBtn.textContent = 'Re-parsing...';

    try {
      const article = await extractArticleWithJina(
        this.currentArticleUrl,
        this.options.proxyBase,
        this.options.proxySecret,
      );
      this.currentArticle = article;
      this.currentArticleUrl = article.resolvedUrl;
      this.displayArticle(article);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Jina extraction failed.';
      this.showError(msg);
      refs.jinaRetryBtn.disabled = false;
      refs.jinaRetryBtn.textContent = 'Try with Jina Reader';
    }
  }

  private async copyMarkdown(): Promise<void> {
    const { refs } = this.options;
    if (!this.currentArticle?.markdown) return;

    try {
      await navigator.clipboard.writeText(this.currentArticle.markdown);
      refs.copyMdBtn.textContent = 'Copied!';
      setTimeout(() => {
        refs.copyMdBtn.textContent = 'Copy as Markdown';
      }, 2000);
    } catch {
      this.showError('Could not copy markdown to clipboard.');
    }
  }

  private async translateCurrentArticle(): Promise<void> {
    if (!this.currentArticle) return;

    const { refs } = this.options;
    const savedLabel = refs.translateBtn.textContent;

    refs.translateBtn.disabled = true;
    refs.translateBtn.textContent = 'Translating...';

    try {
      const sourceLang = getSourceLang(this.currentArticle.htmlLang, this.currentArticleUrl);
      const translated = await translateParagraphs(
        this.currentArticle.paragraphs,
        sourceLang,
        'en',
        this.options.proxyBase,
        this.options.proxySecret,
      );

      this.currentArticle.paragraphs = translated;
      this.currentArticle.textContent = translated.join('\n\n');
      this.currentArticle.markdown = translated.join('\n\n');
      this.currentArticle.lang = 'en';
      this.currentArticle.htmlLang = 'en';

      this.displayArticle(this.currentArticle);
      refs.translateBtn.classList.add('hidden');
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Translation failed.';
      refs.translateBtn.textContent = savedLabel;
      refs.translateBtn.disabled = false;
      this.showError(msg);
    }
  }

  private showView(view: 'input' | 'loading' | 'error' | 'article'): void {
    const { refs } = this.options;
    refs.inputSection.classList.toggle('hidden', view !== 'input' && view !== 'article');
    refs.loadingSection.classList.toggle('hidden', view !== 'loading');
    refs.errorSection.classList.toggle('hidden', view !== 'error');
    refs.articleSection.classList.toggle('hidden', view !== 'article');

    if (view !== 'article') {
      refs.playerControls.classList.add('hidden');
    }
  }

  private showError(msg: string): void {
    this.options.refs.errorMessage.textContent = msg;
    this.showView('error');
  }

  private updateArticleInfo(article: Article, lang: Language): void {
    this.options.refs.articleInfo.textContent = [
      article.siteName,
      `${article.estimatedMinutes} min`,
      lang.toUpperCase(),
      `${article.wordCount} words`,
    ].join(' \u00B7 ');
  }

  private syncLanguageControls(): void {
    const { refs } = this.options;
    refs.settingsLangBtns.forEach((btn) => {
      btn.classList.toggle('active', btn.dataset.value === this.langOverride);
    });
    refs.playerLangBtns.forEach((btn) => {
      btn.classList.toggle('active', btn.dataset.value === this.langOverride);
    });
  }
}

function sanitizeRenderedHtml(html: string): string {
  const doc = new DOMParser().parseFromString(`<div>${html}</div>`, 'text/html');
  const container = doc.body.firstElementChild as HTMLElement | null;
  if (!container) return '';

  container.querySelectorAll('script, style, iframe, object, embed, img').forEach((el) => el.remove());

  container.querySelectorAll<HTMLElement>('*').forEach((el) => {
    const attrs = Array.from(el.attributes);
    attrs.forEach((attr) => {
      const name = attr.name.toLowerCase();
      const value = attr.value.trim();

      if (name.startsWith('on')) {
        el.removeAttribute(attr.name);
        return;
      }

      if ((name === 'href' || name === 'src') && /^javascript:/i.test(value)) {
        el.removeAttribute(attr.name);
      }
    });

    if (el.tagName === 'A') {
      const href = el.getAttribute('href') ?? '';
      if (/^https?:\/\//i.test(href)) {
        el.setAttribute('target', '_blank');
        el.setAttribute('rel', 'noopener noreferrer');
      }
    }
  });

  return container.innerHTML;
}
