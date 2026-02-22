# Architecture Overview

## Data Flow

```
User pastes URL / article text / shares from browser
  │
  ▼
url-utils.ts ── extractUrl() / getUrlFromParams()
  │
  ├── URL found ──────────────────────┐
  │                                   ▼
  │                    extractor.ts ── fetchViaProxy() ── CORS Proxy (CF Worker)
  │                      │                                   │
  │                      │                                   ├── SSRF check
  │                      │                                   ├── Auth (X-Proxy-Key)
  │                      │                                   ├── Rate limit (20 req/min)
  │                      │                                   └── Fetch target HTML
  │                      │                                        │
  │                      ▼                                        ▼
  │                    parseArticle() ◄──── HTML response + X-Final-URL header
  │                      │
  │                      ├── Readability.js (global)
  │                      ├── lang-detect.ts
  │                      └── paragraph splitting + word count
  │                      │
  │                      ▼
  │               Article object ──────────────────────┐
  │                                                    │
  ├── No URL (pasted text) ──┐                         │
  │                          ▼                         │
  │          createArticleFromText()                   │
  │            ├── paragraph splitting                 │
  │            ├── lang-detect.ts                      │
  │            └── word count                          │
  │                          │                         │
  │                          ▼                         │
  │               Article object ──────┐               │
  │                                    │               │
  ▼                                    ▼               ▼
app.ts ── displayArticle() ── renders paragraphs to DOM
  │
  ▼
tts-engine.ts ── loadArticle() ── splits paragraphs into sentences
  │
  ▼
tts-engine.ts ── play() ── SpeechSynthesisUtterance per sentence
                              │
                              ├── onend → next sentence
                              ├── paragraph boundary → onParagraphChange
                              └── last sentence of last para → onEnd
```

## Module Dependency Graph

```
app.ts
  ├── lib/url-utils.ts      (no deps)
  ├── lib/extractor.ts
  │     └── lib/lang-detect.ts  (no deps)
  └── lib/tts-engine.ts
        └── lib/lang-detect.ts  (type import only)
```

## Runtime Loading Order

1. `vendor/Readability.js` — loaded via `<script>` tag, declares global `Readability`
2. `app.js` — loaded as ES module via `<script type="module">`
3. `sw.js` — registered by `app.js` via `navigator.serviceWorker.register()`

## Deployment Targets

| Component | Target | Trigger |
|-----------|--------|---------|
| App (HTML/CSS/JS) | GitHub Pages | Push to main → `deploy-pages.yml` |
| CORS Proxy Worker | Cloudflare Workers | Push changes in `worker/` → `deploy-worker.yml` |
