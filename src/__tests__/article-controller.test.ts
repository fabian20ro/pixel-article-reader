import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ArticleController } from '../lib/article-controller.js';
import { extractArticle, createArticleFromMarkdownFile, createArticleFromPdf, createArticleFromTextFile } from '../lib/extractor.js';

vi.mock('../lib/extractor.js', async () => {
  const actual = await vi.importActual<typeof import('../lib/extractor.js')>('../lib/extractor.js');
  return {
    ...actual,
    extractArticle: vi.fn(),
    createArticleFromMarkdownFile: vi.fn(),
    createArticleFromPdf: vi.fn(),
    createArticleFromTextFile: vi.fn(),
  };
});

function makeRefs() {
  const section = () => {
    const el = document.createElement('section');
    el.className = 'hidden';
    return el;
  };
  const div = () => document.createElement('div');

  return {
    urlInput: document.createElement('textarea'),
    goBtn: document.createElement('button'),
    inputSection: section(),
    loadingSection: section(),
    loadingMessage: div(),
    errorSection: section(),
    errorMessage: div(),
    errorRetry: document.createElement('button'),
    articleSection: section(),
    articleTitle: div(),
    articleInfo: div(),
    translateBtn: document.createElement('button'),
    copyMdBtn: document.createElement('button'),
    articleText: div(),
    playerControls: section(),
    playPauseBtn: document.createElement('button'),
    playIcon: div(),
    pauseIcon: div(),
    skipForwardBtn: document.createElement('button'),
    skipBackBtn: document.createElement('button'),
    skipSentenceForwardBtn: document.createElement('button'),
    skipSentenceBackBtn: document.createElement('button'),
    progressFill: div(),
    progressText: div(),
    progressBar: div(),
    settingsToggle: document.createElement('button'),
    settingsPanel: div(),
    settingsOverlay: div(),
    settingsSpeed: document.createElement('input'),
    speedValue: div(),
    settingsVoice: document.createElement('select'),
    settingsWakelock: document.createElement('input'),
    settingsDeviceVoice: document.createElement('input'),
    checkUpdateBtn: document.createElement('button'),
    updateStatus: div(),
    voiceGenderGroup: div(),
    voiceGenderBtns: document.querySelectorAll<HTMLButtonElement>('.missing-voice-gender'),
    fileInput: document.createElement('input'),
    fileBtn: document.createElement('button'),
    installBanner: div(),
    installBtn: document.createElement('button'),
    installDismiss: document.createElement('button'),
    speedBtns: document.querySelectorAll<HTMLButtonElement>('.missing-speed'),
    themeBtns: document.querySelectorAll<HTMLButtonElement>('.missing-theme'),
    settingsLangBtns: document.querySelectorAll<HTMLButtonElement>('.missing-lang'),
    menuToggle: document.createElement('button'),
    queueDrawer: div(),
    queueOverlay: div(),
    queueDrawerHeader: div(),
    queueBadge: div(),
    queueList: div(),
    queueEmpty: div(),
    queueCount: div(),
    queueClearBtn: document.createElement('button'),
    nextArticleRow: div(),
    nextArticleTitle: div(),
    autoAdvanceToast: div(),
    advanceText: div(),
    advanceSkipBtn: document.createElement('button'),
    advanceCancelBtn: document.createElement('button'),
    chaptersBtn: document.createElement('button'),
    chaptersSheet: div(),
    chaptersOverlay: div(),
    chaptersSheetHandle: div(),
    chaptersList: div(),
    appVersion: div(),
  } as any;
}

