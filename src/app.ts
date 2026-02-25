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
import { QueueRenderer } from './lib/queue-renderer.js';
import type { QueueItem } from './lib/queue-store.js';
import type { Language } from './lib/lang-detect.js';

const CONFIG = {
  PROXY_BASE: 'https://pixel-article-reader.fabian20ro.workers.dev',
  PROXY_SECRET: '', // Set at build time or leave empty if secret is not configured
  DEFAULT_RATE: 1.0,
  DEFAULT_LANG: 'auto' as 'auto' | Language,
};

const ALLOWED_LANG_PREFIXES = ['en', 'ro'];

/** Detect voice gender from name heuristics. Returns null if unknown. */
function detectVoiceGender(name: string): 'male' | 'female' | null {
  const lower = name.toLowerCase();
  if (/\bfemale\b/.test(lower) || /\bwoman\b/.test(lower)) return 'female';
  if (/\bmale\b/.test(lower)) return 'male';
  // Known voice names by gender (cross-platform)
  const knownFemale = [
    'samantha', 'victoria', 'karen', 'moira', 'tessa', 'fiona', 'veena',
    'ioana', 'sara', 'paulina', 'monica', 'luciana', 'joana', 'carmit',
    'ellen', 'mariska', 'milena', 'katya', 'yelda', 'lekha', 'damayanti',
    'alice', 'amelie', 'anna', 'helena', 'nora', 'zosia', 'ting-ting',
    'sin-ji', 'mei-jia', 'yuna', 'kyoko',
    'google us english', 'google uk english female',
  ];
  const knownMale = [
    'daniel', 'alex', 'tom', 'thomas', 'oliver', 'james', 'fred', 'ralph',
    'jorge', 'diego', 'juan', 'luca', 'xander', 'maged', 'tarik', 'rishi',
    'aaron', 'neel', 'gordon', 'lee',
    'google uk english male',
  ];
  for (const n of knownFemale) {
    if (lower === n || lower.startsWith(n + ' ')) return 'female';
  }
  for (const n of knownMale) {
    if (lower === n || lower.startsWith(n + ' ')) return 'male';
  }
  return null;
}

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

      // Auto-add to queue when article loads (skip if queue-driven load)
      const article = articleController.getCurrentArticle();
      if (article && queueController && !queueController.isLoadingItem()) {
        const items = queueController.getItems();
        const alreadyQueued = article.resolvedUrl &&
          items.some((i) => i.url === article.resolvedUrl);
        if (!alreadyQueued) {
          const item = queueController.addArticle(article);
          if (article.resolvedUrl) {
            queueController.syncCurrentByUrl(article.resolvedUrl);
          } else {
            queueController.syncCurrentById(item.id);
          }
        } else {
          queueController.syncCurrentByUrl(article.resolvedUrl);
        }
      }

      // Extract chapters (headings) from rendered article
      buildChaptersList();
    },
  });
  articleController.init();

  // ── Queue Controller ──────────────────────────────────────────
  queueController = new QueueController({
    articleController,
    tts,
    callbacks: {
      onQueueChange(items, currentIndex) {
        queueRenderer.render(items, currentIndex);
      },
      onAutoAdvanceCountdown(nextTitle) {
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

  // ── Drawer/sheet open-close utility ─────────────────────────────
  function openDrawer(panel: HTMLElement, overlay: HTMLElement): void {
    panel.classList.add('open');
    overlay.classList.remove('hidden');
    requestAnimationFrame(() => overlay.classList.add('open'));
  }

  function closeDrawer(panel: HTMLElement, overlay: HTMLElement): void {
    if (!panel.classList.contains('open')) return;
    panel.classList.remove('open');
    overlay.classList.remove('open');
    overlay.addEventListener('transitionend', () => {
      if (!overlay.classList.contains('open')) {
        overlay.classList.add('hidden');
      }
    }, { once: true });
  }

  const openQueueDrawer = () => openDrawer(refs.queueDrawer, refs.queueOverlay);
  const closeQueueDrawer = () => closeDrawer(refs.queueDrawer, refs.queueOverlay);

  refs.menuToggle.addEventListener('click', () => {
    const isOpen = refs.queueDrawer.classList.contains('open');
    if (isOpen) closeQueueDrawer(); else openQueueDrawer();
  });

  refs.queueOverlay.addEventListener('click', closeQueueDrawer);

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      if (refs.queueDrawer.classList.contains('open')) closeQueueDrawer();
      if (refs.settingsPanel.classList.contains('open')) closeSettingsDrawer();
      if (refs.chaptersSheet.classList.contains('open')) closeChaptersSheet();
    }
  });

  refs.queueClearBtn.addEventListener('click', () => {
    queueController!.clearAll();
    closeQueueDrawer();
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

  function showSnackbar(el: HTMLElement): void {
    el.classList.remove('hidden');
    requestAnimationFrame(() => el.classList.add('visible'));
  }

  function hideSnackbar(el: HTMLElement): void {
    if (!el.classList.contains('visible')) return;
    el.classList.remove('visible');
    el.addEventListener('transitionend', () => {
      if (!el.classList.contains('visible')) {
        el.classList.add('hidden');
      }
    }, { once: true });
  }

  const queueRenderer = new QueueRenderer(
    {
      queueBadge: refs.queueBadge,
      queueCount: refs.queueCount,
      queueEmpty: refs.queueEmpty,
      queueList: refs.queueList,
      nextArticleRow: refs.nextArticleRow,
      nextArticleTitle: refs.nextArticleTitle,
    },
    {
      onItemClick(itemId) {
        void queueController!.playItem(itemId).then(() => tts.play());
        closeQueueDrawer();
      },
      onItemShare(item) {
        void queueController!.shareItem(item);
      },
      onItemRemove(itemId) {
        queueController!.removeItem(itemId);
      },
      onReorder(reorderedIds) {
        const currentItems = queueController!.getItems();
        const newOrder = reorderedIds
          .map((id) => currentItems.find((i) => i.id === id))
          .filter(Boolean) as QueueItem[];
        if (newOrder.length === currentItems.length) {
          queueController!.reorder(newOrder);
        }
      },
    },
  );

  // Initial queue render
  queueRenderer.render(queueController.getItems(), queueController.getCurrentIndex());

  // ── Settings Drawer (right slide-in) ──────────────────────────
  const openSettingsDrawer = () => openDrawer(refs.settingsPanel, refs.settingsOverlay);
  const closeSettingsDrawer = () => closeDrawer(refs.settingsPanel, refs.settingsOverlay);

  refs.settingsToggle.addEventListener('click', () => {
    const isOpen = refs.settingsPanel.classList.contains('open');
    if (isOpen) closeSettingsDrawer(); else openSettingsDrawer();
  });

  refs.settingsOverlay.addEventListener('click', closeSettingsDrawer);

  // ── Chapters Bottom Sheet ─────────────────────────────────────
  const openChaptersSheet = () => openDrawer(refs.chaptersSheet, refs.chaptersOverlay);
  const closeChaptersSheet = () => closeDrawer(refs.chaptersSheet, refs.chaptersOverlay);

  refs.chaptersBtn.addEventListener('click', () => {
    const isOpen = refs.chaptersSheet.classList.contains('open');
    if (isOpen) closeChaptersSheet(); else openChaptersSheet();
  });

  refs.chaptersOverlay.addEventListener('click', closeChaptersSheet);

  function buildChaptersList(): void {
    const headings = refs.articleText.querySelectorAll<HTMLElement>('h1, h2, h3, h4, h5, h6');

    if (headings.length === 0) {
      (refs.chaptersBtn as HTMLButtonElement).disabled = true;
      return;
    }

    (refs.chaptersBtn as HTMLButtonElement).disabled = false;
    refs.chaptersList.innerHTML = '';

    headings.forEach((heading) => {
      const level = parseInt(heading.tagName.charAt(1), 10);
      const text = heading.textContent?.trim() ?? '';
      if (!text) return;

      const li = document.createElement('li');
      li.className = 'chapter-item';
      li.dataset.level = String(level);
      li.textContent = text;
      li.addEventListener('click', () => {
        // Sync TTS to this heading's paragraph so audio matches scroll.
        // The heading itself may be a .paragraph, or we walk forward to
        // find the first .paragraph sibling.
        let target: HTMLElement | null = heading.classList.contains('paragraph')
          ? heading : null;
        if (!target) {
          let sibling: Element | null = heading;
          while (sibling) {
            if (sibling.classList.contains('paragraph') && (sibling as HTMLElement).dataset.index != null) {
              target = sibling as HTMLElement;
              break;
            }
            sibling = sibling.nextElementSibling;
          }
        }
        if (target?.dataset.index != null) {
          tts.jumpToParagraph(parseInt(target.dataset.index, 10));
        } else {
          // Heading at end of article — jump to the last paragraph
          const allParas = refs.articleText.querySelectorAll<HTMLElement>('.paragraph[data-index]');
          if (allParas.length > 0) {
            tts.jumpToParagraph(parseInt(allParas[allParas.length - 1].dataset.index!, 10));
          }
        }

        heading.scrollIntoView({ behavior: 'smooth', block: 'start' });
        closeChaptersSheet();
      });
      refs.chaptersList.appendChild(li);
    });
  }

  // ── PWA Update Manager ────────────────────────────────────────
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
  refs.appVersion.textContent = `Version ${shortRelease(APP_RELEASE)}`;
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

  // Speed slider
  refs.settingsSpeed.value = String(settings.rate);
  refs.speedValue.textContent = settings.rate + 'x';
  refs.settingsSpeed.addEventListener('input', () => {
    const rate = parseFloat(refs.settingsSpeed.value);
    refs.speedValue.textContent = rate + 'x';
    tts.setRate(rate);
    settings.rate = rate;
    saveSettings(settings);
    updateSpeedButtons(rate);
  });

  // Voice selector
  populateVoices();
  refs.settingsVoice.addEventListener('change', () => {
    const name = refs.settingsVoice.value;
    if (name) tts.setVoice(name);
    settings.voiceName = name;
    saveSettings(settings);
  });

  // Voice gender selector
  refs.voiceGenderBtns.forEach((btn) => {
    btn.addEventListener('click', () => {
      const gender = btn.dataset.value as 'auto' | 'male' | 'female';
      settings.voiceGender = gender;
      saveSettings(settings);
      updateSegmentButtons(refs.voiceGenderBtns, gender);
      applyVoiceGender(gender);
    });
  });

  // Theme controls
  applyTheme(settings.theme);
  updateSegmentButtons(refs.themeBtns, settings.theme);

  refs.themeBtns.forEach((btn) => {
    btn.addEventListener('click', () => {
      const theme = btn.dataset.value as Theme;
      applyTheme(theme);
      settings.theme = theme;
      saveSettings(settings);
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
    saveSettings(settings);
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
      saveSettings(settings);
      refs.settingsSpeed.value = String(rate);
      refs.speedValue.textContent = rate + 'x';
      updateSpeedButtons(rate);
    });
  });

  refs.progressBar.addEventListener('click', (e) => {
    const total = tts.state.totalParagraphs;
    if (total === 0) return;

    queueController!.cancelAutoAdvance();
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
    saveSettings(settings);
    articleController.setLangOverride(lang);
  }


  function getAllowedVoices(): SpeechSynthesisVoice[] {
    return tts
      .getAvailableVoices()
      .filter((v) => ALLOWED_LANG_PREFIXES.some((p) => v.lang === p || v.lang.startsWith(p + '-')));
  }

  function populateVoices(): void {
    const voices = getAllowedVoices();

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

    // Show/hide gender selector based on whether we can detect genders
    const hasDetectableGenders = voices.some((v) => detectVoiceGender(v.name) !== null);
    if (hasDetectableGenders) {
      refs.voiceGenderGroup.classList.remove('hidden');
      updateSegmentButtons(refs.voiceGenderBtns, settings.voiceGender || 'auto');
      applyVoiceGender(settings.voiceGender || 'auto');
    } else {
      refs.voiceGenderGroup.classList.add('hidden');
    }
  }

  function applyVoiceGender(gender: 'auto' | 'male' | 'female'): void {
    if (gender === 'auto') {
      // Reset voice name and sync dropdown
      settings.voiceName = '';
      refs.settingsVoice.value = '';
      return;
    }

    const match = getAllowedVoices().find((v) => detectVoiceGender(v.name) === gender);
    if (match) {
      tts.setVoice(match.name);
      settings.voiceName = match.name;
      // Update the dropdown to show the selected voice
      refs.settingsVoice.value = match.name;
    }
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
