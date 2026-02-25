export interface AppDomRefs {
  urlInput: HTMLTextAreaElement;
  goBtn: HTMLElement;
  inputSection: HTMLElement;
  loadingSection: HTMLElement;
  loadingMessage: HTMLElement;
  errorSection: HTMLElement;
  errorMessage: HTMLElement;
  errorRetry: HTMLElement;
  articleSection: HTMLElement;
  articleTitle: HTMLElement;
  articleInfo: HTMLElement;
  translateBtn: HTMLButtonElement;
  jinaRetryBtn: HTMLButtonElement;
  copyMdBtn: HTMLButtonElement;
  articleText: HTMLElement;
  playerControls: HTMLElement;
  playPauseBtn: HTMLElement;
  playIcon: HTMLElement;
  pauseIcon: HTMLElement;
  skipForwardBtn: HTMLElement;
  skipBackBtn: HTMLElement;
  skipSentenceForwardBtn: HTMLElement;
  skipSentenceBackBtn: HTMLElement;
  progressFill: HTMLElement;
  progressText: HTMLElement;
  progressBar: HTMLElement;
  // Settings drawer (right)
  settingsToggle: HTMLElement;
  settingsPanel: HTMLElement;
  settingsOverlay: HTMLElement;
  settingsSpeed: HTMLInputElement;
  speedValue: HTMLElement;
  settingsVoice: HTMLSelectElement;
  settingsWakelock: HTMLInputElement;
  checkUpdateBtn: HTMLElement;
  updateStatus: HTMLElement;
  voiceGenderGroup: HTMLElement;
  voiceGenderBtns: NodeListOf<HTMLButtonElement>;
  fileInput: HTMLInputElement;
  fileBtn: HTMLElement;
  installBanner: HTMLElement;
  installBtn: HTMLElement;
  installDismiss: HTMLElement;
  speedBtns: NodeListOf<HTMLButtonElement>;
  themeBtns: NodeListOf<HTMLButtonElement>;
  settingsLangBtns: NodeListOf<HTMLButtonElement>;
  // Queue drawer (left)
  menuToggle: HTMLElement;
  queueDrawer: HTMLElement;
  queueOverlay: HTMLElement;
  queueBadge: HTMLElement;
  queueList: HTMLElement;
  queueEmpty: HTMLElement;
  queueCount: HTMLElement;
  queueClearBtn: HTMLElement;
  nextArticleRow: HTMLElement;
  nextArticleTitle: HTMLElement;
  addQueueSnackbar: HTMLElement;
  snackbarTitle: HTMLElement;
  playNowBtn: HTMLElement;
  addQueueBtn: HTMLElement;
  autoAdvanceToast: HTMLElement;
  advanceText: HTMLElement;
  advanceSkipBtn: HTMLElement;
  advanceCancelBtn: HTMLElement;
  // Chapters
  chaptersBtn: HTMLElement;
  chaptersSheet: HTMLElement;
  chaptersOverlay: HTMLElement;
  chaptersList: HTMLElement;
  appVersion: HTMLElement;
}

function requireElement<T extends HTMLElement>(id: string, root: Document): T {
  const element = root.getElementById(id);
  if (!element) {
    throw new Error(`Missing required element: #${id}`);
  }
  return element as T;
}

export function getAppDomRefs(root: Document = document): AppDomRefs {
  return {
    urlInput: requireElement<HTMLTextAreaElement>('url-input', root),
    goBtn: requireElement('go-btn', root),
    inputSection: requireElement('input-section', root),
    loadingSection: requireElement('loading-section', root),
    loadingMessage: requireElement('loading-message', root),
    errorSection: requireElement('error-section', root),
    errorMessage: requireElement('error-message', root),
    errorRetry: requireElement('error-retry', root),
    articleSection: requireElement('article-section', root),
    articleTitle: requireElement('article-title', root),
    articleInfo: requireElement('article-info', root),
    translateBtn: requireElement<HTMLButtonElement>('translate-btn', root),
    jinaRetryBtn: requireElement<HTMLButtonElement>('jina-retry-btn', root),
    copyMdBtn: requireElement<HTMLButtonElement>('copy-md-btn', root),
    articleText: requireElement('article-text', root),
    playerControls: requireElement('player-controls', root),
    playPauseBtn: requireElement('play-pause', root),
    playIcon: requireElement('play-icon', root),
    pauseIcon: requireElement('pause-icon', root),
    skipForwardBtn: requireElement('skip-forward', root),
    skipBackBtn: requireElement('skip-back', root),
    skipSentenceForwardBtn: requireElement('skip-sentence-forward', root),
    skipSentenceBackBtn: requireElement('skip-sentence-back', root),
    progressFill: requireElement('progress-fill', root),
    progressText: requireElement('progress-text', root),
    progressBar: requireElement('progress-bar', root),
    // Settings drawer (right)
    settingsToggle: requireElement('settings-toggle', root),
    settingsPanel: requireElement('settings-panel', root),
    settingsOverlay: requireElement('settings-overlay', root),
    settingsSpeed: requireElement<HTMLInputElement>('settings-speed', root),
    speedValue: requireElement('speed-value', root),
    settingsVoice: requireElement<HTMLSelectElement>('settings-voice', root),
    settingsWakelock: requireElement<HTMLInputElement>('settings-wakelock', root),
    checkUpdateBtn: requireElement('check-update-btn', root),
    updateStatus: requireElement('update-status', root),
    voiceGenderGroup: requireElement('voice-gender-group', root),
    voiceGenderBtns: root.querySelectorAll<HTMLButtonElement>('#voice-gender-selector .segment-btn'),
    fileInput: requireElement<HTMLInputElement>('file-input', root),
    fileBtn: requireElement('file-btn', root),
    installBanner: requireElement('install-banner', root),
    installBtn: requireElement('install-btn', root),
    installDismiss: requireElement('install-dismiss', root),
    speedBtns: root.querySelectorAll<HTMLButtonElement>('#speed-selector .segment-btn'),
    themeBtns: root.querySelectorAll<HTMLButtonElement>('#theme-selector .segment-btn'),
    settingsLangBtns: root.querySelectorAll<HTMLButtonElement>('#settings-lang-selector .segment-btn'),
    // Queue drawer (left)
    menuToggle: requireElement('menu-toggle', root),
    queueDrawer: requireElement('queue-drawer', root),
    queueOverlay: requireElement('queue-overlay', root),
    queueBadge: requireElement('queue-badge', root),
    queueList: requireElement('queue-list', root),
    queueEmpty: requireElement('queue-empty', root),
    queueCount: requireElement('queue-count', root),
    queueClearBtn: requireElement('queue-clear-btn', root),
    nextArticleRow: requireElement('next-article-row', root),
    nextArticleTitle: requireElement('next-article-title', root),
    addQueueSnackbar: requireElement('add-queue-snackbar', root),
    snackbarTitle: requireElement('snackbar-title', root),
    playNowBtn: requireElement('play-now-btn', root),
    addQueueBtn: requireElement('add-queue-btn', root),
    autoAdvanceToast: requireElement('auto-advance-toast', root),
    advanceText: requireElement('advance-text', root),
    advanceSkipBtn: requireElement('advance-skip-btn', root),
    advanceCancelBtn: requireElement('advance-cancel-btn', root),
    // Chapters
    chaptersBtn: requireElement('chapters-btn', root),
    chaptersSheet: requireElement('chapters-sheet', root),
    chaptersOverlay: requireElement('chapters-overlay', root),
    chaptersList: requireElement('chapters-list', root),
    appVersion: requireElement('app-version', root),
  };
}
