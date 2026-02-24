# Iteration Log

> Append-only journal of AI agent work sessions on this project.
> **Add an entry at the end of every iteration.**
> When patterns emerge (same issue 2+ times), promote to `LESSONS_LEARNED.md`.

## Format

Each entry should follow this structure:

---

### [YYYY-MM-DD] Brief Description of Work Done

**Context:** What was the goal / what triggered this work
**What happened:** Key actions taken, decisions made
**Outcome:** Result — success, partial, or failure
**Insight:** (optional) What would you tell the next agent about this?
**Promoted to Lessons Learned:** Yes/No

---

### [2026-02-22] Initial PWA implementation — full ArticleVoice app

**Context:** Greenfield implementation of ArticleVoice PWA from a detailed architecture plan. The project was an empty repo with just a LICENSE file.

**What happened:**
- Set up TypeScript project with `tsc` as sole build tool. Used `outDir: "."` with `rootDir: "src"` so compiled JS lands at the project root for direct GitHub Pages deployment.
- Created all core modules: `url-utils.ts` (URL validation + Share Target param parsing), `lang-detect.ts` (EN/RO heuristic detection), `extractor.ts` (CORS proxy fetch + Readability.js parsing), `tts-engine.ts` (Web Speech API wrapper with sentence-level chunking to avoid Android's 15-second cutoff bug).
- Built `app.ts` orchestrator wiring URL handling, extraction, TTS, install prompts, settings persistence, and all UI interactions.
- Created `index.html` with full player UI, `style.css` with dark theme, `manifest.json` with Share Target, `sw.js` for offline caching.
- Created `worker/cors-proxy.js` Cloudflare Worker with SSRF prevention.
- Vendored Mozilla Readability.js from GitHub.
- Generated placeholder PWA icons via Python script.

**Outcome:** Success. All files created, TypeScript compiles cleanly, app structure matches the plan.

**Insight:** The `outDir: "."` approach is clean for GitHub Pages but means root-level `.js` files are build artifacts — easy to accidentally edit the wrong file. Always edit `src/`, never the root `.js`.

**Promoted to Lessons Learned:** Yes — architecture decision about outDir overlap and import `.js` extension requirement.

---

### [2026-02-22] Add documentation (README, AGENTS.md, CLAUDE.md) and Vitest test suite

**Context:** Needed README for users, AGENTS.md for AI agents, CLAUDE.md as entry point, and tests for all implemented modules.

**What happened:**
- Created README.md with full usage guide (quick start, share target flow, player controls, development setup).
- Created AGENTS.md with codebase reference (layout, commands, 5 architecture rules, critical implementation details, testing notes).
- Created CLAUDE.md pointing to AGENTS.md.
- Chose Vitest over Jest — it handles TypeScript natively, supports ES modules, and needs minimal config. Added `jsdom` environment for DOM API testing.
- Wrote 75 tests across 4 files covering all library modules.
- Hit one test failure: the extractor test for "single-newline fallback" assumed the fallback path would trigger, but the double-newline split actually succeeds with one large paragraph. Fixed by correcting the assertion to match actual behavior.
- Had to exclude `src/__tests__/` from `tsconfig.json` to prevent `tsc` from compiling test files into the root output directory.

**Outcome:** Success. 75/75 tests passing. All documentation complete.

**Insight:** When testing text-splitting logic, trace through the actual regex behavior with your test data before writing assertions. The "obvious" split behavior is often wrong. Also, always add `src/__tests__` to tsconfig `exclude` when test files live inside the source tree.

**Promoted to Lessons Learned:** Yes — test data accuracy lesson, tsconfig exclude for tests, and mock SpeechSynthesis guidance.

---

### [2026-02-22] CI/CD, Cloudflare Worker automation, subdirectory path fixes

**Context:** Needed automated deployment via GitHub Actions for both GitHub Pages and the Cloudflare Worker. The worker needed to use secrets (not hardcoded config). Manifest and SW had absolute paths that would break on GitHub Pages subdirectory deployment.

**What happened:**
- Fixed `manifest.json`: changed `start_url`, `scope`, and `share_target.action` from `"/"` to `"."` (relative) so the PWA works when served from `/<repo>/`.
- Fixed `sw.js`: changed precache paths from `'/index.html'` to `'./index.html'` etc. Same subdirectory issue.
- Refactored `worker/cors-proxy.js` to read `ALLOWED_ORIGIN` and `PROXY_SECRET` from Cloudflare env bindings (`env` parameter) instead of hardcoded constants. Added `X-Proxy-Key` header validation when a secret is configured.
- Created `worker/wrangler.toml` with worker name `article-voice-proxy` and `ALLOWED_ORIGIN` var set to the GH Pages origin.
- Created `.github/workflows/deploy-pages.yml`: builds TS, runs tests, deploys a clean `_site/` artifact to Pages.
- Created `.github/workflows/deploy-worker.yml`: triggers on `worker/**` changes, uses `cloudflare/wrangler-action@v3` with `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`, and `PROXY_SECRET` secrets.
- Updated `src/app.ts` and `src/lib/extractor.ts` to support optional `PROXY_SECRET` config — sent as `X-Proxy-Key` header on proxy requests.
- Updated README with live app link, detailed step-by-step Cloudflare setup, and CI/CD documentation.
- Updated AGENTS.md with new repo layout, CI/CD section, and updated architecture rules.

**Outcome:** Success. Build and tests pass (75/75). All workflows, configs, and path fixes in place.

**Insight:** When deploying a PWA to a subdirectory (GitHub Pages), every absolute path is a bug. Check manifest.json `start_url`/`scope`/`share_target.action`, SW precache paths, and any hardcoded `/` references. Use relative paths (`"."`, `"./"`) everywhere. Also, Cloudflare Worker env bindings are the right way to handle config/secrets — never hardcode origins or secrets in the worker source.

**Promoted to Lessons Learned:** Yes — subdirectory path gotcha, GH Actions artifact pattern, CF Worker env bindings pattern, required secrets documentation.

---

### [2026-02-22] Fix PWA share target and proxy error handling

**Context:** User reported two issues: (1) the PWA doesn't appear as a share target when sharing from articles, (2) entering a URL gives "Failed to fetch. Try pasting the article text directly."

**What happened:**
- Investigated the CORS proxy — confirmed it IS deployed but returns 403 because `PROXY_SECRET` is configured on the worker while the client has `CONFIG.PROXY_SECRET = ''`. The client sends no `X-Proxy-Key` header, worker rejects with 403. If the user isn't on the exact `ALLOWED_ORIGIN`, CORS blocks the 403 response, causing a raw "Failed to fetch" TypeError.
- Fixed `sw.js`: added `ignoreSearch: true` for navigation requests so share target URLs (`?url=...`) match the cached app shell instead of missing the cache and falling through to network. Bumped cache version to v2 to force SW update.
- Fixed `extractor.ts`: added specific error handling for `TypeError` (network unreachable → "Could not reach the article proxy"), for 403 responses (parses JSON error body from proxy, hints about PROXY_SECRET), and removed misleading "Try pasting the article text directly" from all error paths.
- Fixed `app.ts`: removed duplicate "Try pasting the article text directly" suffix appended to all errors in the `loadArticle` catch block.
- All 75 tests pass.

**Outcome:** Partial success. Error messages are now accurate and actionable. Share target caching is fixed. However, the root cause of "Failed to fetch" — the missing `PROXY_SECRET` in the client config — requires the user to set the secret value in `CONFIG.PROXY_SECRET` in `src/app.ts` and rebuild.

**Insight:** The "Failed to fetch" TypeError in browsers means the network request never completed — usually CORS blocking or DNS failure, NOT an HTTP error. When a CORS proxy returns an error (like 403) and the `Access-Control-Allow-Origin` doesn't match the caller's origin, the browser hides the HTTP status entirely and throws a generic TypeError. Always add specific TypeError handling for cross-origin fetch calls.

**Promoted to Lessons Learned:** No — first occurrence.

---

### [2026-02-22] Fix share URL handling for text with title + URL

**Context:** User reported that sharing from Google News produces text like "Article Title https://share.google/xyz" and the app can't open it because "it's more than the url."

**What happened:**
- Investigated the full share flow. The `extractUrl()` function already handled extracting URLs from mixed text via regex, so the core logic was correct.
- Identified two UX/coverage issues: (1) the input field used `type="url"` which shows URL-only validation on mobile and makes pasting shared text harder, (2) `getUrlFromParams()` only checked `url` and `text` query params, missing the `title` param.
- Changed `<input type="url">` to `<input type="text">` with updated placeholder text.
- Added `title` to the candidate query params in `getUrlFromParams()`.
- Added 4 new test cases covering the exact Google News sharing format and the `title` param fallback.
- All 79 tests pass.

**Outcome:** Success. The app now properly handles shared text containing a title prefix before the URL, both via manual paste and Share Target API.

**Insight:** `type="url"` on input fields causes mobile browsers to show URL-specific keyboards (no space bar) and validation errors for non-URL text. Use `type="text"` when the input accepts more than bare URLs.

**Promoted to Lessons Learned:** No — first occurrence.

---

### [2026-02-22] Add sentence-level skip buttons to player controls

**Context:** User requested buttons to skip forward/backward one sentence, not just one paragraph.

**What happened:**
- Added `skipSentenceForward()` and `skipSentenceBackward()` methods to `TTSEngine` in `tts-engine.ts`. Forward advances one sentence within the current paragraph, or crosses to the first sentence of the next paragraph. Backward goes back one sentence, or to the last sentence of the previous paragraph.
- Added two new buttons to `index.html` player controls, positioned between the paragraph skip buttons and the play/pause button, using smaller double-chevron SVG icons.
- Wired buttons in `app.ts` to call the new TTS engine methods.
- Added `.sentence-btn` CSS class for slightly smaller sizing and reduced opacity to visually differentiate from paragraph buttons.
- Added 6 new tests covering: sentence advance within paragraph, cross-paragraph forward, boundary at last sentence, sentence backward within paragraph, cross-paragraph backward, and boundary at first sentence.
- All 91 tests pass.

**Outcome:** Success. Sentence skip buttons work alongside existing paragraph skip buttons.

**Insight:** The TTS engine already tracked sentence position (`sentIdx`) internally for the chunking logic, so adding sentence-level navigation was straightforward — just needed public methods that manipulate the same indices.

**Promoted to Lessons Learned:** No — first occurrence.

---

### [2026-02-22] Fix translate button for shortened/redirect URLs

**Context:** User reported that the translate button doesn't work with shortened URLs like `https://share.google/RNxfVVbNyIhn3lvPa`. The `toTranslateUrl()` function was converting `share.google` → `share-google.translate.goog`, which is not a valid Google Translate proxy host.

**What happened:**
- Diagnosed the issue: the CORS proxy follows redirects (`redirect: 'follow'`) but the resolved URL was discarded. The app stored the original shortened URL as `currentArticleUrl`, which produced invalid translate URLs.
- Added `X-Final-URL` response header to the CORS proxy worker (`worker/cors-proxy.js`) that returns `response.url` (the final URL after all redirects). Added `Access-Control-Expose-Headers: X-Final-URL` to CORS headers so the browser can read it.
- Updated `fetchViaProxy()` in `extractor.ts` to return `{ html, finalUrl }` where `finalUrl` comes from the `X-Final-URL` header (with fallback to the original URL).
- Added `resolvedUrl: string` field to the `Article` interface.
- Updated `app.ts` to use `article.resolvedUrl` for `currentArticleUrl`, so the translate button uses the actual article domain.
- Added 2 new tests: one verifying `X-Final-URL` header is used, one verifying fallback to the original URL.
- All 90 tests pass (2 new + 88 existing after the test count shift from previous sessions).

**Outcome:** Success. Shortened URLs now resolve to their final destination before being used for translation.

**Insight:** When a CORS proxy follows redirects, the final URL information is lost unless explicitly forwarded back to the client. This affects any feature that operates on the domain/path of the URL (like Google Translate proxy URL construction). Always expose the resolved URL as a response header.

**Promoted to Lessons Learned:** No — first occurrence.

---

### [2026-02-22] Add rate limiting, codemaps, and documentation

**Context:** User requested: (1) create doc/codemaps files and link from AGENTS.md, (2) implement rate limiting at 20 req/min in the Cloudflare Worker, (3) make the UI show relevant errors when rate limits are hit, (4) document the limits.

**What happened:**
- Created `doc/codemaps/architecture.md` (data flow diagram, dependency graph, deployment targets) and `doc/codemaps/modules.md` (detailed API reference for every module).
- Added codemaps section with links to AGENTS.md.
- Implemented in-memory sliding window rate limiter in `worker/cors-proxy.js`: 20 requests per 60-second window per client IP (via `CF-Connecting-IP`). Returns 429 with `Retry-After` header. Includes periodic cleanup to prevent memory growth. All responses include `X-RateLimit-Limit` and `X-RateLimit-Remaining` headers. Exposed new rate limit headers via CORS `Access-Control-Expose-Headers`.
- Updated `src/lib/extractor.ts` to handle HTTP 429 specifically: shows "Rate limit exceeded" with retry-after countdown from the response header.
- Added 2 new tests: one for 429 with error body, one for 429 with fallback message using `Retry-After` header.
- Documented rate limiting in AGENTS.md (new "CORS Proxy Rate Limiting" section).
- All 92 tests pass.

**Outcome:** Success. Rate limiting is enforced at the worker level, errors surface clearly in the UI, and all documentation is updated.

**Insight:** Cloudflare Workers' in-memory state (global `Map`) persists across requests within the same isolate but not across PoPs or cold starts. For a personal project this provides sufficient rate limiting; for production-grade global rate limiting, Durable Objects or KV would be needed.

**Promoted to Lessons Learned:** No — first occurrence.

---

### [2026-02-22] Add PWA force-update mechanism

**Context:** User installed a previous version of the PWA and the UI buttons weren't updating. Requested a way to force the app to update — either a button in settings or automatic update on load.

**What happened:**
- Added auto-reload on service worker update: listens for `controllerchange` on `navigator.serviceWorker` and reloads the page when a new SW takes control. Since the SW already calls `skipWaiting()` + `clients.claim()`, this ensures new versions activate and reload automatically.
- Added a "Check for Updates" button in the settings panel that: calls `registration.update()` to force the browser to check for a new SW, then clears all caches and reloads the page. This handles cases where the auto-update didn't trigger (e.g., the SW file didn't change but app assets did).
- Added status feedback text under the button.
- Styled the button to match the existing settings panel design.

