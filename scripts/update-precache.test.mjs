// @vitest-environment node

import { describe, expect, it } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  collectDistFiles,
  renderServiceWorker,
  renderStableManifest,
  rewriteIndexHtmlForStableAssets,
} from './update-precache.mjs';

describe('update-precache', () => {
  it('collects emitted dist assets and renders them into PRECACHE', () => {
    const tempRoot = mkdtempSync(join(tmpdir(), 'pixel-article-reader-precache-'));

    try {
      mkdirSync(join(tempRoot, 'assets'), { recursive: true });
      writeFileSync(join(tempRoot, 'index.html'), '<!doctype html>');
      writeFileSync(join(tempRoot, 'assets', 'main.js'), 'console.log("ok")');
      writeFileSync(join(tempRoot, 'assets', 'main.css'), 'body{}');
      writeFileSync(join(tempRoot, 'sw.js'), '// old');

      const entries = collectDistFiles(tempRoot).sort();
      expect(entries).toEqual([
        './assets/main.css',
        './assets/main.js',
        './index.html',
      ]);

      const rendered = renderServiceWorker(
        "const SW_VERSION = '2026.04.11.01';\nconst PRECACHE = [\n  './old.js',\n];\n",
        ['./', ...entries],
      );

      expect(rendered).toContain("'.',");
      expect(rendered).toContain("'./assets/main.js',");
      expect(rendered).toContain("'./assets/main.css',");
      expect(rendered).not.toContain("./old.js");
    } finally {
      rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  it('rewrites the built index and manifest to stable app-root asset paths', () => {
    const html = `
      <link rel="manifest" href="./assets/manifest-abc123.json">
      <link rel="icon" type="image/png" sizes="192x192" href="./assets/icon-192-def456.png">
      <link rel="apple-touch-icon" href="./assets/icon-192-def456.png">
    `;
    const manifest = renderStableManifest(JSON.stringify({
      name: 'App',
      icons: [{ src: './icons/icon-192.png' }],
    }));

    expect(rewriteIndexHtmlForStableAssets(html)).toContain('href="./manifest.webmanifest"');
    expect(rewriteIndexHtmlForStableAssets(html)).not.toContain('./assets/manifest-abc123.json');
    expect(manifest).toContain('"src": "./icons/icon-192.png"');
    expect(manifest).toContain('"src": "./icons/icon-512.png"');
    expect(manifest).not.toContain('"src": "icons/icon-192.png"');
  });

  it('renders entries with backslashes and single quotes without escaping leaks', () => {
    const template = `const PRECACHE = [\n];\n`;
    const entries = [
      './assets/ok.js',
      "./assets/bad\\back\\path.js",
      "./assets/skip'quote.js",
    ];

    const rendered = renderServiceWorker(template, entries);

    // Backslashes doubled so JS parses them as literal '\' chars.
    expect(rendered).toContain("./assets/bad\\\\back\\\\path.js',");
    // Single quotes escaped so they don't break out of the string literal.
    expect(rendered).toContain('./assets/skip\\'quote.js\',');
    expect(rendered).not.toMatch(/bad\back/);
  });
});
