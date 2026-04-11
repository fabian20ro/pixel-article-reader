import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ArticleController } from '../lib/article-controller.js';
import { extractArticle } from '../lib/extractor.js';

vi.mock('../lib/extractor.js', async () => {
  const actual = await vi.importActual<typeof import('../lib/extractor.js')>('../lib/extractor.js');
  return {
    ...actual,
    extractArticle: vi.fn(),
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
  });

  it('passes extractArticle an options object from the browser load path', async () => {
    vi.mocked(extractArticle).mockRejectedValueOnce(new Error('boom'));

    const controller = new ArticleController({
      refs: makeRefs(),
      tts: {
        stop: vi.fn(),
      } as any,
      proxyBase: 'https://proxy.example.workers.dev',
      proxySecret: 'secret',
      initialLangOverride: 'auto',
    });

    await (controller as any).loadArticle('https://example.com/article');

    expect(extractArticle).toHaveBeenCalledWith(
      'https://example.com/article',
      'https://proxy.example.workers.dev',
      'secret',
      expect.objectContaining({
        onProgress: expect.any(Function),
      }),
    );
  });
});
