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

<!-- New entries go above this line, most recent first -->
