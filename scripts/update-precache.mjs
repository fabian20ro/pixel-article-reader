/**
 * Emit a Vite-aware service worker into `dist/`.
 *
 * Source of truth stays in the repo-root `sw.js`.
 * `SW_VERSION` remains manual there. This script only rewrites `PRECACHE`
 * against the actual emitted `dist/` files, then writes `dist/sw.js`.
 */

import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { join, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');
const templateSwPath = join(root, 'sw.js');
const manifestSourcePath = join(root, 'manifest.json');
const iconsSourceDir = join(root, 'icons');
const pdfWorkerSourcePath = join(root, 'vendor', 'pdfjs', 'pdf.worker.min.mjs');
const distDir = join(root, 'dist');
const outputSwPath = join(distDir, 'sw.js');
const distIndexPath = join(distDir, 'index.html');
const distManifestPath = join(distDir, 'manifest.webmanifest');
const distIconsDir = join(distDir, 'icons');
const distPdfWorkerDir = join(distDir, 'vendor', 'pdfjs');
const distAssetsDir = join(distDir, 'assets');
const STABLE_ICON_PATH = './icons/icon-192.png';
const STABLE_MANIFEST_PATH = './manifest.webmanifest';
const STABLE_PDF_WORKER_PATH = './vendor/pdfjs/pdf.worker.min.mjs';

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

export function renderStableManifest(source) {
  const manifest = JSON.parse(source);
  manifest.icons = [
    { src: './icons/icon-192.png', sizes: '192x192', type: 'image/png' },
    { src: './icons/icon-512.png', sizes: '512x512', type: 'image/png' },
  ];
  return JSON.stringify(manifest, null, 2) + '\n';
}

export function rewriteIndexHtmlForStableAssets(html) {
  return html
    .replace(/<link rel="manifest" href="[^"]+">/, `<link rel="manifest" href="${STABLE_MANIFEST_PATH}">`)
    .replace(/<link rel="icon" type="image\/png" sizes="192x192" href="[^"]+">/, `<link rel="icon" type="image/png" sizes="192x192" href="${STABLE_ICON_PATH}">`)
    .replace(/<link rel="apple-touch-icon" href="[^"]+">/, `<link rel="apple-touch-icon" href="${STABLE_ICON_PATH}">`);
}

export function syncStableRuntimeAssets() {
  mkdirSync(distIconsDir, { recursive: true });
  mkdirSync(distPdfWorkerDir, { recursive: true });

  writeFileSync(distManifestPath, renderStableManifest(readFileSync(manifestSourcePath, 'utf8')));
  writeFileSync(distIndexPath, rewriteIndexHtmlForStableAssets(readFileSync(distIndexPath, 'utf8')));

  copyFileSync(join(iconsSourceDir, 'icon-192.png'), join(distIconsDir, 'icon-192.png'));
  copyFileSync(join(iconsSourceDir, 'icon-512.png'), join(distIconsDir, 'icon-512.png'));
  copyFileSync(pdfWorkerSourcePath, join(distPdfWorkerDir, 'pdf.worker.min.mjs'));

  if (existsSync(distAssetsDir)) {
    for (const entry of readdirSync(distAssetsDir)) {
      if (/^manifest-.*\.json$/.test(entry) || /^icon-(192|512)-.*\.png$/.test(entry)) {
        unlinkSync(join(distAssetsDir, entry));
      }
    }
  }
}

export function syncDistServiceWorker() {
  if (!existsSync(distDir) || !statSync(distDir).isDirectory()) {
    throw new Error('dist/ does not exist. Run `vite build` before update-precache.');
  }

  syncStableRuntimeAssets();
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
