/**
 * ArticleVoice — main application orchestrator.
 *
 * Wires up URL handling, article extraction, TTS playback,
 * install-prompt, settings persistence, and all UI interactions.
 */

import { getUrlFromParams, extractUrl, clearQueryParams } from './lib/url-utils.js';
import { extractArticle, type Article } from './lib/extractor.js';
import { TTSEngine } from './lib/tts-engine.js';
import type { Language } from './lib/lang-detect.js';

// ── Config ──────────────────────────────────────────────────────────

const CONFIG = {
  PROXY_BASE: 'https://pixel-article-reader.fabian20ro.workers.dev',
  PROXY_SECRET: '',  // Set at build time or leave empty if secret is not configured
  DEFAULT_RATE: 1.0,
  DEFAULT_LANG: 'auto' as 'auto' | Language,
};

// ── Settings persistence ────────────────────────────────────────────

interface AppSettings {
  rate: number;
  lang: 'auto' | Language;
  voiceName: string;
  wakeLock: boolean;
}

function loadSettings(): AppSettings {
  try {
    const raw = localStorage.getItem('articlevoice-settings');
    if (raw) return JSON.parse(raw);
  } catch { /* use defaults */ }
  return {
    rate: CONFIG.DEFAULT_RATE,
    lang: CONFIG.DEFAULT_LANG,
    voiceName: '',
    wakeLock: true,
  };
}

function saveSettings(s: AppSettings): void {
  localStorage.setItem('articlevoice-settings', JSON.stringify(s));
}

// ── DOM refs ────────────────────────────────────────────────────────

function $(id: string): HTMLElement {
  return document.getElementById(id)!;
}