**Outcome:** Success. Both auto-update on load and manual force-update from settings are implemented. All 92 tests pass.

**Insight:** PWAs installed on Android can get stuck on stale caches even when the SW uses `skipWaiting()` + `clients.claim()` because the page doesn't reload after the new SW activates. Listening for `controllerchange` and auto-reloading solves the most common case. For manual recovery, clearing all caches via `caches.keys()` + `caches.delete()` and reloading is the nuclear option that always works.

**Promoted to Lessons Learned:** No — first occurrence.

---

### [2026-02-22] Fix URL detection, translate button, sentence skip, and docs

**Context:** User reported multiple issues: (1) pasting a full article that contains embedded URLs incorrectly extracts a URL and tries to fetch it, (2) translate button is invisible/hard to find, (3) sentence skip buttons don't work reliably, (4) console warnings about deprecated meta tags and manifest. Also requested AGENTS.md simplification and library updates.

**What happened:**
- Changed `extractUrl()` to only extract URLs at/near the end of text (share-text format). Previously it grabbed the first URL anywhere. Now if a URL is embedded mid-text, it returns null, allowing the app to treat the input as pasted article content.
- Added `createArticleFromText()` to `extractor.ts` — creates an Article directly from pasted plain text without fetching. Extracts title from first line, splits paragraphs, detects language, counts words.
- Updated `handleUrlSubmit()` in `app.ts` to handle pasted text when `extractUrl` returns null.
- Added `originalArticleUrl` variable to prevent double-wrapping translate.goog URLs. The translate button now always uses the original URL, and is hidden for pasted text articles.
- Made translate button visually prominent with a bordered style (was previously unstyled text, easily missed).
- Fixed sentence skip race condition in `tts-engine.ts`: `speechSynthesis.cancel()` fires `onend` on the old utterance, which was double-advancing the position. Added `_speakGen` generation counter — each utterance captures the generation at creation and bails out if stale.
- Fixed console warnings: replaced deprecated `apple-mobile-web-app-capable` with `mobile-web-app-capable`, added `enctype` to manifest share_target.
- Simplified AGENTS.md by replacing duplicated sections (Repository Layout, Build Commands, CI/CD) with links to README.md.
- Updated codemaps, README, and all documentation.
- All dependencies already at latest versions. 102 tests pass.

