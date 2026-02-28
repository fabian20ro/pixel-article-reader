import { getUrlFromParams, extractUrl, clearQueryParams } from './url-utils.js';
import {
  extractArticle,
  extractArticleWithJina,
  createArticleFromText,
  createArticleFromTextFile,
  createArticleFromPdf,
  createArticleFromMarkdownFile,
  createArticleFromEpub,
  sanitizeRenderedHtml,
  IMAGE_MD_RE,
  IMAGE_JINA_RE,
  IMAGE_HTML_RE,
  type Article,
} from './extractor.js';
import { needsTranslation, getSourceLang } from './lang-detect.js';
import { DEFAULT_TRANSLATION_TARGET, type Language } from './language-config.js';
import { translateParagraphs } from './translator.js';
import type { TTSEngine } from './tts-engine.js';
import type { AppDomRefs } from './dom-refs.js';

// marked is loaded as a global via <script> tag (vendor/marked.js)
declare const marked: { parse(md: string): string };

/**
 * TTS paragraph minimum length.  Blocks whose normalised text is shorter
 * than this are merged with the following block so that very short items
 * like author bylines or short headings don't produce their own
 * pause-bounded TTS utterance.
 */
const MIN_TTS_PARAGRAPH = 40;

/** Tags that should never become TTS blocks (non-content elements). */
const SKIP_BLOCK_TAGS = new Set(['SCRIPT', 'STYLE', 'BR', 'COL', 'COLGROUP']);

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
  private currentTtsParagraphs: string[] = [];
  private langOverride: 'auto' | Language;

  constructor(private readonly options: ArticleControllerOptions) {
    this.langOverride = options.initialLangOverride;
  }

  init(): void {
    const { refs } = this.options;

    refs.goBtn.addEventListener('click', () => this.handleUrlSubmit());
    refs.urlInput.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter') return;
      // Ctrl/Cmd+Enter always submits
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault();
        this.handleUrlSubmit();
        return;
      }
      // Plain Enter submits only when content has no newlines (URL-like input)
      if (!refs.urlInput.value.includes('\n')) {
        e.preventDefault();
        this.handleUrlSubmit();
      }
      // Otherwise let Enter insert a newline (default textarea behavior)
    });

    // Auto-resize textarea to fit content (JS fallback for browsers without field-sizing: content)
    refs.urlInput.addEventListener('input', () => {
      refs.urlInput.style.height = 'auto';
      refs.urlInput.style.height = refs.urlInput.scrollHeight + 'px';
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

    // File upload
    refs.fileBtn.addEventListener('click', () => {
      refs.fileInput.click();
    });

    refs.fileInput.addEventListener('change', () => {
      const file = refs.fileInput.files?.[0];
      if (file) {
        void this.handleFileUpload(file);
        refs.fileInput.value = ''; // reset so same file can be re-selected
      }
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

  /** Public entry point for queue-driven article loading. */
  async loadArticleFromUrl(url: string): Promise<void> {
    await this.loadArticle(url);
  }

  /** Load and display an article from stored content (IndexedDB). Used by queue for local files. */
  async loadArticleFromStored(article: Article): Promise<void> {
    this.options.tts.stop();
    this.currentArticle = article;
    this.currentArticleUrl = '';
    this.displayArticle(article);
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

  private async handleFileUpload(file: File): Promise<void> {
    this.showView('loading');
    this.options.refs.loadingMessage.textContent = 'Processing file...';
    this.options.tts.stop();

    const ext = file.name.split('.').pop()?.toLowerCase() ?? '';

    try {
      let article: Article;

      if (ext === 'pdf') {
        this.options.refs.loadingMessage.textContent = 'Processing PDF...';
        article = await createArticleFromPdf(
          file,
          (msg) => { this.options.refs.loadingMessage.textContent = msg; },
        );
      } else if (ext === 'txt' || ext === 'text') {
        this.options.refs.loadingMessage.textContent = 'Processing text file...';
        article = await createArticleFromTextFile(file);
      } else if (ext === 'md' || ext === 'markdown') {
        this.options.refs.loadingMessage.textContent = 'Processing markdown...';
        article = await createArticleFromMarkdownFile(file);
      } else if (ext === 'epub') {
        this.options.refs.loadingMessage.textContent = 'Processing EPUB...';
        article = await createArticleFromEpub(
          file,
          (msg) => { this.options.refs.loadingMessage.textContent = msg; },
        );
      } else {
        throw new Error(`Unsupported file type: .${ext}. Supported: PDF, TXT, Markdown, EPUB.`);
      }

      this.currentArticle = article;
      this.currentArticleUrl = '';
      this.displayArticle(article);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Could not process the file.';
      this.showError(msg);
    }
  }

  private async loadArticle(url: string): Promise<void> {
    this.showView('loading');
    this.options.refs.loadingMessage.textContent = 'Extracting article...';
    this.options.tts.stop();

    try {
      const article = await extractArticle(
        url,
        this.options.proxyBase,
        this.options.proxySecret,
        (msg) => { this.options.refs.loadingMessage.textContent = msg; },
      );
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

    this.currentTtsParagraphs = this.renderArticleBody(article);

    this.options.tts.loadArticle(this.currentTtsParagraphs, resolvedLang, article.title);
    this.syncLanguageControls();

    this.showView('article');
    refs.playerControls.classList.remove('hidden');
    this.options.onArticleRendered?.(this.currentTtsParagraphs.length);
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
          // Code blocks: announce with truncated content instead of
          // silently skipping.  Always flush immediately so code never
          // merges with adjacent prose.
          if (block.tagName === 'PRE') {
            const codeText = this.normalizeTtsText(block.textContent ?? '');
            if (codeText) {
              const truncated = codeText.length > 200
                ? codeText.slice(0, 200) + '...'
                : codeText;
              pendingText = pendingText
                ? pendingText + ' ' + 'Code block: ' + truncated
                : 'Code block: ' + truncated;
              pendingBlocks.push(block);
              flush();
            }
            return;
          }

          // Decompose compound blocks (lists, blockquotes) into
          // individual sub-items so each gets its own TTS paragraph.
          const subItems = this.extractSubItems(block);
          for (const { element, text } of subItems) {
            if (!text) continue;
            pendingText = pendingText ? pendingText + ' ' + text : text;
            pendingBlocks.push(element);
            if (pendingText.length >= MIN_TTS_PARAGRAPH) {
              flush();
            }
          }
        });
        flush();

        if (ttsParagraphs.length > 0) {
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
      // Strip image-related content before rendering — this is a text reader,
      // not an image viewer, so images add no value and produce visual noise.
      const cleaned = markdown
        .replace(IMAGE_HTML_RE, '')     // raw HTML <img> tags
        .replace(IMAGE_MD_RE, '')       // ![alt](url) → remove
        .replace(IMAGE_JINA_RE, '');    // [Image: ...](url) Jina format → remove
      const html = marked.parse(cleaned);
      return sanitizeRenderedHtml(String(html));
    } catch {
      return '';
    }
  }

  private normalizeTtsText(text: string): string {
    return text.replace(/\s+/g, ' ').trim();
  }

  /**
   * Break a compound block (list, blockquote) into individual sub-items
   * so each can become its own TTS paragraph.  For simple blocks (p, h1-h6,
   * table, etc.) returns the block itself.
   */
  private extractSubItems(
    block: HTMLElement,
  ): Array<{ element: HTMLElement; text: string }> {
    const tag = block.tagName;

    // Lists: each <li> is a separate sub-item
    if (tag === 'UL' || tag === 'OL') {
      const items = Array.from(
        block.querySelectorAll<HTMLElement>(':scope > li'),
      );
      if (items.length > 0) {
        return items.map((li) => ({
          element: li,
          text: this.normalizeTtsText(li.textContent ?? ''),
        }));
      }
    }

    // Blockquotes with multiple paragraphs: each <p> is separate
    if (tag === 'BLOCKQUOTE') {
      const paras = Array.from(
        block.querySelectorAll<HTMLElement>(':scope > p'),
      );
      if (paras.length > 1) {
        return paras.map((p) => ({
          element: p,
          text: this.normalizeTtsText(p.textContent ?? ''),
        }));
      }
    }

    // Figures: use figcaption only
    if (tag === 'FIGURE') {
      const figcaption = block.querySelector<HTMLElement>('figcaption');
      return [{
        element: block,
        text: this.normalizeTtsText(figcaption?.textContent ?? ''),
      }];
    }

    // Default: whole block
    return [{
      element: block,
      text: this.normalizeTtsText(block.textContent ?? ''),
    }];
  }

  private getMarkdownBlocks(container: HTMLElement): HTMLElement[] {
    return Array.from(container.children).filter(
      (el) => !SKIP_BLOCK_TAGS.has(el.tagName),
    ) as HTMLElement[];
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
        this.currentTtsParagraphs,
        sourceLang,
        DEFAULT_TRANSLATION_TARGET,
        this.options.proxyBase,
        this.options.proxySecret,
      );

      this.currentArticle = {
        ...this.currentArticle,
        paragraphs: translated,
        textContent: translated.join('\n\n'),
        markdown: translated.join('\n\n'),
        lang: DEFAULT_TRANSLATION_TARGET,
        htmlLang: DEFAULT_TRANSLATION_TARGET,
      };

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
    refs.settingsLangBtns.forEach((btn: HTMLButtonElement) => {
      btn.classList.toggle('active', btn.dataset.value === this.langOverride);
    });
  }
}
