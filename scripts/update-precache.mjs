/**
 * Auto-generate the PRECACHE array and SW_VERSION in sw.js from actual files.
 *
 * Scans lib/, vendor/, and root static assets, then replaces the PRECACHE
 * constant and bumps SW_VERSION so the service worker invalidates stale caches.
 *
 * Usage: node scripts/update-precache.mjs        (runs as part of `npm run build`)
 */
import { readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs';
import { join, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');
const swPath = join(root, 'sw.js');

// ── Collect files ────────────────────────────────────────────────────
/** Recursively collect file paths under `dir` relative to project root. */
function collectFiles(dir) {
  const results = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...collectFiles(full));
    } else {
      results.push('./' + relative(root, full));
    }
  }
  return results;
}

// Static root assets (always precached)
const rootAssets = ['./', './index.html', './style.css', './app.js', './manifest.json'];

// Scan lib/ and vendor/ for all files
const libFiles = collectFiles(join(root, 'lib')).sort();
const vendorFiles = collectFiles(join(root, 'vendor')).sort();

const precacheEntries = [...rootAssets, ...vendorFiles, ...libFiles];

// ── Generate SW_VERSION ──────────────────────────────────────────────
const now = new Date();
const pad = (n) => String(n).padStart(2, '0');
const version = `${now.getUTCFullYear()}.${pad(now.getUTCMonth() + 1)}.${pad(now.getUTCDate())}.${pad(now.getUTCHours())}`;

// ── Update sw.js ─────────────────────────────────────────────────────
const original = readFileSync(swPath, 'utf8');
let sw = original;

// Replace SW_VERSION
const versionRe = /^const SW_VERSION = '[^']*';/m;
if (!versionRe.test(sw)) throw new Error('SW_VERSION pattern not found in sw.js');
sw = sw.replace(versionRe, `const SW_VERSION = '${version}';`);

// Replace PRECACHE array (match from `const PRECACHE = [` to `];`)
const precacheRe = /const PRECACHE = \[[\s\S]*?\];/;
if (!precacheRe.test(sw)) throw new Error('PRECACHE pattern not found in sw.js');
const escape = (s) => s.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
const precacheStr = 'const PRECACHE = [\n'
  + precacheEntries.map((e) => `  '${escape(e)}',`).join('\n')
  + '\n];';
sw = sw.replace(precacheRe, precacheStr);

writeFileSync(swPath, sw);

console.log(`sw.js updated: SW_VERSION=${version}, ${precacheEntries.length} precache entries`);
