// Replaced in CI to a concrete release identifier.
export const APP_RELEASE = '__APP_RELEASE__';

export function shortRelease(release: string): string {
  if (!release || release === '__APP_RELEASE__') return 'dev';
  return release.length > 12 ? release.slice(0, 12) : release;
}
