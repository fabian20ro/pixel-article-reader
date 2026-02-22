export interface AppDomRefs {
  urlInput: HTMLInputElement;
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
  settingsToggle: HTMLElement;
  settingsPanel: HTMLElement;
  settingsSpeed: HTMLInputElement;
  speedValue: HTMLElement;
  settingsVoice: HTMLSelectElement;
  settingsWakelock: HTMLInputElement;
  checkUpdateBtn: HTMLElement;
  updateStatus: HTMLElement;
  installBanner: HTMLElement;
  installBtn: HTMLElement;
  installDismiss: HTMLElement;
  speedBtns: NodeListOf<HTMLButtonElement>;
  themeBtns: NodeListOf<HTMLButtonElement>;
  settingsLangBtns: NodeListOf<HTMLButtonElement>;
  playerLangBtns: NodeListOf<HTMLButtonElement>;
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
    urlInput: requireElement<HTMLInputElement>('url-input', root),
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
    settingsToggle: requireElement('settings-toggle', root),
    settingsPanel: requireElement('settings-panel', root),
    settingsSpeed: requireElement<HTMLInputElement>('settings-speed', root),
    speedValue: requireElement('speed-value', root),
    settingsVoice: requireElement<HTMLSelectElement>('settings-voice', root),
    settingsWakelock: requireElement<HTMLInputElement>('settings-wakelock', root),
    checkUpdateBtn: requireElement('check-update-btn', root),
    updateStatus: requireElement('update-status', root),
    installBanner: requireElement('install-banner', root),
    installBtn: requireElement('install-btn', root),
    installDismiss: requireElement('install-dismiss', root),
    speedBtns: root.querySelectorAll<HTMLButtonElement>('.speed-btn'),
    themeBtns: root.querySelectorAll<HTMLButtonElement>('#theme-selector .segment-btn'),
    settingsLangBtns: root.querySelectorAll<HTMLButtonElement>('#settings-lang-selector .segment-btn'),
    playerLangBtns: root.querySelectorAll<HTMLButtonElement>('#player-lang-selector .segment-btn'),
  };
}