describe('ArticleController', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    const localStorageMock = {
      getItem: vi.fn().mockReturnValue(null),
      setItem: vi.fn(),
      clear: vi.fn(),
      removeItem: vi.fn(),
    };
    vi.stubGlobal('localStorage', localStorageMock);
  });

  it('passes extractArticle an options object from the browser load path and handles errors', async () => {
    const errorMsg = 'boom';
    vi.mocked(extractArticle).mockRejectedValueOnce(new Error(errorMsg));

    const refs = makeRefs();
    const controller = new ArticleController({
      refs,
      tts: {
        stop: vi.fn(),
      } as any,
      proxyBase: 'https://proxy.example.workers.dev',
      initialLangOverride: 'auto',
    });

    await (controller as any).loadArticle('https://example.com/article');

    expect(extractArticle).toHaveBeenCalledWith(
      'https://example.com/article',
      'https://proxy.example.workers.dev',
      expect.objectContaining({
        onProgress: expect.any(Function),
      }),
    );
    expect(refs.errorMessage.textContent).toBe(errorMsg);
    expect(refs.errorSection.classList.contains('hidden')).toBe(false);
  });

  it('ignores stale URL load results when a newer load starts', async () => {
    let resolveFirst: ((v: any) => void) | null = null;
    vi.mocked(extractArticle)
      .mockImplementationOnce(() => new Promise((resolve) => { resolveFirst = resolve; }) as any)
      .mockResolvedValueOnce({
        title: 'Second',
        content: '<p>second</p>',
        textContent: 'second',
        markdown: 'second',
        paragraphs: ['second paragraph is long enough for rendering'],
        lang: 'en',
        htmlLang: 'en',
        siteName: 'Site',
        excerpt: '',
        wordCount: 10,
        estimatedMinutes: 1,
        resolvedUrl: 'https://example.com/second',
      } as any);

    const refs = makeRefs();
    const controller = new ArticleController({
      refs,
      tts: { stop: vi.fn(), loadArticle: vi.fn(), setLang: vi.fn() } as any,
      proxyBase: 'https://proxy.example.workers.dev',
      initialLangOverride: 'auto',
    });

    const first = (controller as any).loadArticle('https://example.com/first');
    const second = (controller as any).loadArticle('https://example.com/second');
    await second;
    resolveFirst?.({
      title: 'First',
      content: '<p>first</p>',
      textContent: 'first',
      markdown: 'first',
      paragraphs: ['first paragraph is long enough for rendering'],
      lang: 'en',
      htmlLang: 'en',
      siteName: 'Site',
      excerpt: '',
      wordCount: 10,
      estimatedMinutes: 1,
      resolvedUrl: 'https://example.com/first',
    });
    await first;

    expect(refs.articleTitle.textContent).toBe('Second');
  });

  it('loads an article from storage via loadArticleFromStored', async () => {
    const article = {
      title: 'Stored Article',
      content: '<p>Content</p>',
      textContent: 'Content',
      markdown: 'Content',
      paragraphs: ['Paragraph 1'],
      lang: 'en',
      htmlLang: 'en',
      siteName: 'Site',
      excerpt: '',
      wordCount: 1,
      estimatedMinutes: 1,
      resolvedUrl: 'https://example.com/stored',
    } as any;

    const refs = makeRefs();
    const controller = new ArticleController({
      refs,
      tts: {
        stop: vi.fn(),
        loadArticle: vi.fn(),
        setLang: vi.fn(),
      } as any,
      proxyBase: 'https://proxy.example.workers.dev',
      initialLangOverride: 'auto',
    });

    await controller.loadArticleFromStored(article);

    expect(controller.getCurrentArticle()).toEqual(article);
    expect(refs.articleTitle.textContent).toBe('Stored Article');
  });

  it('triggers loadArticle when goBtn is clicked', async () => {
    const refs = makeRefs();
    const ttsMock = {
      stop: vi.fn(),
      loadArticle: vi.fn(),
      setLang: vi.fn(),
    };
    const controller = new ArticleController({
      refs,
      tts: ttsMock as any,
      proxyBase: 'https://proxy.example.workers.dev',
      initialLangOverride: 'auto',
    });
    controller.init();

    refs.urlInput.value = 'https://example.com/article';
    refs.goBtn.click();

    expect(extractArticle).toHaveBeenCalledWith(
      'https://example.com/article',
      'https://proxy.example.workers.dev',
      expect.objectContaining({
        onProgress: expect.any(Function),
      }),
    );
    expect(ttsMock.stop).toHaveBeenCalled();
  });

  it('updates language and TTS when setLangOverride is called', async () => {
    const article = {
      title: 'Test',
      content: '<p>test</p>',
      textContent: 'test',
      markdown: 'test',
      paragraphs: ['test paragraph'],
      lang: 'en',
      htmlLang: 'en',
      siteName: 'Site',
      excerpt: '',
      wordCount: 10,
      estimatedMinutes: 1,
      resolvedUrl: 'https://example.com/test',
    } as any;

    const refs = makeRefs();
    const ttsMock = {
      stop: vi.fn(),
      loadArticle: vi.fn(),
      setLang: vi.fn(),
    };
    const controller = new ArticleController({
      refs,
      tts: ttsMock as any,
      proxyBase: 'https://proxy.example.workers.dev',
      initialLangOverride: 'auto',
    });

    // Set article first
    await controller.loadArticleFromStored(article);

    // Test override to 'ro'
    controller.setLangOverride('ro');
    expect(ttsMock.setLang).toHaveBeenCalledWith('ro');
    expect(refs.articleInfo.textContent).toContain('RO');
  });

  it('handles successful markdown file upload', async () => {
    const article = {
      title: 'Markdown Article',
      content: '<p>Markdown content</p>',
      textContent: 'Markdown content',
      markdown: 'Markdown content',
      paragraphs: ['Markdown content'],
      lang: 'en',
      htmlLang: 'en',
      siteName: 'Site',
      excerpt: '',
      wordCount: 2,
      estimatedMinutes: 1,
      resolvedUrl: 'https://example.com/markdown',
    } as any;

    vi.mocked(createArticleFromMarkdownFile).mockResolvedValueOnce(article);

    const refs = makeRefs();
    const controller = new ArticleController({
      refs,
      tts: { stop: vi.fn(), loadArticle: vi.fn(), setLang: vi.fn() } as any,
      proxyBase: 'https://proxy.example.workers.dev',
      initialLangOverride: 'auto',
    });

    const file = new File(['# Title\nContent'], 'test.md', { type: 'text/markdown' });
    await (controller as any).handleFileUpload(file);

    expect(controller.getCurrentArticle()).toEqual(article);
    expect(refs.articleTitle.textContent).toBe('Markdown Article');
    expect(refs.articleSection.classList.contains('hidden')).toBe(false);
  });

  it('handles successful pdf file upload', async () => {
    const article = {
      title: 'PDF Article',
      content: '<p>PDF content</p>',
      textContent: 'PDF content',
      markdown: 'PDF content',
      paragraphs: ['PDF paragraph'],
      lang: 'en',
      htmlLang: 'en',
      siteName: 'Site',
      excerpt: '',
      wordCount: 2,
      estimatedMinutes: 1,
      resolvedUrl: 'https://example.com/pdf',
    } as any;

    vi.mocked(createArticleFromPdf).mockResolvedValueOnce(article);

    const refs = makeRefs();
    const controller = new ArticleController({
      refs,
      tts: { stop: vi.fn(), loadArticle: vi.fn(), setLang: vi.fn() } as any,
      proxyBase: 'https://proxy.example.workers.dev',
      initialLangOverride: 'auto',
    });

    const file = new File(['PDF content'], 'test.pdf', { type: 'application/pdf' });
    await (controller as any).handleFileUpload(file);

    expect(controller.getCurrentArticle()).toEqual(article);
    expect(refs.articleTitle.textContent).toBe('PDF Article');
    expect(refs.articleSection.classList.contains('hidden')).toBe(false);
  });

  it('handles successful text file upload', async () => {
    const article = {
      title: 'Text Article',
      content: '<p>Text content</p>',
      textContent: 'Text content',
      markdown: 'Text content',
      paragraphs: ['Text content'],
      lang: 'en',
      htmlLang: 'en',
      siteName: 'Site',
      excerpt: '',
      wordCount: 2,
      estimatedMinutes: 1,
      resolvedUrl: 'https://example.com/text',
    } as any;

    vi.mocked(createArticleFromTextFile).mockResolvedValueOnce(article);

    const refs = makeRefs();
    const controller = new ArticleController({
      refs,
      tts: { stop: vi.fn(), loadArticle: vi.fn(), setLang: vi.fn() } as any,
      proxyBase: 'https://proxy.example.workers.dev',
      initialLangOverride: 'auto',
    });

    const file = new File(['Plain text content'], 'test.txt', { type: 'text/plain' });
    await (controller as any).handleFileUpload(file);

    expect(controller.getCurrentArticle()).toEqual(article);
    expect(refs.articleTitle.textContent).toBe('Text Article');
    expect(refs.articleSection.classList.contains('hidden')).toBe(false);
  });
});
