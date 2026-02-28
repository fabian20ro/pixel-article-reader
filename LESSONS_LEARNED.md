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

**[2026-02-22, updated 2026-02-28]** Guard TTS skip operations with a generation counter — `speechSynthesis.cancel()` fires `onend` on the current utterance (sync in some browsers, async in others). Any skip that calls `cancel()` and advances position must prevent the old `onend` from also advancing. Add a `_speakGen` counter: increment before `cancel()`, capture in each utterance's `onend` closure, bail if stale. **CRITICAL: ALL paths that call `cancel()`+`speakCurrent()` must increment `_speakGen` first**, including the resume watchdog's fallback timer — a stale `onend` from the cancelled utterance can double-advance position even after the new utterance starts speaking. **ALSO CRITICAL: The gen counter only protects callbacks (`onEnd`/`onError`), NOT the async `.then()` inside audio fetch pipelines.** When `AudioTTSBackend.speak()` fetches audio asynchronously, if pause/cancel happens during the fetch, the `.then()` still fires and calls `playAudio()`. Use an `isValid` callback to abort stale fetches before they start audio. Additionally, `speakCurrent()` and `onEnd` must check `_isPaused` — without this, a phantom chain can continue advancing while the engine thinks it's paused.

**[2026-02-22]** `extractUrl()` should only extract URLs at/near the end of text — Pasted article content often contains embedded URLs. Extracting the first URL from any position causes false matches. Only extract when the URL is at the end and the prefix is short (≤ 150 chars, typical of share text like "Article Title\nhttps://...").

## Testing & Quality

**[2026-02-22]** Test data must match actual code behavior, not assumed behavior — When writing the extractor test for "single-newline fallback", the test assumed the fallback path would be triggered, but the code's double-newline split actually succeeds with a single large paragraph. Always trace through the actual splitting logic before asserting paragraph counts.

**[2026-02-22, updated 2026-02-28]** Mock SpeechSynthesis carefully — The TTS engine tests require mocking both `speechSynthesis` (the global singleton) and `SpeechSynthesisUtterance` (the constructor). Set them on `globalThis` in `beforeEach` and restore in `afterEach`. The mock `speak()` should call `onend` via `setTimeout` to simulate the async callback chain. Use `vi.useFakeTimers()` for tests that involve the resume watchdog timer. **The mock must track `speaking`/`paused` state** — `pause()` should set `paused=true, speaking=false`, `resume()` should set `paused=false, speaking=true`, `cancel()` should set both to false. Without state tracking, `resume()` can't distinguish "properly paused" from "nothing to resume" — breaking tests for the pause/resume edge cases.

**[2026-02-23, updated 2026-02-24]** Background audio requires a real media session on Android — `speechSynthesis` is not treated as media playback by Chrome on Android. When the PWA goes to background, Chrome suspends the page and kills TTS. The fix is to play a silent `<audio>` track (generate a 10-second WAV programmatically, loop it) and register `navigator.mediaSession` action handlers. **Critical: the `<audio>` element MUST be appended to `document.body`** — `createElement` + `.play()` alone is not enough; Android Chrome ignores detached audio elements when deciding whether to suspend a page. Additionally, add a periodic keep-alive (5s interval) and a `visibilitychange` handler to restart the silent audio if the browser pauses it while backgrounded. Activate the silent audio from a user-gesture call stack (play button click) and deactivate on stop/end.

**[2026-02-23, updated 2026-02-25]** Screen Wake Lock must be re-acquired on visibility change — The W3C Screen Wake Lock API automatically releases the lock when the page becomes hidden (backgrounded). The `visibilitychange` handler must call `acquireWakeLock()` when returning to `visible` state while playback is active. **Additionally, `resume()` must also re-acquire the lock**, since background→foreground transitions auto-release the lock without a `visibilitychange` event firing. Guard against race conditions where the async lock request is still pending when the user pauses — release immediately if `_isPaused` is true in the `acquireWakeLock()` method.

**[2026-02-24] SUPERSEDED** ~~TTS needs its own background watchdog~~ — Watchdog retrying `speechSynthesis.speak()` in background does NOT work. See next entry.

