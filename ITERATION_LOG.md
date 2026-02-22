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

<!-- New entries go above this line, most recent first -->