**Outcome:** Success. All issues fixed, tests pass, documentation updated.

**Insight:** `speechSynthesis.cancel()` fires `onend` on the current utterance (sometimes synchronously, sometimes async depending on browser). Any skip operation that calls cancel() and then advances the position must guard against the old `onend` handler also advancing. A generation counter is the cleanest fix — increment before cancel, capture in the onend closure, and bail if stale.

**Promoted to Lessons Learned:** Yes — TTS cancel() race condition pattern.

---

### [2026-02-22] Fix CodeQL security issues (#1, #2, #3)

**Goal:** Fix three CodeQL-detected security vulnerabilities — two in vendored Readability.js (High severity) and one in the deploy-worker workflow (Medium severity).

**What happened:**
- **Issue #1 — Incomplete hostname regex** (`vendor/Readability.js:155`): Video allowlist regex lacked a boundary after TLD, so `youtube.com.evil.com` could match. Added lookahead `(?=[/\?#:]|$)` and escaped unescaped dot in `live.bilibili`.
- **Issue #2 — Incomplete URL scheme check** (`vendor/Readability.js:481`): Only checked lowercase `javascript:` scheme. Replaced `indexOf` with regex `/^\s*(javascript|data):/i` to also block `data:` URIs, case variations, and whitespace prefixes.
- **Issue #3 — Missing workflow permissions** (`.github/workflows/deploy-worker.yml`): Added `permissions: contents: read` to follow principle of least privilege, matching the pattern already used in `deploy-pages.yml`.

**Outcome:** Success. All 102 tests pass, build succeeds, three security fixes applied.

**Insight:** Vendored libraries accumulate CodeQL findings over time since they don't receive upstream updates automatically. Hostname regexes in URL allowlists need boundary anchoring (lookahead for `/`, `?`, `#`, `:`, or end-of-string) to prevent subdomain spoofing.

---

### [2026-02-22] Fix translate button — replace broken Google Translate proxy with API-based translation

**Context:** User reported that clicking the translate button on a German article (web.de) left the text in German. The root cause: the translate button was constructing a `translate.goog` proxy URL and re-fetching through the CORS proxy, but `translate.goog` relies on client-side JavaScript to translate text. Since the proxy returns raw HTML and `DOMParser` doesn't execute JavaScript, the text stayed in the original language.

