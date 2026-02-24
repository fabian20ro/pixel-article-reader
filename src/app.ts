/**
 * Article Local Reader — thin app bootstrap/orchestrator.
 */

import { TTSEngine } from './lib/tts-engine.js';
import { getAppDomRefs } from './lib/dom-refs.js';
import { loadSettings, saveSettings, type AppSettings, type Theme } from './lib/settings-store.js';
import { PwaUpdateManager } from './lib/pwa-update-manager.js';
import { ArticleController } from './lib/article-controller.js';
import { APP_RELEASE, shortRelease } from './lib/release.js';
import { QueueController } from './lib/queue-controller.js';
import { isValidArticleUrl } from './lib/url-utils.js';
import type { QueueItem } from './lib/queue-store.js';
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
  let queueController: QueueController | null = null;

  const tts = new TTSEngine({
    proxyBase: CONFIG.PROXY_BASE,
    proxySecret: CONFIG.PROXY_SECRET,
    callbacks: {
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
        // Delegate to queue controller for auto-advance
        if (queueController) {
          queueController.handleArticleEnd();
        }
        updateManager?.applyDeferredReloadIfIdle();
      },
      onError(msg) {
        refs.errorMessage.textContent = msg;
        refs.errorSection.classList.remove('hidden');
      },
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

      // Auto-add to queue when article loads
      const article = articleController.getCurrentArticle();
      if (article && queueController) {
        const items = queueController.getItems();
        const alreadyQueued = article.resolvedUrl &&
          items.some((i) => i.url === article.resolvedUrl);
        if (!alreadyQueued) {
          const item = queueController.addArticle(article);
          queueController.syncCurrentByUrl(article.resolvedUrl || item.id);
        } else {
          queueController.syncCurrentByUrl(article.resolvedUrl);
        }
      }
    },
  });
  articleController.init();

  // ── Queue Controller ──────────────────────────────────────────
  queueController = new QueueController({
    articleController,
    tts,
    callbacks: {
      onQueueChange(items, currentIndex) {
        renderQueueUI(items, currentIndex);
      },
      onAutoAdvanceCountdown(nextTitle, _secondsLeft) {
        refs.advanceText.textContent = `Up next: ${nextTitle}`;
        showSnackbar(refs.autoAdvanceToast);
      },
      onAutoAdvanceCancelled() {
        hideSnackbar(refs.autoAdvanceToast);
      },
      onError(msg) {
        refs.errorMessage.textContent = msg;
        refs.errorSection.classList.remove('hidden');
      },
    },
  });

  // Queue sheet open/close
  function openQueueSheet(): void {
    refs.queueSheet.classList.add('open');
    refs.queueOverlay.classList.remove('hidden');
    requestAnimationFrame(() => refs.queueOverlay.classList.add('open'));
  }

  function closeQueueSheet(): void {
    refs.queueSheet.classList.remove('open');
    refs.queueOverlay.classList.remove('open');
    refs.queueOverlay.addEventListener('transitionend', () => {
      if (!refs.queueOverlay.classList.contains('open')) {
        refs.queueOverlay.classList.add('hidden');
      }
    }, { once: true });
  }

  refs.queueBtn.addEventListener('click', () => {
    const isOpen = refs.queueSheet.classList.contains('open');
    if (isOpen) closeQueueSheet(); else openQueueSheet();
  });

  refs.queueOverlay.addEventListener('click', closeQueueSheet);

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && refs.queueSheet.classList.contains('open')) {
      closeQueueSheet();
    }
  });

  refs.queueClearBtn.addEventListener('click', () => {
    queueController!.clearAll();
    closeQueueSheet();
  });

  // Auto-advance toast buttons
  refs.advanceSkipBtn.addEventListener('click', () => {
    hideSnackbar(refs.autoAdvanceToast);
    queueController!.skipToNext();
  });

  refs.advanceCancelBtn.addEventListener('click', () => {
    hideSnackbar(refs.autoAdvanceToast);
    queueController!.cancelAutoAdvance();
  });

  // "Next:" row click
  refs.nextArticleRow.addEventListener('click', () => {
    queueController!.skipToNext();
  });

  // Snackbar: Play Now / Add to Queue
  let pendingSnackbarArticle: import('./lib/extractor.js').Article | null = null;
  let snackbarDismissTimer: ReturnType<typeof setTimeout> | null = null;

  refs.playNowBtn.addEventListener('click', () => {
    hideSnackbar(refs.addQueueSnackbar);
    if (pendingSnackbarArticle && queueController) {
      const item = queueController.addArticle(pendingSnackbarArticle);
      void queueController.playItem(item.id).then(() => tts.play());
    }
    pendingSnackbarArticle = null;
  });

  refs.addQueueBtn.addEventListener('click', () => {
    hideSnackbar(refs.addQueueSnackbar);
    if (pendingSnackbarArticle && queueController) {
      queueController.addArticle(pendingSnackbarArticle);
    }
    pendingSnackbarArticle = null;
  });

  function showSnackbar(el: HTMLElement): void {
    el.classList.remove('hidden');
    requestAnimationFrame(() => el.classList.add('visible'));
  }

  function hideSnackbar(el: HTMLElement): void {
    el.classList.remove('visible');
    el.addEventListener('transitionend', () => {
      if (!el.classList.contains('visible')) {
        el.classList.add('hidden');
      }
    }, { once: true });
  }

  function renderQueueUI(items: QueueItem[], currentIndex: number): void {
    // Badge
    if (items.length > 0) {
      refs.queueBadge.textContent = String(Math.min(items.length, 99));
      refs.queueBadge.classList.remove('hidden');
    } else {
      refs.queueBadge.classList.add('hidden');
    }

    // Count in sheet header
    refs.queueCount.textContent = String(items.length);

    // Empty state
    refs.queueEmpty.classList.toggle('hidden', items.length > 0);
    refs.queueList.classList.toggle('hidden', items.length === 0);

    // "Next:" row in player
    const nextItem = items[currentIndex + 1];
    if (nextItem) {
      refs.nextArticleTitle.textContent = nextItem.title;
      refs.nextArticleRow.classList.remove('hidden');
    } else {
      refs.nextArticleRow.classList.add('hidden');
    }

    // Render list
    refs.queueList.innerHTML = '';
    items.forEach((item, idx) => {
      const li = document.createElement('li');
      li.className = 'queue-item' + (idx === currentIndex ? ' playing' : '');
      li.setAttribute('role', 'listitem');

      // Indicator (position number or equalizer bars)
      const indicator = document.createElement('div');
      indicator.className = 'queue-item-indicator';
      if (idx === currentIndex) {
        indicator.innerHTML = '<div class="eq-bars"><div class="eq-bar"></div><div class="eq-bar"></div><div class="eq-bar"></div></div>';
      } else {
        indicator.textContent = String(idx + 1);
      }

      // Info
      const info = document.createElement('div');
      info.className = 'queue-item-info';

      const title = document.createElement('div');
      title.className = 'queue-item-title';
      title.textContent = item.title;

      const meta = document.createElement('div');
      meta.className = 'queue-item-meta';
      meta.textContent = [item.siteName, `${item.estimatedMinutes} min`].filter(Boolean).join(' \u00B7 ');

      info.appendChild(title);
      info.appendChild(meta);

      // Action buttons
      const actions = document.createElement('div');
      actions.className = 'queue-item-actions';

      const shareBtn = document.createElement('button');
      shareBtn.className = 'icon-btn';
      shareBtn.setAttribute('aria-label', 'Share');
      shareBtn.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 12v8a2 2 0 002 2h12a2 2 0 002-2v-8"/><polyline points="16 6 12 2 8 6"/><line x1="12" y1="2" x2="12" y2="15"/></svg>';
      shareBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        void queueController!.shareItem(item);
      });

      const deleteBtn = document.createElement('button');
      deleteBtn.className = 'icon-btn';
      deleteBtn.setAttribute('aria-label', 'Remove');
      deleteBtn.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>';
      deleteBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        queueController!.removeItem(item.id);
      });

      actions.appendChild(shareBtn);
      actions.appendChild(deleteBtn);

      li.appendChild(indicator);
      li.appendChild(info);
      li.appendChild(actions);

      // Click to play
      li.addEventListener('click', () => {
        void queueController!.playItem(item.id).then(() => tts.play());
        closeQueueSheet();
      });

      refs.queueList.appendChild(li);
    });
  }

  // Initial queue render
  renderQueueUI(queueController.getItems(), queueController.getCurrentIndex());

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

  // Settings drawer
  function openDrawer(): void {
    refs.settingsPanel.classList.add('open');
    refs.drawerOverlay.classList.remove('hidden');
    requestAnimationFrame(() => refs.drawerOverlay.classList.add('open'));
  }

  function closeDrawer(): void {
    refs.settingsPanel.classList.remove('open');
    refs.drawerOverlay.classList.remove('open');
    refs.drawerOverlay.addEventListener('transitionend', () => {
      if (!refs.drawerOverlay.classList.contains('open')) {
        refs.drawerOverlay.classList.add('hidden');
      }
    }, { once: true });
  }

  refs.settingsToggle.addEventListener('click', () => {
    const isOpen = refs.settingsPanel.classList.contains('open');
    if (isOpen) closeDrawer(); else openDrawer();
  });

  refs.drawerOverlay.addEventListener('click', closeDrawer);

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && refs.settingsPanel.classList.contains('open')) {
      closeDrawer();
    }
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

  // Theme controls
  applyTheme(settings.theme);
  updateSegmentButtons(refs.themeBtns, settings.theme);

  refs.themeBtns.forEach((btn) => {
    btn.addEventListener('click', () => {
      const theme = btn.dataset.value as Theme;
      applyTheme(theme);
      settings.theme = theme;
      persistSettings(settings);
      updateSegmentButtons(refs.themeBtns, theme);
    });
  });

  // Language controls
  updateSegmentButtons(refs.settingsLangBtns, settings.lang);

  refs.settingsLangBtns.forEach((btn) => {
    btn.addEventListener('click', () => {
      const lang = btn.dataset.value as 'auto' | Language;
      setLangOverride(lang);
      updateSegmentButtons(refs.settingsLangBtns, lang);
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

  // Clean up resources on page teardown (prevents battery drain on Android)
  window.addEventListener('pagehide', () => {
    tts.dispose();
    updateManager?.dispose();
  });

  await articleController.handleInitialSharedUrl();
  updateSpeedButtons(settings.rate);

  function applyTheme(theme: Theme): void {
    document.documentElement.setAttribute('data-theme', theme);
  }

  function updateSegmentButtons(btns: NodeListOf<HTMLButtonElement>, activeValue: string): void {
    btns.forEach((btn) => {
      btn.classList.toggle('active', btn.dataset.value === activeValue);
    });
  }

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
      .filter((v) => ALLOWED_LANG_PREFIXES.some((p) => v.lang === p || v.lang.startsWith(p + '-')));

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
    paragraphs.forEach((element) => {
      const elIndex = parseInt((element as HTMLElement).dataset.index ?? '-1', 10);
      element.classList.toggle('active', elIndex === index);
      element.classList.toggle('past', elIndex < index);
    });

    const target = refs.articleText.querySelector(`.paragraph[data-index="${index}"]`);
    if (target) {
      target.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }
}

interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

main().catch((err) => {
  console.error('Article Local Reader init failed:', err);
});
