# Module Reference

## src/app.ts — Bootstrap Orchestrator

Thin entrypoint that wires modules together.

**Responsibilities:**
- Initialize typed DOM refs (`dom-refs.ts`)
- Load/persist user settings (`settings-store.ts`)
- Initialize `TTSEngine`
- Initialize `PwaUpdateManager` (startup/visibility update checks)
- Initialize `ArticleController` for extraction/rendering actions

---

## src/lib/article-controller.ts — Article UI + Flow

Coordinates URL submit, extraction, rendering, translation, markdown export, and Jina retry.

| Method | Purpose |
|--------|---------|
| `init()` | Binds UI event listeners (go, translate, Jina retry, copy markdown, retry) |
| `handleInitialSharedUrl()` | Handles share-target query params |
| `setLangOverride(lang)` | Updates language override and active article playback language |
| `displayArticle(article)` | Renders metadata + markdown/paragraphs, loads TTS |

**Key behavior:**
- Markdown render path: `marked.parse()` + sanitizer
- TTS alignment: maps rendered top-level blocks to paragraph indices
- Copy action: writes `article.markdown` to clipboard
- Jina retry: calls `extractArticleWithJina()` using current URL

---

## src/lib/extractor.ts — Extraction + Markdown Normalization

Converts fetched content into `Article` with markdown and TTS paragraphs.

**Interface:**
`Article { title, content, textContent, markdown, paragraphs, lang, htmlLang, siteName, excerpt, wordCount, estimatedMinutes, resolvedUrl }`

| Function | Purpose |
|----------|---------|
| `extractArticle(url, proxyBase, proxySecret?)` | Default path: Worker HTML fetch + Readability parse + Turndown markdown |
| `extractArticleWithJina(url, proxyBase, proxySecret?)` | Worker markdown mode (`mode=markdown`) via Jina; falls back to default extractor |
| `createArticleFromText(text)` | Creates article from pasted text without fetching |

**Pipeline details:**
- Readability HTML extraction
- `TurndownService.turndown(contentHtml)`
- Markdown-to-paragraph normalization for TTS
- Title extraction from markdown (`# heading` fallback)

---

## src/lib/pwa-update-manager.ts — SW Update Policy

Encapsulates service worker registration/update/reload behavior.

| API | Purpose |
|-----|---------|
| `init('sw.js')` | Registers SW with `updateViaCache: 'none'` and runs startup check |
| `checkForUpdates()` | Calls `registration.update()` |
| `forceRefresh()` | Update + clear caches + reload |
| `applyDeferredReloadIfIdle()` | Applies pending reload once playback is idle |

**Types:**
- `PwaUpdateManagerOptions`
- `PwaUpdateActionResult = 'reloaded' | 'deferred' | 'no-change' | 'failed'`

---

## src/lib/settings-store.ts — Local Settings Persistence

Stores app settings in `localStorage` with sanitization.

| Function | Purpose |
|----------|---------|
| `createDefaultSettings(defaults)` | Constructs defaults |
| `loadSettings(defaults)` | Loads + validates persisted values |
| `saveSettings(settings)` | Persists settings |

---

## src/lib/dom-refs.ts — Typed DOM Registry

Single place for required element lookups.

**Exports:**
- `AppDomRefs` (typed map of all required elements)
- `getAppDomRefs(document)`

Throws on missing required elements to fail early.

---

## src/lib/translator.ts — Translation via Worker

Sends paragraph batches to `POST /?action=translate` and reassembles output.

| Function | Purpose |
|----------|---------|
| `translateParagraphs(...)` | Batch + parallel translation |
| `buildBatches(paragraphs)` | Splits paragraphs into ~3000-char payloads |

---

## src/lib/tts-engine.ts — Text-to-Speech Engine

Web Speech API wrapper with sentence-level chunking and skip safety.

**Notable design constraints:**
- One utterance per sentence to avoid Chrome Android long-utterance cutoff.
- `_speakGen` generation counter prevents stale `onend` callbacks from double-advancing.

---

## src/lib/url-utils.ts — URL Handling

Pure utilities for URL extraction and share-target parsing.

| Function | Purpose |
|----------|---------|
| `extractUrl(text)` | Accept URL only when at/near end (share-text pattern) |
| `getUrlFromParams()` | Reads shared URL from query params |
| `clearQueryParams()` | Clears query params without reload |
| `isValidArticleUrl(input)` | Validates URL format |

---

## src/lib/lang-detect.ts — Language Signals

Language detection and translation gating heuristics.

---

## worker/cors-proxy.js — Cloudflare Worker

Endpoints:
- `GET /?url=...` → fetch HTML
- `GET /?url=...&mode=markdown` → fetch markdown through Jina Reader
- `POST /?action=translate` → Google Translate API proxy

Security and limits:
- SSRF blocklist
- Optional `X-Proxy-Key` auth via `PROXY_SECRET`
- 20 req/min per IP
- 2 MB max response
- 10s upstream timeout

---

## sw.js — Service Worker (plain JS)

- Navigation: network-first with cache fallback
- Static same-origin assets: stale-while-revalidate
- Proxy/API requests: network-only
- Cache versioning with `SW_VERSION`

---

## vendor/* — Browser Globals

- `Readability.js` → `Readability`
- `turndown.js` → `TurndownService`
- `marked.js` → `marked.parse`