**What happened:**
- Replaced the broken `translate.goog` proxy approach entirely.
- Added a `POST /?action=translate` endpoint to the Cloudflare Worker that calls Google Translate's `translate.googleapis.com` API server-side and returns translated text as JSON.
- Created new `translator.ts` module that batches paragraphs into ~3000-char chunks, sends them to the worker in parallel (max 3 concurrent), and reassembles translated paragraphs.
- Improved `lang-detect.ts` with `detectLangFromHtml()` (normalizes `<html lang="de-DE">` to `"de"`), `detectLangFromUrl()` (maps TLDs like `.de` → German), `needsTranslation()` (decides if translation needed), and `getSourceLang()`.
- Added `htmlLang` field to the `Article` interface in `extractor.ts` — extracted from the parsed HTML's `<html lang="...">` attribute.
- Updated `app.ts`: removed `toTranslateUrl()` and `originalArticleUrl`, translate button now calls `translateParagraphs()` directly on the extracted text.
- The translate button now shows for both URL-based and pasted text articles when the detected language is not English or Romanian.
- Per user requirement: if language can't be determined from URL/metadata, assume it's NOT English → show translate button.
- Error handling propagates root cause at every level (worker → client → UI).
- Updated AGENTS.md, codemaps, iteration log.
- All 150 tests pass (48 new tests for lang-detect, translator, and extractor htmlLang).

**Outcome:** Success. Translate button now works via API-based translation instead of the broken proxy approach.

**Insight:** `translate.goog` URLs rely on client-side JavaScript to perform translation. Any server-side HTML fetching (CORS proxy, headless fetch) will return untranslated content. The correct approach for a proxy-based app is to translate the already-extracted text via a translation API, not to re-fetch a translated page.

**Promoted to Lessons Learned:** Yes — the translate.goog JS execution insight.

---

### [2026-02-22] Refactor to modular app architecture + markdown reading pipeline + Jina fallback

**Context:** Implemented the reliability-first refactor plan, then added markdown-rendered reading mode and Jina Reader retry flow on top of the refactored structure.

**What happened:**
- Introduced modular app architecture:
  - `src/lib/settings-store.ts` for settings persistence/validation
  - `src/lib/dom-refs.ts` for typed DOM references
  - `src/lib/pwa-update-manager.ts` for SW registration/update/reload policy
  - `src/lib/article-controller.ts` for extraction/rendering/translation UI flow
  - `src/lib/release.ts` for build metadata display
- Updated SW update behavior and release metadata wiring:
  - startup + visibility update checks
  - deferred reload when playback is active
  - manual force refresh kept as break-glass path
- Added markdown content pipeline:
  - `Article` now includes `markdown`
  - Readability output is converted to markdown (Turndown-compatible global)
  - markdown is rendered into formatted HTML (marked-compatible global) with sanitization
  - rendered top-level blocks are mapped to TTS paragraph indices for click/highlight parity
- Added user actions:
  - **Try with Jina Reader** (`extractArticleWithJina`) with fallback to default extraction
  - **Copy as Markdown** button (clipboard export)
- Extended Cloudflare Worker:
  - `GET /?url=...&mode=markdown` path that fetches `https://r.jina.ai/<url>`
  - optional server-side `JINA_KEY` authorization header
  - keeps existing SSRF/rate-limit/CORS constraints
- Added/updated tests:
  - new `settings-store` test suite
  - new `pwa-update-manager` test suite
  - expanded extractor tests for markdown + Jina + fallback behavior
- Fixed local toolchain blocker:
  - removed accidental npm dependency `tsc` (which shadowed TypeScript compiler binary)

**Outcome:** Success. Build passes and all tests pass (`7 files, 164 tests`).

**Insight:** A package named `tsc` can silently replace the expected compiler command in npm scripts. For TypeScript projects, keep only `typescript` and avoid adding `tsc` as a dependency.

**Promoted to Lessons Learned:** Yes — `tsc` package shadowing and markdown-to-TTS alignment guidance.

---

### [2026-02-22] Stop tracking generated JS outputs

**Context:** Repo policy changed: generated build outputs should not be committed. Only source files stay tracked; CI build produces runtime JS before deploy.

**What happened:**
- Updated `.gitignore` to ignore generated outputs:
  - `app.js`
  - `lib/*.js`
- Kept source/runtime JS files tracked:
  - `sw.js`
  - `worker/cors-proxy.js`
  - `vendor/*.js`
- Updated docs (`README.md`, `AGENTS.md`, codemaps, lessons) to reflect that root JS build outputs are generated and gitignored.
- Confirmed build and tests still pass with generated output policy.

**Outcome:** Success. Repo now tracks source, not generated app bundle outputs.

**Insight:** Ignoring only generated runtime outputs (`app.js`, `lib/*.js`) keeps commits cleaner while preserving tracked JS files that are true source (SW, worker, vendor).

**Promoted to Lessons Learned:** Yes — generated output tracking policy.

---

### [2026-02-22] Remove redundant GitHub Worker deploy workflow (Cloudflare Git is source of truth)

**Context:** Cloudflare already redeploys the Worker from Git commits on `main` for `worker/**`. The repo intentionally does not store Cloudflare credentials in GitHub secrets.

**What happened:**
- Deleted `.github/workflows/deploy-worker.yml` to stop guaranteed-failing duplicate deploy attempts.
- Updated docs to reflect the real deployment ownership:
  - `README.md` now documents Cloudflare Git integration + Worker bindings in Cloudflare.
  - `AGENTS.md` and `doc/codemaps/architecture.md` now describe Pages-via-GitHub-Actions and Worker-via-Cloudflare split.
  - `worker/cors-proxy.js` header comments now reference Cloudflare Git/Wrangler deploy paths.
- Kept `PROXY_SECRET` injection in `deploy-pages.yml` (conditional on secret presence) so authenticated Worker setups continue working.

**Outcome:** Success. CI scope is cleaner and aligned with operational reality without breaking authenticated proxy requests.

**Insight:** When deployment ownership is external (Cloudflare Git), redundant in-repo deploy workflows create noise and failures; remove them and document one deploy authority.

**Promoted to Lessons Learned:** Yes — single-source deployment ownership.

---

### [2026-02-22] Fix translation failures on GET-only proxy paths

**Context:** User reported translation failures with `405 Only GET requests are allowed` (`batch 1/2`). That indicates a deployed or routed proxy path rejecting POST requests.

