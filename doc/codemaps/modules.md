# Module Reference

## src/app.ts — Main Orchestrator

Entry point. Wires all modules together and manages UI state.

**Key functions:**
- `main()` — boot sequence: registers SW, loads settings, inits TTS, binds all event listeners
- `loadArticle(url)` — full pipeline: show loading → extract → display → init TTS
- `displayArticle(article)` — renders paragraphs to DOM, loads into TTS engine, shows translate button if needed
- `showView(view)` — switches between `input | loading | error | article` views
- `showError(msg)` — displays error message to user
- `handleUrlSubmit()` — reads input, extracts URL or parses pasted text, calls loadArticle or createArticleFromText
- Translate button handler — calls `translateParagraphs()`, updates article with translated text

**Config:**
```ts
CONFIG.PROXY_BASE   // Cloudflare Worker URL
CONFIG.PROXY_SECRET // shared secret for X-Proxy-Key header
```

**Settings (localStorage):** rate, lang, voiceName, wakeLock

---

## src/lib/url-utils.ts — URL Handling (54 lines)

Pure functions, no side effects (except `clearQueryParams` which uses `history.replaceState`).

| Function | Purpose |
|----------|---------|
| `getUrlFromParams()` | Reads `?url=`, `?text=`, `?title=` from current page URL |
| `extractUrl(text)` | Extracts URL from text only if at/near the end (share-text format); returns null for pasted article content |
| `isValidArticleUrl(input)` | Validates: must be http/https with dotted hostname |
| `clearQueryParams()` | Removes query string from URL bar without reload |

---

## src/lib/lang-detect.ts — Language Detection

Pure functions, no dependencies.

| Function | Purpose |
|----------|---------|
| `detectLanguage(text)` | Returns `'en'` or `'ro'` based on first 1000 chars (for TTS voice selection) |
| `detectLangFromHtml(htmlLang)` | Normalizes HTML `lang` attribute (e.g. `"de-DE"` → `"de"`) |
| `detectLangFromUrl(url)` | Maps URL TLDs to language codes (`.de` → `"de"`, `.com` → `""`) |
| `needsTranslation(htmlLang, url, textLang?)` | Returns true if article should be translated to English |
| `getSourceLang(htmlLang, url)` | Best-guess source language code for translation API (`'auto'` if unknown) |

**Strategy for `detectLanguage`:** counts Romanian diacritics (ă, â, î, ș, ț) and checks for 23 common Romanian words. If >3 diacritics or >2 word matches → Romanian.

**Strategy for `needsTranslation`:** checks htmlLang → URL TLD → text detection in priority order. If language can't be determined, defaults to true (assumes non-English).

---

## src/lib/extractor.ts — Article Extraction (157 lines)

Fetches HTML through CORS proxy, parses with Readability.js.

| Function | Purpose |
|----------|---------|
| `extractArticle(url, proxyBase, proxySecret?)` | Main entry: fetch + parse |
| `createArticleFromText(text)` | Creates Article from pasted plain text (no fetch needed) |
| `fetchViaProxy(url, proxyBase, proxySecret?)` | Fetches HTML via CORS proxy, returns `{ html, finalUrl }` |
| `parseArticle(html, sourceUrl)` | Parses with Readability, splits into paragraphs, detects language |

**Error handling:**
- `TypeError` → "Could not reach the article proxy"
- `AbortError` → "Timed out fetching the article"
- HTTP 403 → hints about PROXY_SECRET
- HTTP 429 → rate limit exceeded, shows retry-after time
- Content-length > 2 MB → rejects

**Interface:** `Article { title, content, textContent, paragraphs, lang, htmlLang, siteName, excerpt, wordCount, estimatedMinutes, resolvedUrl }`

---

## src/lib/translator.ts — Translation via CORS Proxy

Sends text to the Cloudflare Worker's translate endpoint for server-side Google Translate API calls.

| Function | Purpose |
|----------|---------|
| `translateParagraphs(paragraphs, sourceLang, targetLang, proxyBase, proxySecret?)` | Translates an array of paragraphs, returns translated array of same length |
| `buildBatches(paragraphs)` | Groups paragraphs into ~3000-char batches joined by `\n\n` |

**Concurrency:** max 3 in-flight translation requests. Batching minimizes API calls for typical articles (3-10 batches instead of 20-30 per-paragraph calls).

**Error handling:** propagates root cause from worker response — includes HTTP status, batch index, rate limit info, and network errors.

---

## src/lib/tts-engine.ts — Text-to-Speech Engine (424 lines)

Web Speech API wrapper with sentence-level chunking.

**Class: `TTSEngine`**

| Method | Purpose |
|--------|---------|
| `init()` | Loads available voices (async) |
| `loadArticle(paragraphs, lang)` | Splits paragraphs into sentences, selects voice |
| `play() / pause() / resume() / stop()` | Playback control |
| `skipForward() / skipBackward()` | Jump one paragraph |
| `skipSentenceForward() / skipSentenceBackward()` | Jump one sentence |
| `jumpToParagraph(index)` | Seek to specific paragraph |
| `setRate(rate) / setVoice(name) / setLang(lang)` | Configuration |
| `setWakeLock(enabled)` | Toggle screen wake lock |

**Helper functions:**
| Function | Purpose |
|----------|---------|
| `splitSentences(text)` | Regex split on `.!?` followed by whitespace |
| `selectVoice(voices, lang, preferred?)` | Picks best voice, prefers Google voices |
| `waitForVoices(timeout?)` | Async wait for `voiceschanged` event |

**Key design:** Each sentence is one `SpeechSynthesisUtterance`, chained via `onend` callbacks. This avoids Chrome Android's 15-second speech cutoff bug. A generation counter (`_speakGen`) prevents stale `onend` callbacks from double-advancing during skip operations.

---

## worker/cors-proxy.js — Cloudflare Worker

CORS proxy that fetches article HTML and provides server-side translation.

| Component | Detail |
|-----------|--------|
| Entry | `export default { fetch(request, env) }` |
| Auth | `X-Proxy-Key` header validated against `env.PROXY_SECRET` |
| Rate limit | 20 requests/minute per client IP (in-memory sliding window) |
| SSRF | Blocks private IP ranges (127.x, 10.x, 172.16-31.x, 192.168.x, etc.) |
| Limits | 2 MB max HTML response, 5000 chars max translate text, 10s fetch timeout |
| Headers | Returns `X-Final-URL` (resolved URL after redirects) |
| CORS | `Access-Control-Allow-Origin` set to `env.ALLOWED_ORIGIN` |
| Translate | `POST /?action=translate` — accepts `{ text, from, to }`, calls Google Translate API, returns `{ translatedText, detectedLang }` |

**Rate limit response headers:**
- `X-RateLimit-Limit` — max requests per window (20)
- `X-RateLimit-Remaining` — remaining requests
- `Retry-After` — seconds until window resets (on 429 responses)

---

## sw.js — Service Worker (plain JS)

Cache-first strategy for app shell, network-only for proxy requests. Uses `ignoreSearch: true` for navigation so share target URLs (`?url=...`) hit the cache.

---

## vendor/Readability.js — Mozilla Readability (~2800 lines)

Vendored from `mozilla/readability`. Loaded as a global via `<script>` tag. Extracts article content from full HTML pages (removes navigation, ads, sidebars, etc.).
