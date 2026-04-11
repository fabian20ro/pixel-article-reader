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
  │                      extractor.ts ── Worker raw fetch or `/parse`
  │                        │                         │
  │                        │                         ├── SSRF check
  │                        │                         ├── Rate limit + SSRF validation
  │                        │                         ├── Rate limit (60 req/min)
  │                        │                         ├── Fetch target HTML/PDF/EPUB
  │                        │                         └── Fetch YouTube transcript server-side
  │                        │
  │                        ▼
  │            parseArticleFromHtml()
  │              ├── Readability.js (global)
  │              ├── TurndownService (global)
  │              ├── markdown normalization
  │              └── TTS paragraph extraction
  │
  │  (optional translate button)
  │                      translator.ts ── POST /?action=translate
  │                        │                         │
  │                        │                         └── Worker calls Google Translate API
  │                        ▼
  │            Article.paragraphs = translated strings
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
  ├── copy markdown
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

1. `index.html` loads `/src/app.ts` in dev or hashed `dist/assets/*.js` in production
2. NPM dependencies are bundled by Vite into `dist/assets/*`
3. `dist/sw.js` is generated from repo-root `sw.js`
4. `sw.js` is registered by `pwa-update-manager`

## Deployment Targets

| Component | Target | Trigger |
|-----------|--------|---------|
| App (HTML/CSS/JS) | GitHub Pages | Push to main → `deploy-pages.yml` |
| CORS Proxy Worker | Cloudflare Workers | Cloudflare Git integration redeploy on `main` changes in `worker/` |