**What happened:**
- Added client fallback in `src/lib/translator.ts`:
  - primary request stays `POST /?action=translate`
  - on HTTP 405, retry once via `GET /?action=translate&text=...&from=...&to=...`
- Extended Worker compatibility in `worker/cors-proxy.js`:
  - `?action=translate` now supports both POST and GET
  - kept existing validation, limits, and response shape
- Added coverage in `src/__tests__/translator.test.ts`:
  - new test verifies POST-405 then GET fallback succeeds
- Updated `AGENTS.md` and `LESSONS_LEARNED.md` to document POST/GET translation compatibility.

**Outcome:** Success. Local build and tests are green (`165 tests passed`), and the app now handles POST-hostile translation paths more robustly.

**Insight:** For public edge proxies, transport-method compatibility matters as much as endpoint semantics; a GET fallback on 405 can recover real user paths without changing UI behavior.

**Promoted to Lessons Learned:** Yes — translation GET fallback pattern.

---

### [2026-02-22] Add iOS & Samsung voice support — language-code-based voice filtering

**Context:** The voice dropdown only showed voices matching hardcoded names `['Ioana', 'Samantha']`, which may not exist on iOS Safari or Samsung Internet. User requested cross-platform support with only English and Romanian voices selectable.

**What happened:**
- Added 6 Claude agent definitions (architect, planner, refactor-cleaner, doc-updater, security-reviewer, code-reviewer) to `.claude/agents/` from `fabian20ro/everything-claude-code`.
- Replaced `ALLOWED_VOICES = ['Ioana', 'Samantha']` (name-based whitelist) with `ALLOWED_LANG_PREFIXES = ['en', 'ro']` (language-code-based whitelist) in `src/app.ts`.
- Updated `populateVoices()` to filter by `voice.lang.startsWith(prefix)` and sort voices by language group then name.
- Broadened `selectVoice()` in `src/lib/tts-engine.ts` to prefer enhanced/premium voices across platforms (regex `/google|enhanced|premium/i` instead of `/google/i`).
- Added 5 cross-platform voice selection tests: iOS Enhanced, Samsung Premium, iOS fallback, mixed platforms, multi-region lang variants.
- Ran security review (all clear) and code review via agent definitions.
- Build succeeds, all 170 tests pass.

**Outcome:** Success. Voice dropdown now shows all English and Romanian voices available on any platform (Pixel, iOS, Samsung).

**Insight:** Filtering Web Speech API voices by `voice.name` is inherently non-portable — voice names vary across platforms. Filtering by `voice.lang` prefix (BCP-47 language tag) is standardized and works everywhere. The language-code approach is still a whitelist (only allowed languages appear), maintaining the same security posture.

**Promoted to Lessons Learned:** Yes — cross-platform voice filtering pattern.

---

### 2026-02-22 — Add 3 themes + segment control UI for theme/language

**Task:** Add three selectable themes (Dark, Light, Khaki), replace radio buttons with horizontal segment controls for theme and language selection, use flag emojis for language options.

**Changes:**
- `settings-store.ts`: Added `Theme` type via `THEMES` const array for easy extensibility, added `theme` field to `AppSettings`
- `style.css`: Replaced `@media (prefers-color-scheme: light)` with `[data-theme]` attribute selectors for 3 themes (Dark=light blue accent, Light=dark green accent, Khaki=warm accent). Added `.segment-control` component. Added `--hover-overlay` variable for theme-aware hover states
- `index.html`: Added `data-theme="dark"` to `<html>`, added theme selector segment control in settings, replaced language radio groups with segment controls using flag emojis (🌐/🇬🇧/🇷🇴)
- `dom-refs.ts`: Replaced `settingsLangRadios`/`playerLangRadios` with `themeBtns`/`settingsLangBtns`/`playerLangBtns`
- `app.ts`: Added `applyTheme()` and `updateSegmentButtons()` helpers, wired up theme buttons and new language segment buttons
- `article-controller.ts`: Updated `syncLanguageControls()` to use segment buttons instead of radio inputs
- Updated test to include `theme` field in `AppSettings`

**Outcome:** Success. Build clean, all 170 tests pass.

**Insight:** Using a `THEMES` const array with `as const` and deriving the type via `typeof THEMES[number]` makes adding new themes a one-line change in the array + a CSS block. The `[data-theme]` attribute approach on `<html>` is cleaner than media queries for user-selectable themes.

**Promoted to Lessons Learned:** No

---

### [2026-02-22] Fix TTS pauses on names and abbreviations

**Context:** User reported that names like "Ilene S. Cohen, Ph.D." are read with unnatural pauses because the sentence splitter breaks on every period, producing tiny fragments like "Ilene S.", "Cohen, Ph.", "D." — each spoken as a separate `SpeechSynthesisUtterance`.

