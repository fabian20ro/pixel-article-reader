# Lessons Learned

> This file is maintained by AI agents working on this project.
> It captures validated, reusable insights discovered during development.
> **Read this file at the start of every task. Update it at the end of every iteration.**

## How to Use This File

### Reading (Start of Every Task)
Before starting any work, read this file to avoid repeating known mistakes and to leverage proven approaches.

### Writing (End of Every Iteration)
After completing a task or iteration, evaluate whether any new insight was gained that would be valuable for future sessions. If yes, add it to the appropriate category below.

### Promotion from Iteration Log
Patterns that appear 2+ times in `ITERATION_LOG.md` should be promoted here as a validated lesson.

### Pruning
If a lesson becomes obsolete (e.g., a dependency was removed, an API changed), move it to the Archive section at the bottom with a date and reason.

---

## Architecture & Design Decisions

**[2026-02-22]** TypeScript outDir overlaps with source root — `tsconfig.json` uses `outDir: "."` and `rootDir: "src"`, so compiled JS lands at the project root (e.g. `src/app.ts` → `./app.js`). This means the root-level `.js` files are generated artifacts. Never edit them directly — always edit the TypeScript source in `src/` and run `npm run build`.

**[2026-02-22]** Exclude test files from tsc build — Tests in `src/__tests__/` must be listed in `tsconfig.json`'s `exclude` array, otherwise `tsc` compiles them into a `__tests__/` directory at the project root, polluting the deployable output. Vitest has its own TypeScript handling and doesn't need `tsc` to compile tests.

**[2026-02-22]** Service Worker must stay plain JS — `sw.js` runs in a ServiceWorker scope (no DOM, different globals). Keeping it as plain JS avoids needing a separate `tsconfig` for the SW context and keeps the file directly deployable without compilation.

## Code Patterns & Pitfalls

**[2026-02-22]** Import paths must end in `.js` even in TypeScript source — Since the browser loads ES modules directly (no bundler), TypeScript `import` statements must use `.js` extensions (e.g. `import { foo } from './lib/bar.js'`). The `tsc` compiler preserves these extensions as-is in the output. Forgetting `.js` will cause runtime `ERR_MODULE_NOT_FOUND` in the browser.

**[2026-02-22]** Readability.js is a global, not an ES module — The vendored `Readability.js` declares a global `function Readability(...)` and uses `module.exports` behind a `typeof module` guard. It's loaded via a plain `<script>` tag. In TypeScript, access it with `declare const Readability` (ambient declaration in `extractor.ts`). Don't try to `import` it — it won't work as an ES module.

**[2026-02-22]** Guard TTS skip operations with a generation counter — `speechSynthesis.cancel()` fires `onend` on the current utterance (sync in some browsers, async in others). Any skip that calls `cancel()` and advances position must prevent the old `onend` from also advancing. Add a `_speakGen` counter: increment before `cancel()`, capture in each utterance's `onend` closure, bail if stale.

**[2026-02-22]** `extractUrl()` should only extract URLs at/near the end of text — Pasted article content often contains embedded URLs. Extracting the first URL from any position causes false matches. Only extract when the URL is at the end and the prefix is short (≤ 150 chars, typical of share text like "Article Title\nhttps://...").

## Testing & Quality

**[2026-02-22]** Test data must match actual code behavior, not assumed behavior — When writing the extractor test for "single-newline fallback", the test assumed the fallback path would be triggered, but the code's double-newline split actually succeeds with a single large paragraph. Always trace through the actual splitting logic before asserting paragraph counts.

**[2026-02-22]** Mock SpeechSynthesis carefully — The TTS engine tests require mocking both `speechSynthesis` (the global singleton) and `SpeechSynthesisUtterance` (the constructor). Set them on `globalThis` in `beforeEach` and restore in `afterEach`. The mock `speak()` should call `onend` via `setTimeout` to simulate the async callback chain. Use `vi.useFakeTimers()` for tests that involve the resume watchdog timer.

## Performance & Infrastructure

**[2026-02-22]** Manifest and SW paths must be relative for subdirectory deployment — GitHub Pages serves at `/<repo>/`, not `/`. Using absolute paths like `"start_url": "/"` or `'/index.html'` in the SW precache list will break. Use `"."` for manifest `start_url`/`scope`/`share_target.action` and `'./'`-prefixed paths in the SW precache list.

**[2026-02-22]** GitHub Pages deploy via Actions needs a clean artifact — The `deploy-pages.yml` workflow builds a `_site/` directory containing only deployable files (no `src/`, `node_modules/`, etc.) and uses `actions/upload-pages-artifact`. Pages source must be set to "GitHub Actions" in repo settings.

**[2026-02-22]** Cloudflare Worker uses env bindings, not hardcoded constants — `ALLOWED_ORIGIN` is a `[vars]` entry in `wrangler.toml`, `PROXY_SECRET` is a secret set via `wrangler secret put` or injected by GitHub Actions. The worker reads them from the `env` parameter in `fetch(request, env)`. This avoids committing secrets and allows per-environment configuration.

## Dependencies & External Services

**[2026-02-22]** Vendored Readability.js comes from `mozilla/readability` main branch — Downloaded from `https://raw.githubusercontent.com/mozilla/readability/main/Readability.js`. It's ~2800 lines. When updating, verify the export format hasn't changed (must still declare global `function Readability` and use `module.exports` guard).

**[2026-02-22]** Google Translate's `translate.goog` proxy requires client-side JavaScript — The `translate.goog` domain serves the original page HTML plus JavaScript that translates text in the DOM. Server-side fetching (CORS proxy, headless fetch without JS execution) returns untranslated content. To translate in a proxy-based app, use the `translate.googleapis.com` API to translate already-extracted text instead of re-fetching a translated page.

## Process & Workflow

**[2026-02-22]** Build before shipping — Compiled JS files are generated outputs (gitignored) and must be produced by `npm run build` before local manual verification; CI also builds before deploy. Never edit generated root `.js` files directly.

**[2026-02-22]** Three GitHub secrets are required for CI/CD — `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`, and `PROXY_SECRET`. These must be set in the repo's Settings > Secrets > Actions before the deploy-worker workflow will succeed.

**[2026-02-22]** Do not add the npm package `tsc` — The package named `tsc` is not TypeScript and will shadow the real compiler binary in `node_modules/.bin/tsc`. Keep only `typescript` in `devDependencies` and use `npm run build`.

**[2026-02-22]** Markdown-first rendering needs explicit TTS alignment — Rendering markdown blocks directly to DOM is great for readability, but TTS highlighting only works if each clickable rendered block is mapped to a normalized paragraph index used by `TTSEngine`. Keep this mapping in one place (article controller) and reuse it for click-to-seek + progress highlighting.

---

## Archive

<!-- Lessons that are no longer applicable. Keep for historical context. -->
<!-- Format: **[YYYY-MM-DD] Archived [YYYY-MM-DD]** Title — Reason for archival -->
