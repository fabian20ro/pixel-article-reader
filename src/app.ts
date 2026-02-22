/**
 * ArticleVoice — thin app bootstrap/orchestrator.
 */

import { TTSEngine } from './lib/tts-engine.js';
import { getAppDomRefs } from './lib/dom-refs.js';
import { loadSettings, saveSettings, type AppSettings } from './lib/settings-store.js';
import { PwaUpdateManager } from './lib/pwa-update-manager.js';
import { ArticleController } from './lib/article-controller.js';
import { APP_RELEASE, shortRelease } from './lib/release.js';
import type { Language } from './lib/lang-detect.js';

const CONFIG = {
  PROXY_BASE: 'https://pixel-article-reader.fabian20ro.workers.dev',
  PROXY_SECRET: '', // Set at build time or leave empty if secret is not configured
  DEFAULT_RATE: 1.0,
  DEFAULT_LANG: 'auto' as 'auto' | Language,
};

const ALLOWED_LANG_PREFIXES = ['en', 'ro'];

async function main(): Promise<void> {
  const refs = getAppDomRefs();

  const settings = loadSettings({
    defaultRate: CONFIG.DEFAULT_RATE,
    defaultLang: CONFIG.DEFAULT_LANG,
  });

  let updateManager: PwaUpdateManager | null = null;

  const tts = new TTSEngine({
    onStateChange(state) {
      updatePlayButton(state.isPlaying, state.isPaused);
      if (updateManager && (!state.isPlaying || state.isPaused)) {
        updateManager.applyDeferredReloadIfIdle();
      }
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
      updateManager?.applyDeferredReloadIfIdle();
    },
    onError(msg) {
      refs.errorMessage.textContent = msg;
      refs.errorSection.classList.remove('hidden');
    },
  });

  await tts.init();
  tts.setRate(settings.rate);
  if (settings.voiceName) tts.setVoice(settings.voiceName);
  tts.setWakeLock(settings.wakeLock);

  const articleController = new ArticleController({
    refs,
    tts,
    proxyBase: CONFIG.PROXY_BASE,
    proxySecret: CONFIG.PROXY_SECRET,
    initialLangOverride: settings.lang,
    onArticleRendered(totalParagraphs) {
      updateProgress(0, totalParagraphs);
      highlightParagraph(0);
    },
  });
  articleController.init();

  updateManager = new PwaUpdateManager({
    onStatus(status) {
      refs.updateStatus.textContent = status;
    },
    onUpdateReady() {
      refs.updateStatus.textContent = 'Update ready. Pause playback to apply.';
    },
    isPlaybackActive() {
      return tts.state.isPlaying && !tts.state.isPaused;
    },
  });

  refs.updateStatus.textContent = `Build ${shortRelease(APP_RELEASE)}`;
  await updateManager.init('sw.js');

  // Install prompt
  let deferredInstallPrompt: BeforeInstallPromptEvent | null = null;
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredInstallPrompt = e as BeforeInstallPromptEvent;
    const dismissed = localStorage.getItem('articlevoice-install-dismissed');
    if (!dismissed) {
      refs.installBanner.classList.remove('hidden');
    }
  });

  refs.installBtn.addEventListener('click', async () => {
    if (!deferredInstallPrompt) return;
    refs.installBanner.classList.add('hidden');
    await deferredInstallPrompt.prompt();
    deferredInstallPrompt = null;
  });

  refs.installDismiss.addEventListener('click', () => {
    refs.installBanner.classList.add('hidden');
    localStorage.setItem('articlevoice-install-dismissed', '1');
  });

  // Check updates button (break-glass)
  refs.checkUpdateBtn.addEventListener('click', () => {
    void updateManager?.forceRefresh();
  });

  // Settings panel
  refs.settingsToggle.addEventListener('click', () => {
    refs.settingsPanel.classList.toggle('hidden');
  });

  // Speed slider
  refs.settingsSpeed.value = String(settings.rate);
  refs.speedValue.textContent = settings.rate + 'x';
  refs.settingsSpeed.addEventListener('input', () => {
    const rate = parseFloat(refs.settingsSpeed.value);
    refs.speedValue.textContent = rate + 'x';
    tts.setRate(rate);
    settings.rate = rate;
    persistSettings(settings);
    updateSpeedButtons(rate);
  });

  // Voice selector
  populateVoices();
  refs.settingsVoice.addEventListener('change', () => {
    const name = refs.settingsVoice.value;
    if (name) tts.setVoice(name);
    settings.voiceName = name;
    persistSettings(settings);
  });

  // Language controls
  refs.settingsLangRadios.forEach((radio) => {
    radio.addEventListener('change', () => {
      setLangOverride(radio.value as 'auto' | Language);
    });
  });

  refs.playerLangRadios.forEach((radio) => {
    radio.addEventListener('change', () => {
      setLangOverride(radio.value as 'auto' | Language);
    });
  });

  // Wake lock
  refs.settingsWakelock.checked = settings.wakeLock;
  refs.settingsWakelock.addEventListener('change', () => {
    settings.wakeLock = refs.settingsWakelock.checked;
    tts.setWakeLock(settings.wakeLock);
    persistSettings(settings);
  });

  // Player controls
  refs.playPauseBtn.addEventListener('click', () => {
    if (tts.state.isPaused) {
      tts.resume();
    } else if (tts.state.isPlaying) {
      tts.pause();
    } else {
      tts.play();
    }
  });

  refs.skipForwardBtn.addEventListener('click', () => tts.skipForward());
  refs.skipBackBtn.addEventListener('click', () => tts.skipBackward());
  refs.skipSentenceForwardBtn.addEventListener('click', () => tts.skipSentenceForward());
  refs.skipSentenceBackBtn.addEventListener('click', () => tts.skipSentenceBackward());

  refs.speedBtns.forEach((btn) => {
    btn.addEventListener('click', () => {
      const rate = parseFloat(btn.dataset.rate ?? '1');
      tts.setRate(rate);
      settings.rate = rate;
      persistSettings(settings);
      refs.settingsSpeed.value = String(rate);
      refs.speedValue.textContent = rate + 'x';
      updateSpeedButtons(rate);
    });
  });

  refs.progressBar.addEventListener('click', (e) => {
    const total = tts.state.totalParagraphs;
    if (total === 0) return;

    const rect = refs.progressBar.getBoundingClientRect();
    const ratio = (e.clientX - rect.left) / rect.width;
    const idx = Math.max(0, Math.min(total - 1, Math.floor(ratio * total)));
    tts.jumpToParagraph(idx);
  });

  await articleController.handleInitialSharedUrl();
  updateSpeedButtons(settings.rate);

  function setLangOverride(lang: 'auto' | Language): void {
    settings.lang = lang;
    persistSettings(settings);
    articleController.setLangOverride(lang);
  }

  function persistSettings(value: AppSettings): void {
    saveSettings(value);
  }

  function populateVoices(): void {
    const voices = tts
      .getAvailableVoices()
      .filter((v) => ALLOWED_LANG_PREFIXES.some((p) => v.lang.startsWith(p)));

    // Sort: group by language, then alphabetically by name within each group
    voices.sort((a, b) => {
      const langCmp = a.lang.localeCompare(b.lang);
      if (langCmp !== 0) return langCmp;
      return a.name.localeCompare(b.name);
    });

    refs.settingsVoice.innerHTML = '<option value="">Auto</option>';
    voices.forEach((voice) => {
      const opt = document.createElement('option');
      opt.value = voice.name;
      opt.textContent = `${voice.name} (${voice.lang})`;
      if (voice.name === settings.voiceName) opt.selected = true;
      refs.settingsVoice.appendChild(opt);
    });
  }

  function updateSpeedButtons(rate: number): void {
    refs.speedBtns.forEach((button) => {
      button.classList.toggle('active', parseFloat(button.dataset.rate ?? '0') === rate);
    });
  }

  function updatePlayButton(isPlaying: boolean, isPaused: boolean): void {
    if (isPlaying && !isPaused) {
      refs.playIcon.classList.add('hidden');
      refs.pauseIcon.classList.remove('hidden');
      refs.playPauseBtn.setAttribute('aria-label', 'Pause');
    } else {
      refs.playIcon.classList.remove('hidden');
      refs.pauseIcon.classList.add('hidden');
      refs.playPauseBtn.setAttribute('aria-label', 'Play');
    }
  }

  function updateProgress(current: number, total: number): void {
    const pct = total > 0 ? (current / total) * 100 : 0;
    refs.progressFill.style.width = pct + '%';
    refs.progressText.textContent = `${Math.min(current + 1, total)} / ${total}`;
  }

  function highlightParagraph(index: number): void {
    const paragraphs = refs.articleText.querySelectorAll('.paragraph');
    paragraphs.forEach((element, i) => {
      element.classList.toggle('active', i === index);
      element.classList.toggle('past', i < index);
    });

    if (index >= 0 && index < paragraphs.length) {
      paragraphs[index].scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }
}

interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

main().catch((err) => {
  console.error('ArticleVoice init failed:', err);
});
