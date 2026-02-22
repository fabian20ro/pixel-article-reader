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

<!-- New entries go above this line, most recent first -->