// ── Main ────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  // Register service worker
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }

  const settings = loadSettings();
  let currentArticle: Article | null = null;
  let currentLangOverride: 'auto' | Language = settings.lang;

  // ── TTS engine ──────────────────────────────────────────────────

  const tts = new TTSEngine({
    onStateChange(state) {
      updatePlayButton(state.isPlaying, state.isPaused);
    },
    onProgress(current, total) {
      updateProgress(current, total);
    },
    onParagraphChange(index) {
      highlightParagraph(index);
    },
    onEnd() {
      updatePlayButton(false, false);
      highlightParagraph(-1);
    },
    onError(msg) {
      showError(msg);
    },
  });

  await tts.init();
  tts.setRate(settings.rate);
  tts.setWakeLock(settings.wakeLock);

  // ── DOM elements ────────────────────────────────────────────────

  const urlInput = $('url-input') as HTMLInputElement;
  const goBtn = $('go-btn');
  const inputSection = $('input-section');
  const loadingSection = $('loading-section');
  const loadingMessage = $('loading-message');
  const errorSection = $('error-section');
  const errorMessage = $('error-message');
  const errorRetry = $('error-retry');
  const articleSection = $('article-section');
  const articleTitle = $('article-title');
  const articleInfo = $('article-info');
  const articleText = $('article-text');
  const playerControls = $('player-controls');
  const playPauseBtn = $('play-pause');
  const playIcon = $('play-icon');
  const pauseIcon = $('pause-icon');
  const skipForwardBtn = $('skip-forward');
  const skipBackBtn = $('skip-back');
  const skipSentenceForwardBtn = $('skip-sentence-forward');
  const skipSentenceBackBtn = $('skip-sentence-back');
  const progressFill = $('progress-fill');
  const progressText = $('progress-text');
  const progressBar = $('progress-bar');
  const settingsToggle = $('settings-toggle');
  const settingsPanel = $('settings-panel');
  const settingsSpeed = $('settings-speed') as HTMLInputElement;
  const speedValue = $('speed-value');
  const settingsVoice = $('settings-voice') as HTMLSelectElement;
  const settingsWakelock = $('settings-wakelock') as HTMLInputElement;
  const installBanner = $('install-banner');
  const installBtn = $('install-btn');
  const installDismiss = $('install-dismiss');

  // ── Install prompt ──────────────────────────────────────────────

  let deferredInstallPrompt: BeforeInstallPromptEvent | null = null;

  interface BeforeInstallPromptEvent extends Event {
    prompt(): Promise<void>;
    userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
  }

  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredInstallPrompt = e as BeforeInstallPromptEvent;
    // Show banner if not previously dismissed
    const dismissed = localStorage.getItem('articlevoice-install-dismissed');
    if (!dismissed) {
      installBanner.classList.remove('hidden');
    }
  });

  installBtn.addEventListener('click', async () => {
    if (!deferredInstallPrompt) return;
    installBanner.classList.add('hidden');
    await deferredInstallPrompt.prompt();
    deferredInstallPrompt = null;
  });

  installDismiss.addEventListener('click', () => {
    installBanner.classList.add('hidden');
    localStorage.setItem('articlevoice-install-dismissed', '1');
  });

  // ── Settings ────────────────────────────────────────────────────

  settingsToggle.addEventListener('click', () => {
    settingsPanel.classList.toggle('hidden');
  });

  // Speed slider
  settingsSpeed.value = String(settings.rate);
  speedValue.textContent = settings.rate + 'x';

  settingsSpeed.addEventListener('input', () => {
    const rate = parseFloat(settingsSpeed.value);
    speedValue.textContent = rate + 'x';
    tts.setRate(rate);
    settings.rate = rate;
    saveSettings(settings);
    // Also update active speed button
    updateSpeedButtons(rate);
  });

  // Voice selector
  populateVoices();
  function populateVoices(): void {
    const voices = tts.getAvailableVoices();
    settingsVoice.innerHTML = '<option value="">Default</option>';
    voices.forEach((v) => {
      const opt = document.createElement('option');
      opt.value = v.name;
      opt.textContent = `${v.name} (${v.lang})`;
      if (v.name === settings.voiceName) opt.selected = true;
      settingsVoice.appendChild(opt);
    });
  }

  settingsVoice.addEventListener('change', () => {
    const name = settingsVoice.value;
    if (name) tts.setVoice(name);
    settings.voiceName = name;
    saveSettings(settings);
  });

  // Language radio (settings panel)
  const settingsLangRadios = document.querySelectorAll<HTMLInputElement>('input[name="settings-lang"]');
  settingsLangRadios.forEach((radio) => {
    if (radio.value === settings.lang) radio.checked = true;
    radio.addEventListener('change', () => {
      const val = radio.value as 'auto' | Language;
      currentLangOverride = val;
      settings.lang = val;
      saveSettings(settings);
    });
  });

  // Wake lock
  settingsWakelock.checked = settings.wakeLock;
  settingsWakelock.addEventListener('change', () => {
    settings.wakeLock = settingsWakelock.checked;
    tts.setWakeLock(settingsWakelock.checked);
    saveSettings(settings);
  });

  // ── URL input + Go ──────────────────────────────────────────────

  goBtn.addEventListener('click', () => handleUrlSubmit());
  urlInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') handleUrlSubmit();
  });

  function handleUrlSubmit(): void {
    const raw = urlInput.value.trim();
    const url = extractUrl(raw);
    if (!url) {
      showError('Please enter a valid article URL.');
      return;
    }
    loadArticle(url);
  }

  // ── Player controls ─────────────────────────────────────────────

  playPauseBtn.addEventListener('click', () => {
    if (tts.state.isPaused) {
      tts.resume();
    } else if (tts.state.isPlaying) {
      tts.pause();
    } else {
      tts.play();
    }
  });

  skipForwardBtn.addEventListener('click', () => tts.skipForward());
  skipBackBtn.addEventListener('click', () => tts.skipBackward());
  skipSentenceForwardBtn.addEventListener('click', () => tts.skipSentenceForward());
  skipSentenceBackBtn.addEventListener('click', () => tts.skipSentenceBackward());

  // Speed preset buttons
  const speedBtns = document.querySelectorAll<HTMLButtonElement>('.speed-btn');
  speedBtns.forEach((btn) => {
    btn.addEventListener('click', () => {
      const rate = parseFloat(btn.dataset.rate ?? '1');
      tts.setRate(rate);
      settings.rate = rate;
      saveSettings(settings);
      settingsSpeed.value = String(rate);
      speedValue.textContent = rate + 'x';
      updateSpeedButtons(rate);
    });
  });

  function updateSpeedButtons(rate: number): void {
    speedBtns.forEach((b) => {
      b.classList.toggle('active', parseFloat(b.dataset.rate ?? '0') === rate);
    });
  }

  // Language radio (player)
  const playerLangRadios = document.querySelectorAll<HTMLInputElement>('input[name="player-lang"]');
  playerLangRadios.forEach((radio) => {
    radio.addEventListener('change', () => {
      const val = radio.value as 'auto' | Language;
      currentLangOverride = val;
      settings.lang = val;
      saveSettings(settings);

      if (currentArticle) {
        const lang = val === 'auto' ? currentArticle.lang : val;
        tts.setLang(lang);
      }
    });
  });

  // Progress bar click to seek
  progressBar.addEventListener('click', (e) => {
    if (!currentArticle) return;
    const rect = progressBar.getBoundingClientRect();
    const ratio = (e.clientX - rect.left) / rect.width;
    const idx = Math.floor(ratio * currentArticle.paragraphs.length);
    tts.jumpToParagraph(idx);
  });

  // ── Article loading ─────────────────────────────────────────────

  async function loadArticle(url: string): Promise<void> {
    showView('loading');
    loadingMessage.textContent = 'Extracting article...';
    tts.stop();

    try {
      const article = await extractArticle(url, CONFIG.PROXY_BASE, CONFIG.PROXY_SECRET);
      currentArticle = article;
      displayArticle(article);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Unknown error occurred.';
      showError(msg);
    }
  }

  function displayArticle(article: Article): void {
    articleTitle.textContent = article.title;

    const lang = currentLangOverride === 'auto' ? article.lang : currentLangOverride;
    articleInfo.textContent = [
      article.siteName,
      `${article.estimatedMinutes} min`,
      lang.toUpperCase(),
      `${article.wordCount} words`,
    ].join(' \u00B7 ');

    // Render paragraphs
    articleText.innerHTML = '';
    article.paragraphs.forEach((p, i) => {
      const div = document.createElement('div');
      div.className = 'paragraph';
      div.textContent = p;
      div.dataset.index = String(i);
      div.addEventListener('click', () => {
        tts.jumpToParagraph(i);
        if (!tts.state.isPlaying) tts.play();
      });
      articleText.appendChild(div);
    });

    // Load into TTS
    tts.loadArticle(article.paragraphs, lang);

    // Sync player-lang radio
    playerLangRadios.forEach((r) => {
      r.checked = r.value === currentLangOverride;
    });

    showView('article');
    playerControls.classList.remove('hidden');
    updateProgress(0, article.paragraphs.length);
    highlightParagraph(0);
  }

  // ── UI helpers ──────────────────────────────────────────────────

  function showView(view: 'input' | 'loading' | 'error' | 'article'): void {
    inputSection.classList.toggle('hidden', view !== 'input' && view !== 'article');
    loadingSection.classList.toggle('hidden', view !== 'loading');
    errorSection.classList.toggle('hidden', view !== 'error');
    articleSection.classList.toggle('hidden', view !== 'article');
    if (view !== 'article') {
      playerControls.classList.add('hidden');
    }
  }

  function showError(msg: string): void {
    errorMessage.textContent = msg;
    showView('error');
  }

  errorRetry.addEventListener('click', () => {
    showView('input');
    urlInput.focus();
  });

  function updatePlayButton(isPlaying: boolean, isPaused: boolean): void {
    if (isPlaying && !isPaused) {
      playIcon.classList.add('hidden');
      pauseIcon.classList.remove('hidden');
      playPauseBtn.setAttribute('aria-label', 'Pause');
    } else {
      playIcon.classList.remove('hidden');
      pauseIcon.classList.add('hidden');
      playPauseBtn.setAttribute('aria-label', 'Play');
    }
  }

  function updateProgress(current: number, total: number): void {
    const pct = total > 0 ? (current / total) * 100 : 0;
    progressFill.style.width = pct + '%';
    progressText.textContent = `${current + 1} / ${total}`;
  }

  function highlightParagraph(index: number): void {
    const paras = articleText.querySelectorAll('.paragraph');
    paras.forEach((el, i) => {
      el.classList.toggle('active', i === index);
      el.classList.toggle('past', i < index);
    });
    // Auto-scroll to the active paragraph
    if (index >= 0 && index < paras.length) {
      paras[index].scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }

  // ── Handle share-target / initial URL ───────────────────────────

  const sharedUrl = getUrlFromParams();
  if (sharedUrl) {
    clearQueryParams();
    urlInput.value = sharedUrl;
    loadArticle(sharedUrl);
  }

  // Set initial speed buttons
  updateSpeedButtons(settings.rate);
}

// ── Boot ────────────────────────────────────────────────────────────

main().catch((err) => {
  console.error('ArticleVoice init failed:', err);
});