**What happened:**
- Added `mergeShortSentences()` post-processing step to `splitSentences()` in `tts-engine.ts`. After the regex splits text on punctuation, fragments shorter than 40 characters are merged with the next fragment, up to a 200-character cap (to stay safely under Android's ~15-second utterance cutoff).
- Exported `splitSentences()` for direct unit testing.
- Added 9 new `splitSentences` tests: normal splitting, name abbreviations, "Dr." prefix, multiple abbreviations in running text, long sentences staying separate, MAX_UTTERANCE_LENGTH cap, single sentence, no punctuation, empty string.
- Updated 4 existing TTSEngine tests that used short test strings (now merged by the new logic) to use sentences longer than 40 characters.
- All 179 tests pass, build clean.

**Outcome:** Success. Names and abbreviations are now spoken as part of a natural utterance instead of as isolated fragments with pauses.

**Insight:** Post-processing (merge short fragments) is more robust than trying to make the splitting regex abbreviation-aware. The 40-char minimum catches virtually all abbreviation fragments while still allowing real sentences to stand alone. The 200-char max cap preserves the Android chunking safety.

**Promoted to Lessons Learned:** No — first occurrence.

---

### [2026-02-22] Merge short TTS paragraphs to eliminate pauses on bylines

**Context:** The sentence-merging fix alone didn't resolve TTS pauses on names. The real issue: short blocks like author bylines ("Ilene S. Cohen, Ph.D.") became their own TTS paragraphs with pause boundaries before and after. The sentence fix only helped within a paragraph.

**What happened:**
- Added `MIN_TTS_PARAGRAPH = 80` constant in `article-controller.ts`.
- Rewrote `renderArticleBody()` markdown path to accumulate short blocks (< 80 chars) and merge them into the next block's TTS paragraph. All merged visual blocks share the same `data-index`, so click-to-seek and highlighting still work.
- The fallback (non-markdown) path is unaffected — those paragraphs are already filtered by `MIN_PARAGRAPH_LENGTH = 20` in extractor.ts and tend to be full-length.
- All 179 tests pass, build clean.

**Outcome:** Success. Short bylines, credits, and headings are now spoken together with the following content instead of as isolated pause-bounded utterances.

**Insight:** TTS quality has two pause levels: inter-sentence pauses (within an utterance, controlled by punctuation) and inter-paragraph pauses (between separate `SpeechSynthesisUtterance` chains). Fixing only sentence splitting wasn't enough — the paragraph-level grouping also needed short-item merging. A threshold of 80 chars catches bylines/credits while keeping real paragraphs separate.

**Promoted to Lessons Learned:** No — second occurrence of TTS pause issue, but different root cause (paragraph level vs sentence level). If it recurs, promote the two-level pause insight.

---

### [2026-02-22] Filter non-speakable paragraphs from TTS (images, data URIs, HTML tags, code blocks)

**Context:** User reported that TTS reads non-article content aloud — raw HTML `<img>` tags, data URIs, long image URLs, and other non-text artifacts that survive the extraction pipeline as paragraphs.

**What happened:**
- Extracted common content-stripping logic into `stripNonTextContent()` in `extractor.ts` — strips raw HTML tags, data URIs, and very long URLs (80+ chars).
- Applied `stripNonTextContent()` in both `stripMarkdownSyntax()` (markdown path) and `splitPlainTextParagraphs()` (plain text fallback path), ensuring consistent filtering regardless of which extraction path is used.
- Added `isSpeakableText()` filter to both `markdownToParagraphs()` and `splitPlainTextParagraphs()` — requires at least 3 word-like tokens (2+ letter sequences) to pass, filtering out paragraphs that are mostly URLs, base64 data, or non-text artifacts.
- Updated `renderArticleBody()` in `article-controller.ts` to skip `<pre>` blocks (code isn't meaningful when spoken) and handle `<figure>` blocks by only extracting figcaption text (skip image-only figures).
- Added 5 new tests: HTML tag stripping, data URI filtering, image-markdown filtering, Romanian diacritics preservation, and Jina image-only paragraph filtering.
- All 185 tests pass, build clean.

**Outcome:** Success. Non-speakable content (images, code blocks, data URIs, raw HTML) is now filtered from TTS paragraphs at both the extraction and rendering layers.

**Insight:** Content filtering must be applied in ALL paragraph extraction paths, not just the primary one. The markdown path (`markdownToParagraphs`) and the plain-text fallback path (`splitPlainTextParagraphs`) both need the same stripping and filtering, since articles can take either path depending on Readability/TurndownService success.

**Promoted to Lessons Learned:** No — first occurrence.

---

### [2026-02-22] Fix autoscroll highlight desync (ordinal position vs data-index)

**Context:** User reported that TTS autoscrolling sometimes lags behind — highlighting/scrolling to the wrong paragraph after recent commits that filter non-speakable content (images, code blocks, PRE elements).

**What happened:**
- Investigated the full TTS → highlight → scroll pipeline across `tts-engine.ts`, `article-controller.ts`, and `app.ts`.
- Root cause: `highlightParagraph()` in `app.ts` used ordinal position (`querySelectorAll('.paragraph')[i]`) to match against TTS paragraph index. Since commit `5a03552` introduced short-block merging (bylines/headings < 80 chars merged with next block), multiple DOM elements share the same `data-index` but have different ordinal positions. Ordinal position ≠ TTS index when merging occurs.
- The filtering commit (`74ea693`) made it worse by changing which blocks participate in merging, increasing the frequency of the mismatch.
- Fix: rewrote `highlightParagraph()` to use `data-index` attribute (already set by `renderArticleBody`) instead of ordinal position. All merged blocks with the same TTS index now highlight together, and `scrollIntoView` targets the first block of the correct TTS paragraph.
- Added inline documentation in `article-controller.ts` at the `flush()` function and skip logic to document the `data-index` contract.
- All tests pass, build clean.

**Outcome:** Success. Autoscroll now correctly tracks TTS position regardless of block merging or filtering.

**Insight:** When DOM elements have a many-to-one relationship with logical indices (via merging), ordinal position in query results is unreliable. Always use the explicit `data-index` attribute for lookup. The `data-index` was already being set correctly — only the consumer was wrong.

**Promoted to Lessons Learned:** Yes — 2nd occurrence of TTS-DOM index mismatch. Added lesson about never using ordinal DOM position for TTS paragraph lookup.

---

### [2026-02-23] Fix PWA background audio and wake lock re-acquisition

**Context:** User reported two issues: (1) audio stops when the PWA goes to background on Android, (2) screen doesn't stay awake during playback.

**What happened:**
- **Background audio fix:** Chrome on Android suspends JavaScript when a PWA goes to background, killing the `speechSynthesis` callback chain. The existing `visibilitychange` handler only resumes TTS when returning to foreground — it can't prevent the suspension. Added `src/lib/media-session.ts` which plays a silent `<audio>` track (1-second WAV generated programmatically) and registers `navigator.mediaSession` handlers. The active media session prevents Chrome from suspending the page, and adds lock screen playback controls (play/pause/skip).
- **Wake Lock fix:** The Screen Wake Lock API was already implemented and enabled by default, but per W3C spec the lock is automatically released when the page becomes hidden. The `visibilitychange` handler never re-acquired it. Added `this.acquireWakeLock()` to the visibility handler so the lock is re-acquired on return to foreground.
- Integrated `MediaSessionController` into `TTSEngine`: activated on play, paused/resumed in sync, deactivated on stop/end.
- Added article title pass-through from `ArticleController.displayArticle()` to `tts.loadArticle()` for lock screen metadata.
- Updated `sw.js` precache list to include `lib/media-session.js`, bumped SW version.
- Wrapped `audio.play()` return in `Promise.resolve()` to handle jsdom's non-spec-compliant `undefined` return.
- All 185 tests pass, build clean.

**Outcome:** Success. Both background audio persistence and wake lock re-acquisition are fixed.

**Insight:** The Web Speech API (`speechSynthesis`) is not treated as "media playback" by Android Chrome — it doesn't create a media session and gets suspended with the page. Playing a silent `<audio>` track creates a proper media session that Android keeps alive. The `navigator.mediaSession` API adds lock screen controls as a bonus. For wake lock: it's released on visibility change per W3C spec, so re-acquiring on `visibilitychange` → `visible` is mandatory.

**Promoted to Lessons Learned:** Yes — background audio via silent track + MediaSession, and wake lock re-acquisition pattern.

---

### [2026-02-23] Fix image links appearing in rendered article view (root cause)

**Context:** User reported that image links (e.g., `[Image: ...]`) still appear in the rendered article view despite multiple previous fix attempts. The issue had been reported and "fixed" multiple times, but the root cause was never addressed. Supersedes the earlier partial fix (PR #20) which only stripped raw `<img>` tags and added `img` to the sanitizer selector.

**What happened:**
- Root cause analysis revealed two independent layers of the problem:
  1. **Visual rendering layer**: `sanitizeRenderedHtml()` removed scripts/styles/iframes but never removed `<img>`, `<picture>`, `<svg>` elements. Markdown image syntax (`![alt](url)`) rendered by `marked.parse()` produced `<img>` tags that survived sanitization. Image-format links (`[Image: desc](url)`) rendered as clickable `<a>` tags. Raw HTML `<img>` tags in markdown were escaped by marked to literal `&lt;img&gt;` text.
  2. **TTS extraction layer**: `stripMarkdownSyntax()` converted `![alt](url)` → `alt` (kept alt text), so image descriptions became speakable text. `stripNonTextContent()` lacked patterns for image markdown, image URLs with common extensions, and `[Image: ...]` references.
- Previous fixes only patched individual symptoms at the TTS layer but never touched the rendering layer.
- Applied defense-in-depth fix across both layers:
  - `renderMarkdownHtml()`: Strip raw `<img>` HTML tags, image markdown (`![...](...)`) and `[Image...](...)` before passing to `marked.parse()`.
  - `sanitizeRenderedHtml()`: Remove `<img>`, `<picture>`, `<source>`, `<svg>` elements. Remove empty or image-text-only `<a>` tags.
  - `stripMarkdownSyntax()`: Remove `![...](...)` entirely (not keep alt text). Add `[Image...](...)` pattern before general link extraction.
  - `stripNonTextContent()`: Add `![...](...)`, `[Image...](...)`, standalone `[Image...]`, and image URL extension (`.jpg`, `.png`, etc.) patterns.
- Added 4 new tests: `[Image: ...](url)` link removal, short image URL removal, image-alt-text removal, false-positive preservation.
- All 189 tests pass, build clean.

**Outcome:** Success. Image content is now filtered at both the visual rendering and TTS extraction layers.

**Insight:** Content filtering bugs recur when fixes only address one layer of a multi-layer pipeline. The markdown rendering path (markdown → marked.parse → HTML → DOM) and the TTS extraction path (markdown → stripMarkdownSyntax → stripNonTextContent → isSpeakableText) are independent — fixing one doesn't fix the other. Image filtering must be applied at: (1) the markdown source before rendering, (2) the HTML sanitizer as safety net, and (3) the text extraction functions.

**Promoted to Lessons Learned:** Yes — multi-layer content filtering insight (3rd occurrence of image filtering issue).

---

### 2026-02-23 — Add document support: pasted text, PDF, TXT files

**Task:** Add support for pasted multi-paragraph text (via textarea), local PDF documents, local TXT files, and 3-sentence paragraph fallback when paragraph boundaries are undetectable.

**Changes:**
- **Sentence-based paragraph splitting** (`extractor.ts`): Added `splitTextBySentences()` and `splitSentences()` functions. Modified `splitPlainTextParagraphs()` to fall back to 3-sentence grouping when newline-based splitting yields ≤1 paragraph. Handles abbreviations (Mr., Dr., St., etc.), decimal numbers, and question/exclamation marks.
- **Textarea replacement** (`index.html`, `style.css`, `dom-refs.ts`): Replaced `<input type="text">` with `<textarea>` for URL/text input. Added auto-grow CSS (`field-sizing: content`, `max-height: 200px`). Updated `urlInput` type from `HTMLInputElement` to `HTMLTextAreaElement`. Updated Enter key handling in `article-controller.ts`: plain Enter submits for single-line input (URLs), Ctrl/Cmd+Enter always submits, bare Enter in multi-line content inserts newline.
- **File upload UI** (`index.html`, `style.css`, `dom-refs.ts`): Added hidden `<input type="file" accept=".pdf,.txt,.text">` and styled "Open PDF or Text File" button with document icon SVG. Added `fileInput` and `fileBtn` to `AppDomRefs`.
- **Text file support** (`extractor.ts`): Added `createArticleFromTextFile(file: File)` — reads via `file.text()`, uses `splitPlainTextParagraphs()` (with 3-sentence fallback), title from filename sans extension.
- **PDF support** (`extractor.ts`): Added `createArticleFromPdf(file: File)` with lazy loading of pdf.js from CDN via dynamic `import()`. Added `extractParagraphsFromTextItems()` for paragraph detection from vertical position gaps in PDF text items. Falls back to sentence splitting when structural detection yields ≤1 paragraph.
- **Controller wiring** (`article-controller.ts`): Added `handleFileUpload()` method, wired file button/input events in `init()`.
- **Tests**: Added 24 new tests covering sentence splitting, 3-sentence fallback, text file extraction, PDF text item parsing, and PDF article creation (with mocked pdfjsLib).

**Key decisions:**
1. pdf.js loaded via dynamic `import()` from jsDelivr CDN (lazy, no page-load cost). Falls back to global `pdfjsLib` if available (for tests/manual loading).
2. Changed `splitPlainTextParagraphs` threshold from `> 0` to `> 1` — single-paragraph results now trigger further splitting attempts. Updated one existing test accordingly.
3. `createArticleFromTextFile` does NOT delegate to `createArticleFromText` (which strips first line as title). Instead builds Article directly with filename as title and all content as body.

**Outcome:** All 213 tests pass (189 existing + 24 new), build clean.

**Insight:** When composing functions (`createArticleFromTextFile` → `createArticleFromText`), the inner function's assumptions (first line = title) may not match the outer context (title = filename). Direct construction is safer than post-hoc overriding when the inner function mutates the input.

**Promoted to Lessons Learned:** No

---

### [2026-02-23] Periodic maintenance — audit and clean all config files

**Context:** Ran the periodic maintenance protocol per `SETUP_AI_AGENT_CONFIG.md`. First maintenance pass on this project.

**What happened:**
- **AGENTS.md audit:** Stripped from 114 lines to ~42 lines. Removed all discoverable content (project overview, tech stack, codemaps links, repository layout, CI/CD, testing notes) and all content duplicated in LESSONS_LEARNED.md (9 items: .js extensions, outDir overlap, SW plain JS, globals, Worker env bindings, extractUrl behavior, TTS _speakGen, POST-hostile paths, npm tsc). Restructured to spec template: Constraints (2 non-discoverable items), Legacy (empty), Learning System, Sub-Agents table.
- **LESSONS_LEARNED.md audit:** All 24 lessons verified current and relevant. Zero stale, zero duplicated. No changes needed.
- **ITERATION_LOG.md audit:** 25 entries reviewed. All 3 repeated patterns already promoted. Added missing "Promoted to Lessons Learned" fields to 2 entries (themes, document support).
- **Sub-agents audit:** Trimmed 5 agents from over 100 lines to under 100 each — removed generic content irrelevant to this browser-only PWA (React/Next.js patterns, SQL injection, CQRS/Event Sourcing, Stripe example, Redis ADR). Created 2 missing agents (agent-creator.md, ux-expert.md).
- **Cross-file check:** Eliminated all AGENTS.md ↔ LESSONS_LEARNED overlap. Updated sub-agents table to match 8 agents in .claude/agents/.

**Outcome:** Success. All files pass the maintenance spec verification checklist.

**Insight:** AGENTS.md had grown to 114 lines mostly through discoverable content and duplicated lessons — exactly what the research (Evaluating AGENTS.md) warns against. Stripping to bootstrap-only content reduced it by 63%. The sub-agents inherited from a template repo contained generic patterns (React, SQL, Redis) irrelevant to this project.

**Promoted to Lessons Learned:** No — first maintenance pass, no reusable lesson yet.

---

### [2026-02-24] Fix PWA background playback — audio element must be in DOM

**Context:** User reported that PWA still stops playback when the screen is closed or the app is minimized, despite the silent audio + MediaSession implementation from 2026-02-23.

**What happened:**
- Root cause: the `<audio>` element created by `MediaSessionController` was never appended to `document.body`. Android Chrome ignores detached audio elements when deciding whether to suspend a page — the silent track was playing but the browser didn't "see" it as a real media session.
- Three fixes applied to `media-session.ts`:
  1. **Append audio to DOM** — `ensureAudio()` now calls `document.body.appendChild(this.audio)` with `playsinline` attribute. This is the critical fix.
  2. **Visibility change handler** — Added `visibilitychange` listener in the controller that restarts the silent audio if the browser paused it while backgrounded.
  3. **Keep-alive watchdog** — 5-second interval timer that checks if the audio is still playing and restarts it if not. Belt-and-suspenders defense.
- Increased silent WAV duration from 1 second to 10 seconds. Reduces loop restarts and is more reliably treated as "real" media by some Android Chrome versions.
- Fixed `tts-engine.ts` visibility change handler to call `mediaSession.notifyResume()` when returning from background, ensuring the silent audio gets restarted alongside TTS recovery.
- Bumped SW_VERSION to `2026.02.24.1`.
- All 214 tests pass, build clean.

**Outcome:** Success. The silent audio element is now in the DOM and has multiple recovery mechanisms.

**Insight:** Creating an `<audio>` element with `document.createElement()` and calling `.play()` on it is not sufficient for Android Chrome media session recognition. The element MUST be in the DOM (`document.body.appendChild(audio)`) for the browser to treat it as real media that prevents page suspension. Additionally, the browser may pause the audio when the page goes to background — a periodic keep-alive and `visibilitychange` handler provide defense-in-depth.

**Promoted to Lessons Learned:** Yes — updated existing background audio lesson with DOM requirement.

---

### [2026-02-24] YouTube Music-style media notification playbar + background TTS watchdog

**Context:** User reported that audio stops after the current sentence when minimizing (only works the first time). Requested YouTube Music-style notification playbar with artwork, progress bar, and seek controls.

**What happened:**
- **Bug fix — TTS watchdog timer:** Added a 3-second interval watchdog in `tts-engine.ts` that detects when `speechSynthesis` has silently stalled (Chrome Android may drop `speak()` calls from backgrounded pages) and restarts the utterance chain from the current position. Wired into play/pause/resume/stop lifecycle. This complements the existing `visibilitychange` handler (which only fires on return to foreground) by providing continuous background recovery.
- **Artwork in notification:** Added `artwork` field to `MediaMetadata` in `media-session.ts` using the existing app icons (`icon-192.png`, `icon-512.png`). Static icons chosen over dynamic canvas/og:image for simplicity and offline reliability.
- **Notification seekbar via `setPositionState()`:** Added character-count-based timeline estimation (`computeTimeline()` pure function) that maps discrete paragraph/sentence positions to continuous seconds. Called on every sentence completion via `emitProgress()`. Enables the OS to show a progress bar with estimated time in the notification.
- **Seek action handlers:** Added `seekforward` (maps to `skipSentenceForward`), `seekbackward` (maps to `skipSentenceBackward`), and `seekto` (reverse-maps time position to paragraph/sentence via character count) action handlers. Extends `MediaSessionActions` interface with optional seek methods.
- **`seekToTime()` method on TTSEngine:** Reverse-maps seconds to paragraph/sentence position using the same character-count model, enabling notification seekbar dragging.
- Added 4 new tests: `seekToTime` paragraph jump, `computeTimeline` at start/advancing/rate scaling/end.
- All 219 tests pass, build clean.

**Outcome:** Success. Full media notification with artwork, title, progress bar, and all playback + seek controls. Background TTS stalling fixed by watchdog.

**Insight:** `navigator.mediaSession.setPositionState()` is what unlocks the progress bar and time display in Android's media notification. Without it, you get buttons only. The character-count estimation (~14 chars/sec at 1x rate) is a good-enough approximation for TTS timeline; exact accuracy is impossible since TTS rate varies per word. A TTS-specific watchdog (separate from the audio keep-alive) is needed because `speechSynthesis.speak()` can silently fail in background even when the page stays alive via silent audio.

**Promoted to Lessons Learned:** Yes — TTS background watchdog pattern and setPositionState for notification seekbar.

---

<!-- New entries go above this line, most recent first -->