**[2026-02-24]** `speechSynthesis` CANNOT produce audio in background on Android Chrome — this is a platform limitation, not a bug. Chrome suspends the speech synthesis bridge when the renderer is hidden, even when the page stays alive via a silent `<audio>` track. No amount of watchdog retries, `cancel()`+`speak()` cycling, or `visibilitychange` handlers will fix this. The ONLY path to background TTS on Android Chrome is to play actual audio data through an `<audio>` element. Use a server-side TTS API (e.g., Google Translate TTS via `translate.googleapis.com/translate_tts?client=gtx`) through the Cloudflare Worker, fetch MP3 per sentence, and play through `<audio>`. Audio elements are proven to survive backgrounding (the silent audio trick demonstrates this). Keep `speechSynthesis` only as an offline/fallback for foreground use. (Promoted from iteration log: 3rd attempt at fixing background TTS — watchdog approach failed twice.)

**[2026-02-24]** `navigator.mediaSession.setPositionState()` unlocks the notification seekbar — Without calling `setPositionState({ duration, position, playbackRate })`, Android's media notification shows buttons only (no progress bar, no time display). For TTS apps with discrete paragraphs/sentences, a character-count-based estimation (~14 chars/sec at 1× rate) maps well to a continuous timeline. Call it on every sentence completion for smooth seekbar updates. The `seekto` action handler receives `seekTime` in seconds and needs reverse-mapping back to paragraph/sentence position using the same character-count model.

## Performance & Infrastructure

**[2026-02-22]** Manifest and SW paths must be relative for subdirectory deployment — GitHub Pages serves at `/<repo>/`, not `/`. Using absolute paths like `"start_url": "/"` or `'/index.html'` in the SW precache list will break. Use `"."` for manifest `start_url`/`scope`/`share_target.action` and `'./'`-prefixed paths in the SW precache list.

**[2026-02-22]** GitHub Pages deploy via Actions needs a clean artifact — The `deploy-pages.yml` workflow builds a `_site/` directory containing only deployable files (no `src/`, `node_modules/`, etc.) and uses `actions/upload-pages-artifact`. Pages source must be set to "GitHub Actions" in repo settings.

**[2026-02-22]** Cloudflare Worker uses env bindings, not hardcoded constants — `ALLOWED_ORIGIN` is a `[vars]` entry in `wrangler.toml`, while `PROXY_SECRET`/`JINA_KEY` are Worker secrets set in Cloudflare (dashboard or `wrangler secret put`). The worker reads them from the `env` parameter in `fetch(request, env)`. This avoids committing secrets and supports per-environment config.

**[2026-02-22]** Translation endpoint should tolerate POST-hostile paths — Some deployed/legacy proxy paths reject POST (`405 Only GET requests are allowed`). Keep `POST /?action=translate` as primary, but support `GET /?action=translate&text=...&from=...&to=...` and let the client retry with GET on 405.

**[2026-02-22]** Filter Web Speech API voices by language code, not name — `SpeechSynthesisVoice.name` varies across platforms (Android Chrome uses "Google US English", iOS Safari uses "Samantha", Samsung uses its own names). Filtering by `voice.lang.startsWith('en')` is standardized across all browsers and still acts as a whitelist. When preferring "enhanced" voices, use `/google|enhanced|premium/i` to match high-quality voices across Android (Google), iOS (Enhanced), and Samsung (Premium).

## Dependencies & External Services

**[2026-02-22]** Vendored Readability.js comes from `mozilla/readability` main branch — Downloaded from `https://raw.githubusercontent.com/mozilla/readability/main/Readability.js`. It's ~2800 lines. When updating, verify the export format hasn't changed (must still declare global `function Readability` and use `module.exports` guard).

**[2026-02-22]** Google Translate's `translate.goog` proxy requires client-side JavaScript — The `translate.goog` domain serves the original page HTML plus JavaScript that translates text in the DOM. Server-side fetching (CORS proxy, headless fetch without JS execution) returns untranslated content. To translate in a proxy-based app, use the `translate.googleapis.com` API to translate already-extracted text instead of re-fetching a translated page.

## Content Filtering

