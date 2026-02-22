# Architecture Overview

## Data Flow

```
User pastes URL / article text / shares from browser
  │
  ▼
url-utils.ts ── extractUrl() / getUrlFromParams()
  │
  ├── URL found ────────────────────────────────────────────────────────┐
  │                                                                      ▼
  │                      extractor.ts ── fetchViaProxy(mode=html)
  │                        │                         │
  │                        │                         ├── SSRF check
  │                        │                         ├── Auth (X-Proxy-Key)
  │                        │                         ├── Rate limit (20 req/min)
  │                        │                         └── Fetch target HTML
  │                        │
  │                        ▼
  │            parseArticleFromHtml()
  │              ├── Readability.js (global)
  │              ├── TurndownService (global)
  │              ├── markdown normalization
  │              └── TTS paragraph extraction
  │
  │  (optional retry button)
  │                      extractor.ts ── fetchViaProxy(mode=markdown)
  │                        │                         │
  │                        │                         └── Worker fetches https://r.jina.ai/<url>
  │                        │                             with optional Bearer JINA_KEY
  │                        ▼
  │            parseArticleFromMarkdown() ── fallback to extractArticle() on error
  │
  ├── No URL (pasted text) ──┐
  │                          ▼
  │               createArticleFromText()
  │                 ├── markdown = plain text
  │                 ├── paragraph splitting
  │                 └── lang detection
  │
  ▼
article-controller.ts
  ├── marked.parse(markdown) + sanitize
  ├── render block elements + map to TTS paragraph indices
  ├── copy markdown / retry with Jina
  └── call tts-engine.ts

tts-engine.ts ── sentence chunking ── SpeechSynthesisUtterance per sentence
```

## Module Dependency Graph

```
app.ts
  ├── lib/dom-refs.ts
  ├── lib/settings-store.ts
  ├── lib/pwa-update-manager.ts
  ├── lib/article-controller.ts
  │     ├── lib/url-utils.ts
  │     ├── lib/extractor.ts
  │     │     └── lib/lang-detect.ts
  │     ├── lib/translator.ts
  │     └── lib/lang-detect.ts
  ├── lib/tts-engine.ts
  │     └── lib/lang-detect.ts
  └── lib/release.ts
```

## Runtime Loading Order

1. `vendor/Readability.js` — global `Readability`
2. `vendor/turndown.js` — global `TurndownService`
3. `vendor/marked.js` — global `marked.parse`
4. `app.js` — ES module entrypoint
5. `sw.js` — registered by `pwa-update-manager`

## Deployment Targets

| Component | Target | Trigger |
|-----------|--------|---------|
| App (HTML/CSS/JS) | GitHub Pages | Push to main → `deploy-pages.yml` |
| CORS Proxy Worker | Cloudflare Workers | Cloudflare Git integration redeploy on `main` changes in `worker/` |
