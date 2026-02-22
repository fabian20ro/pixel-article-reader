# Module Reference

## src/app.ts — Main Orchestrator (453 lines)

Entry point. Wires all modules together and manages UI state.

**Key functions:**
- `main()` — boot sequence: registers SW, loads settings, inits TTS, binds all event listeners
- `toTranslateUrl(url, targetLang)` — converts article URL to Google Translate proxy URL
- `loadArticle(url)` — full pipeline: show loading → extract → display → init TTS
- `displayArticle(article)` — renders paragraphs to DOM, loads into TTS engine
- `showView(view)` — switches between `input | loading | error | article` views
- `showError(msg)` — displays error message to user
- `handleUrlSubmit()` — reads input, extracts URL, calls loadArticle

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
| `extractUrl(text)` | Pulls first `http(s)://` URL from arbitrary text |
| `isValidArticleUrl(input)` | Validates: must be http/https with dotted hostname |
| `clearQueryParams()` | Removes query string from URL bar without reload |

---

## src/lib/lang-detect.ts — Language Detection (37 lines)

Pure function, no dependencies.

| Function | Purpose |
|----------|---------|
| `detectLanguage(text)` | Returns `'en'` or `'ro'` based on first 1000 chars |

**Strategy:** counts Romanian diacritics (ă, â, î, ș, ț) and checks for 23 common Romanian words. If >3 diacritics or >2 word matches → Romanian.

---

## src/lib/extractor.ts — Article Extraction (157 lines)

Fetches HTML through CORS proxy, parses with Readability.js.

| Function | Purpose |
|----------|---------|
| `extractArticle(url, proxyBase, proxySecret?)` | Main entry: fetch + parse |
| `fetchViaProxy(url, proxyBase, proxySecret?)` | Fetches HTML via CORS proxy, returns `{ html, finalUrl }` |
| `parseArticle(html, sourceUrl)` | Parses with Readability, splits into paragraphs, detects language |

**Error handling:**
- `TypeError` → "Could not reach the article proxy"
- `AbortError` → "Timed out fetching the article"
- HTTP 403 → hints about PROXY_SECRET
- HTTP 429 → rate limit exceeded, shows retry-after time
- Content-length > 2 MB → rejects

**Interface:** `Article { title, content, textContent, paragraphs, lang, siteName, excerpt, wordCount, estimatedMinutes, resolvedUrl }`

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

**Key design:** Each sentence is one `SpeechSynthesisUtterance`, chained via `onend` callbacks. This avoids Chrome Android's 15-second speech cutoff bug.

---

## worker/cors-proxy.js — Cloudflare Worker (190 lines)

CORS proxy that fetches article HTML on behalf of the browser client.

| Component | Detail |
|-----------|--------|
| Entry | `export default { fetch(request, env) }` |
| Auth | `X-Proxy-Key` header validated against `env.PROXY_SECRET` |
| Rate limit | 20 requests/minute per client IP (in-memory sliding window) |
| SSRF | Blocks private IP ranges (127.x, 10.x, 172.16-31.x, 192.168.x, etc.) |
| Limits | 2 MB max response, 10s fetch timeout |
| Headers | Returns `X-Final-URL` (resolved URL after redirects) |
| CORS | `Access-Control-Allow-Origin` set to `env.ALLOWED_ORIGIN` |

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
