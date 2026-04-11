// @vitest-environment node

import { describe, expect, it } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { collectDistFiles, renderServiceWorker } from './update-precache.mjs';

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

      expect(rendered).toContain("'./',");
      expect(rendered).toContain("'./assets/main.js',");
      expect(rendered).toContain("'./assets/main.css',");
      expect(rendered).not.toContain("./old.js");
    } finally {
      rmSync(tempRoot, { recursive: true, force: true });
    }
  });
});
