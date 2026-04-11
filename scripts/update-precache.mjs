/**
 * Emit a Vite-aware service worker into `dist/`.
 *
 * Source of truth stays in the repo-root `sw.js`.
 * `SW_VERSION` remains manual there. This script only rewrites `PRECACHE`
 * against the actual emitted `dist/` files, then writes `dist/sw.js`.
 */

import { readFileSync, writeFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');
const templateSwPath = join(root, 'sw.js');
const distDir = join(root, 'dist');
const outputSwPath = join(distDir, 'sw.js');

export function collectDistFiles(dir, rootDir = dir) {
  const results = [];

  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...collectDistFiles(fullPath, rootDir));
      continue;
    }
    const relPath = relative(rootDir, fullPath).replace(/\\/g, '/');
    if (relPath === 'sw.js') continue;
    results.push(`./${relPath}`);
  }

  return results;
}

export function renderServiceWorker(template, precacheEntries) {
  const precacheRe = /const PRECACHE = \[[\s\S]*?\];/;
  if (!precacheRe.test(template)) {
    throw new Error('PRECACHE pattern not found in sw.js');
  }

  const escapedEntries = precacheEntries
    .map((entry) => entry.replace(/\\/g, '\\\\').replace(/'/g, "\\'"))
    .map((entry) => `  '${entry}',`)
    .join('\n');

  return template.replace(precacheRe, `const PRECACHE = [\n${escapedEntries}\n];`);
}

export function syncDistServiceWorker() {
  if (!existsSync(distDir) || !statSync(distDir).isDirectory()) {
    throw new Error('dist/ does not exist. Run `vite build` before update-precache.');
  }

  const template = readFileSync(templateSwPath, 'utf8');
  const precacheEntries = ['./', ...collectDistFiles(distDir).sort()];
  const rendered = renderServiceWorker(template, precacheEntries);
  writeFileSync(outputSwPath, rendered);
  return { outputSwPath, precacheEntries };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { outputSwPath, precacheEntries } = syncDistServiceWorker();
  console.log(`wrote ${outputSwPath} with ${precacheEntries.length} precache entries`);
}
