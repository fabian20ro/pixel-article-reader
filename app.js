/**
 * ArticleVoice — main application orchestrator.
 *
 * Wires up URL handling, article extraction, TTS playback,
 * install-prompt, settings persistence, and all UI interactions.
 */
import { getUrlFromParams, extractUrl, clearQueryParams } from './lib/url-utils.js';
import { extractArticle, createArticleFromText } from './lib/extractor.js';
import { TTSEngine } from './lib/tts-engine.js';
import { needsTranslation, getSourceLang } from './lib/lang-detect.js';
import { translateParagraphs } from './lib/translator.js';
// ── Config ──────────────────────────────────────────────────────────
const CONFIG = {
    PROXY_BASE: 'https://pixel-article-reader.fabian20ro.workers.dev',
    PROXY_SECRET: '', // Set at build time or leave empty if secret is not configured
    DEFAULT_RATE: 1.0,
    DEFAULT_LANG: 'auto',
};
function loadSettings() {
    try {
        const raw = localStorage.getItem('articlevoice-settings');
        if (raw)
            return JSON.parse(raw);
    }
    catch { /* use defaults */ }
    return {
        rate: CONFIG.DEFAULT_RATE,
        lang: CONFIG.DEFAULT_LANG,
        voiceName: '',
        wakeLock: true,
    };
}
function saveSettings(s) {
    localStorage.setItem('articlevoice-settings', JSON.stringify(s));
}
// ── DOM refs ────────────────────────────────────────────────────────
function $(id) {
    return document.getElementById(id);
}
// ── Main ────────────────────────────────────────────────────────────
async function main() {
    // Register service worker with auto-update on new version
    let swRegistration;
    if ('serviceWorker' in navigator) {
        let refreshing = false;
        navigator.serviceWorker.addEventListener('controllerchange', () => {
            if (refreshing)
                return;
            refreshing = true;
            window.location.reload();
        });
        swRegistration = await navigator.serviceWorker.register('sw.js').catch(() => undefined);
    }
    const settings = loadSettings();
    let currentArticle = null;
    let currentArticleUrl = '';
    let currentLangOverride = settings.lang;
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
    if (settings.voiceName)
        tts.setVoice(settings.voiceName);
    tts.setWakeLock(settings.wakeLock);
    // ── DOM elements ────────────────────────────────────────────────
    const urlInput = $('url-input');
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
    const translateBtn = $('translate-btn');
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
    const settingsSpeed = $('settings-speed');
    const speedValue = $('speed-value');
    const settingsVoice = $('settings-voice');
    const settingsWakelock = $('settings-wakelock');
    const checkUpdateBtn = $('check-update-btn');
    const updateStatus = $('update-status');
    const installBanner = $('install-banner');
    const installBtn = $('install-btn');
    const installDismiss = $('install-dismiss');
    // ── Install prompt ──────────────────────────────────────────────
    let deferredInstallPrompt = null;
    window.addEventListener('beforeinstallprompt', (e) => {
        e.preventDefault();
        deferredInstallPrompt = e;
        // Show banner if not previously dismissed
        const dismissed = localStorage.getItem('articlevoice-install-dismissed');
        if (!dismissed) {
            installBanner.classList.remove('hidden');
        }
    });
    installBtn.addEventListener('click', async () => {
        if (!deferredInstallPrompt)
            return;
        installBanner.classList.add('hidden');
        await deferredInstallPrompt.prompt();
        deferredInstallPrompt = null;
    });
    installDismiss.addEventListener('click', () => {
        installBanner.classList.add('hidden');
        localStorage.setItem('articlevoice-install-dismissed', '1');
    });
    // ── Check for updates button ───────────────────────────────────
    checkUpdateBtn.addEventListener('click', async () => {
        updateStatus.textContent = 'Checking...';
        try {
            if (swRegistration) {
                await swRegistration.update();
            }
            // If a new SW was found, controllerchange will reload the page.
            // Otherwise clear caches and hard-reload to pick up any changes.
            const keys = await caches.keys();
            await Promise.all(keys.map((k) => caches.delete(k)));
            updateStatus.textContent = 'Reloading...';
            window.location.reload();
        }
        catch {
            updateStatus.textContent = 'Update check failed. Try again.';
        }
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
    const ALLOWED_VOICES = ['Ioana', 'Samantha'];
    populateVoices();
    function populateVoices() {
        const voices = tts.getAvailableVoices()
            .filter((v) => ALLOWED_VOICES.includes(v.name));
        settingsVoice.innerHTML = '<option value="">Default</option>';
        voices.forEach((v) => {
            const opt = document.createElement('option');
            opt.value = v.name;
            opt.textContent = `${v.name} (${v.lang})`;
            if (v.name === settings.voiceName)
                opt.selected = true;
            settingsVoice.appendChild(opt);
        });
    }
    settingsVoice.addEventListener('change', () => {
        const name = settingsVoice.value;
        if (name)
            tts.setVoice(name);
        settings.voiceName = name;
        saveSettings(settings);
    });
    // Language radio (settings panel)
    const settingsLangRadios = document.querySelectorAll('input[name="settings-lang"]');
    settingsLangRadios.forEach((radio) => {
        if (radio.value === settings.lang)
            radio.checked = true;
        radio.addEventListener('change', () => {
            const val = radio.value;
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
        if (e.key === 'Enter')
            handleUrlSubmit();
    });
    function handleUrlSubmit() {
        const raw = urlInput.value.trim();
        if (!raw)
            return;
        const url = extractUrl(raw);
        if (url) {
            loadArticle(url);
            return;
        }
        // No URL found — treat as pasted article text
        tts.stop();
        try {
            const article = createArticleFromText(raw);
            currentArticle = article;
            currentArticleUrl = '';
            displayArticle(article);
        }
        catch (err) {
            const msg = err instanceof Error ? err.message : 'Could not parse the pasted text.';
            showError(msg);
        }
    }
    // ── Player controls ─────────────────────────────────────────────
    playPauseBtn.addEventListener('click', () => {
        if (tts.state.isPaused) {
            tts.resume();
        }
        else if (tts.state.isPlaying) {
            tts.pause();
        }
        else {
            tts.play();
        }
    });
    skipForwardBtn.addEventListener('click', () => tts.skipForward());
    skipBackBtn.addEventListener('click', () => tts.skipBackward());
    skipSentenceForwardBtn.addEventListener('click', () => tts.skipSentenceForward());
    skipSentenceBackBtn.addEventListener('click', () => tts.skipSentenceBackward());
    // Speed preset buttons
    const speedBtns = document.querySelectorAll('.speed-btn');
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
    function updateSpeedButtons(rate) {
        speedBtns.forEach((b) => {
            b.classList.toggle('active', parseFloat(b.dataset.rate ?? '0') === rate);
        });
    }
    // Language radio (player)
    const playerLangRadios = document.querySelectorAll('input[name="player-lang"]');
    playerLangRadios.forEach((radio) => {
        radio.addEventListener('change', () => {
            const val = radio.value;
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
        if (!currentArticle)
            return;
        const rect = progressBar.getBoundingClientRect();
        const ratio = (e.clientX - rect.left) / rect.width;
        const idx = Math.floor(ratio * currentArticle.paragraphs.length);
        tts.jumpToParagraph(idx);
    });
    // ── Translate button ────────────────────────────────────────────
    translateBtn.addEventListener('click', async () => {
        if (!currentArticle)
            return;
        const savedLabel = translateBtn.textContent;
        translateBtn.disabled = true;
        translateBtn.textContent = 'Translating...';
        try {
            const sourceLang = getSourceLang(currentArticle.htmlLang, currentArticleUrl);
            const translated = await translateParagraphs(currentArticle.paragraphs, sourceLang, 'en', CONFIG.PROXY_BASE, CONFIG.PROXY_SECRET);
            // Update article with translated content
            currentArticle.paragraphs = translated;
            currentArticle.textContent = translated.join('\n\n');
            currentArticle.lang = 'en';
            currentArticle.htmlLang = 'en';
            // Re-render
            displayArticle(currentArticle);
            // Hide translate button after successful translation
            translateBtn.classList.add('hidden');
        }
        catch (err) {
            const msg = err instanceof Error ? err.message : 'Translation failed.';
            translateBtn.textContent = savedLabel;
            translateBtn.disabled = false;
            showError(msg);
        }
    });
    // ── Article loading ─────────────────────────────────────────────
    async function loadArticle(url) {
        showView('loading');
        loadingMessage.textContent = 'Extracting article...';
        tts.stop();
        try {
            const article = await extractArticle(url, CONFIG.PROXY_BASE, CONFIG.PROXY_SECRET);
            currentArticle = article;
            currentArticleUrl = article.resolvedUrl;
            displayArticle(article);
        }
        catch (err) {
            const msg = err instanceof Error ? err.message : 'Unknown error occurred.';
            showError(msg);
        }
    }
    function displayArticle(article) {
        articleTitle.textContent = article.title;
        const lang = currentLangOverride === 'auto' ? article.lang : currentLangOverride;
        articleInfo.textContent = [
            article.siteName,
            `${article.estimatedMinutes} min`,
            lang.toUpperCase(),
            `${article.wordCount} words`,
        ].join(' \u00B7 ');
        // Translate button — show when article needs translation (non-EN, non-RO)
        const showTranslate = needsTranslation(article.htmlLang, currentArticleUrl, article.lang);
        translateBtn.classList.toggle('hidden', !showTranslate);
        translateBtn.disabled = false;
        translateBtn.textContent = 'Translate to English';
        // Render paragraphs
        articleText.innerHTML = '';
        article.paragraphs.forEach((p, i) => {
            const div = document.createElement('div');
            div.className = 'paragraph';
            div.textContent = p;
            div.dataset.index = String(i);
            div.addEventListener('click', () => {
                tts.jumpToParagraph(i);
                if (!tts.state.isPlaying)
                    tts.play();
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
    function showView(view) {
        inputSection.classList.toggle('hidden', view !== 'input' && view !== 'article');
        loadingSection.classList.toggle('hidden', view !== 'loading');
        errorSection.classList.toggle('hidden', view !== 'error');
        articleSection.classList.toggle('hidden', view !== 'article');
        if (view !== 'article') {
            playerControls.classList.add('hidden');
        }
    }
    function showError(msg) {
        errorMessage.textContent = msg;
        showView('error');
    }
    errorRetry.addEventListener('click', () => {
        showView('input');
        urlInput.focus();
    });
    function updatePlayButton(isPlaying, isPaused) {
        if (isPlaying && !isPaused) {
            playIcon.classList.add('hidden');
            pauseIcon.classList.remove('hidden');
            playPauseBtn.setAttribute('aria-label', 'Pause');
        }
        else {
            playIcon.classList.remove('hidden');
            pauseIcon.classList.add('hidden');
            playPauseBtn.setAttribute('aria-label', 'Play');
        }
    }
    function updateProgress(current, total) {
        const pct = total > 0 ? (current / total) * 100 : 0;
        progressFill.style.width = pct + '%';
        progressText.textContent = `${current + 1} / ${total}`;
    }
    function highlightParagraph(index) {
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