**[2026-02-23]** Apply content filtering at every layer of the rendering pipeline — Image and non-text content must be stripped at ALL layers independently: (1) the markdown source before `marked.parse()` (strip `![...](...)` and `[Image...](...)` syntax), (2) the HTML sanitizer (`sanitizeRenderedHtml`) as safety net (remove `<img>`, `<picture>`, `<svg>` elements and empty/image-text links), and (3) the TTS text extraction functions (`stripMarkdownSyntax`, `stripNonTextContent`, `isSpeakableText`). Fixing only one layer leaves the others exposed. (Promoted from iteration log: 3rd occurrence of image content leaking through — previous fixes at the TTS layer didn't address visual rendering.)

## TTS State Management & UI Sync

**[2026-02-25]** Reset `_stopped` flag after `loadArticle()` — When `stop()` is called, it sets `_stopped = true` to prevent `speakCurrent()` from executing. However, loading new content should put the engine in a "ready to play" state. Add `this._stopped = false` after the stop/load sequence in `loadArticle()`, otherwise the engine remains locked and `speakCurrent()` is blocked on the next play request. This was the root cause of resume failing after queue transitions.

**[2026-02-25]** Cancel auto-advance timer in all user-initiated seek/jump paths — The queue system uses a 2-second auto-advance timer to transition between articles. This timer must be explicitly cancelled in `QueueController.playItem()` to prevent stale timers from firing after the user seeks within an article. Similarly, progress bar seek (app.ts) must cancel auto-advance when the user drags the position. Otherwise, the auto-advance timer may fire during paragraph seek and cause an unintended queue transition.

**[2026-02-25]** Chapter click handlers must sync TTS position, not just scroll — When a user clicks a chapter in the chapter list, the handler previously only scrolled to the corresponding heading. However, the TTS engine position was not updated, causing a desync between visual position and audio playback. The click handler must walk the DOM from the heading to find the corresponding `.paragraph` element and call `tts.jumpToParagraph()` to sync the audio position. If the heading is at the end of the article, fall back to jumping to the last paragraph.

**[2026-02-25]** Visibility change handler must reset dead-man's switch timer — The TTS engine uses a 30-second dead-man's switch to auto-stop if no progress is detected (guard against stuck utterances). When the page goes to background (`hidden`), JavaScript is suspended — if the dead-man's switch timer fires while suspended, it won't be accurate when the page resumes. The `visibilitychange` handler should clear the resume watchdog timer on `hidden` to prevent false triggers after JS resumes from suspension. On `visible`, reset `_lastProgressTime` to the current time to avoid false triggers from the suspended duration.

## Process & Workflow

**[2026-02-22]** Build before shipping — Compiled JS files are generated outputs (gitignored) and must be produced by `npm run build` before local manual verification; CI also builds before deploy. Never edit generated root `.js` files directly.

**[2026-02-22]** Worker deploy ownership must be single-source — if Cloudflare Git integration deploys `worker/**`, remove overlapping GitHub deploy workflows. Cloudflare API credentials belong in Cloudflare (not GitHub), but `PROXY_SECRET` may still need to exist as a GitHub Pages build secret so the client can send `X-Proxy-Key`.

**[2026-02-22]** Do not add the npm package `tsc` — The package named `tsc` is not TypeScript and will shadow the real compiler binary in `node_modules/.bin/tsc`. Keep only `typescript` in `devDependencies` and use `npm run build`.

**[2026-02-22]** Markdown-first rendering needs explicit TTS alignment — Rendering markdown blocks directly to DOM is great for readability, but TTS highlighting only works if each clickable rendered block is mapped to a normalized paragraph index used by `TTSEngine`. Keep this mapping in one place (article controller) and reuse it for click-to-seek + progress highlighting. Always look up DOM elements by `data-index` attribute, never by ordinal position in `querySelectorAll` results — block merging and filtering mean ordinal ≠ TTS index.

**[2026-02-22]** Never use ordinal DOM position for TTS paragraph lookup — When short blocks are merged into one TTS paragraph, multiple DOM elements share the same `data-index`. Using `querySelectorAll('.paragraph')[i]` to find TTS paragraph `i` is wrong; always use `querySelector('.paragraph[data-index="N"]')` or compare `element.dataset.index`. This applies to highlighting, scrolling, and any future feature that maps between TTS position and DOM. (Promoted from iteration log: 2nd occurrence of TTS-DOM index mismatch.)

---

## Archive

<!-- Lessons that are no longer applicable. Keep for historical context. -->
<!-- Format: **[YYYY-MM-DD] Archived [YYYY-MM-DD]** Title — Reason for archival -->
