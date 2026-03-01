/**
 * Generic UI helpers — drawer, snackbar, and segment button utilities.
 *
 * Extracted from app.ts for reuse and testability.
 */

/** Open a slide-in drawer panel with overlay fade-in. */
export function openDrawer(panel: HTMLElement, overlay: HTMLElement): void {
  panel.classList.add('open');
  overlay.classList.remove('hidden');
  requestAnimationFrame(() => overlay.classList.add('open'));
}

/** Close a slide-in drawer panel with overlay fade-out. */
export function closeDrawer(panel: HTMLElement, overlay: HTMLElement): void {
  if (!panel.classList.contains('open')) return;
  panel.classList.remove('open');
  overlay.classList.remove('open');
  overlay.addEventListener('transitionend', () => {
    if (!overlay.classList.contains('open')) {
      overlay.classList.add('hidden');
    }
  }, { once: true });
}

/** Show a snackbar/toast element with transition. */
export function showSnackbar(el: HTMLElement): void {
  el.classList.remove('hidden');
  requestAnimationFrame(() => el.classList.add('visible'));
}

/** Hide a snackbar/toast element with transition. */
export function hideSnackbar(el: HTMLElement): void {
  if (!el.classList.contains('visible')) return;
  el.classList.remove('visible');
  el.addEventListener('transitionend', () => {
    if (!el.classList.contains('visible')) {
      el.classList.add('hidden');
    }
  }, { once: true });
}

/** Toggle 'active' class on segment buttons based on value. */
export function updateSegmentButtons(btns: NodeListOf<HTMLButtonElement>, activeValue: string): void {
  btns.forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.value === activeValue);
  });
}
