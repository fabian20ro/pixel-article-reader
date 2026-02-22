# AGENTS.md — ArticleVoice

## Project Overview

ArticleVoice is a Progressive Web App that converts article URLs (or pasted article text) into spoken audio using the browser's Web Speech API. It uses a CORS proxy (Cloudflare Worker) to fetch content, normalizes content to markdown for rich reading/export, and uses SpeechSynthesis for text-to-speech.

## Memory & Continuous Learning

This project maintains a persistent learning system across AI agent sessions.

### Required Workflow

1. **Start of task:** Read `LESSONS_LEARNED.md` before writing any code
2. **During work:** Note any surprises, gotchas, or non-obvious discoveries
3. **End of iteration:** Append to `ITERATION_LOG.md` with what happened
4. **End of iteration:** If the insight is reusable and validated, also add to `LESSONS_LEARNED.md`
5. **Pattern detection:** If the same issue appears 2+ times in the log, promote it to a lesson

### Files

| File | Purpose | When to Write |
|------|---------|---------------|
| `LESSONS_LEARNED.md` | Curated, validated, reusable wisdom | End of iteration (if insight is reusable) |
| `ITERATION_LOG.md` | Raw session journal, append-only | End of every iteration (always) |

### Rules

- Never delete entries from `ITERATION_LOG.md` — it's append-only
- In `LESSONS_LEARNED.md`, obsolete lessons go to the Archive section, not deleted
- Keep entries concise — a future agent scanning 100 entries needs signal, not prose
- Date-stamp everything in `YYYY-MM-DD` format
- When in doubt about whether something is worth logging: log it

## Tech Stack

- **Language:** TypeScript (strict mode), compiled to ES2020 modules
- **Runtime:** Browser only — no Node.js server, no framework
- **Build:** `tsc` only — no bundler. Run `npm run build` to compile
- **Testing:** Vitest with jsdom environment. Run `npm test`
- **Hosting target:** GitHub Pages (static files)
- **CI/CD:** GitHub Actions — auto-deploys Pages on push, auto-deploys CF Worker on `worker/` changes

## Codemaps

Detailed architecture diagrams and module references live in `doc/codemaps/`:

- **[Architecture Overview](doc/codemaps/architecture.md)** — data flow, dependency graph, deployment targets
- **[Module Reference](doc/codemaps/modules.md)** — every module's API, functions, and key design notes

## Repository Layout & Development

See [README.md — Project Structure](README.md#project-structure) for the full directory layout and [README.md — Development](README.md#development) for build, test, and watch commands.

## Key Architecture Rules

1. **No bundler.** The browser loads ES modules directly. All import paths must end in `.js` (TypeScript source uses `.js` extensions in imports and `tsc` preserves them).
2. **Compiled JS goes to root and is generated-only.** `tsconfig.json` has `outDir: "."` and `rootDir: "src"`, so `src/app.ts` compiles to `./app.js` and `src/lib/foo.ts` compiles to `./lib/foo.js`. These outputs are gitignored; do not hand-edit them.
3. **Service Worker is plain JS.** `sw.js` is not TypeScript — it runs in a different scope and is kept simple.
4. **Readability/Turndown/marked are globals.** They are loaded via `<script>` tags before `app.js`. In TypeScript, they're accessed through ambient declarations in the modules that use them.
5. **The Cloudflare Worker is deployed separately.** `worker/cors-proxy.js` is deployed via GitHub Actions using wrangler. It uses environment bindings (`ALLOWED_ORIGIN`, `PROXY_SECRET`, optional `JINA_KEY`) instead of hardcoded constants.

## Critical Implementation Details

### URL Detection & Pasted Text (url-utils.ts + article-controller.ts)
`extractUrl()` only extracts URLs at/near the **end** of the input text (share-text format: "Title\nhttps://..."). If the URL is embedded in the middle of long text, the input is treated as pasted article content and parsed locally via `createArticleFromText()` in `extractor.ts` — no proxy fetch needed. The 150-char prefix limit distinguishes share text from pasted articles.

### TTS Sentence Chunking & Skip Safety (tts-engine.ts)
Chrome on Android silently stops speaking after ~15 seconds of continuous text. The engine splits each paragraph into sentences and speaks one `SpeechSynthesisUtterance` per sentence, chaining them via `onend` callbacks. **Do not combine sentences into a single utterance.** A generation counter (`_speakGen`) prevents stale `onend` callbacks from double-advancing the position during skip operations.

### Translate Button (article-controller.ts + translator.ts + lang-detect.ts)
The translate button sends the already-extracted article text to the Cloudflare Worker's `POST /?action=translate` endpoint, which calls Google Translate's API server-side and returns translated text. Language detection uses the HTML `lang` attribute and URL TLD to decide if translation is needed; if the language can't be determined, it defaults to "needs translation" (assumes non-English). The button works for both URL-fetched and pasted-text articles. Paragraphs are batched into ~3000-char chunks to minimize API calls.

### Markdown Pipeline (extractor.ts + article-controller.ts)
Primary extraction path is `URL -> HTML -> Readability -> markdown`. The article view is rendered from markdown (`marked.parse` + sanitization), while TTS uses normalized block text mapped to click/highlight indices.

### Jina Reader Retry (worker/cors-proxy.js + extractor.ts)
`extractArticleWithJina()` calls the Worker with `mode=markdown`, which fetches `https://r.jina.ai/<url>`. If `JINA_KEY` is configured, the Worker attaches it server-side. On failure, extractor falls back to the default Readability path.

### Share Target (manifest.json + url-utils.ts)
The PWA uses `method: "GET"` for its share target. Shared URLs arrive as query params (`?url=...`). Some apps put the URL in `?text=` instead — `url-utils.ts` checks both fields.

### CORS Proxy (worker/cors-proxy.js)
- **Security:** Rejects private IPs (SSRF), enforces 2 MB limit, 10s timeout, strips cookies. Auth via `X-Proxy-Key` header.
- **Rate limiting:** 20 req/min per client IP (in-memory sliding window). HTTP 429 with `Retry-After` header when exceeded.
- **URL resolution:** Follows redirects and returns final URL in `X-Final-URL` header. Critical for shortened URLs (e.g. `share.google`).
- **Jina markdown mode:** `GET /?url=...&mode=markdown` returns markdown content and preserves `X-Final-URL`.
- **Translation:** `POST /?action=translate` accepts `{ text, from, to }` JSON body, calls Google Translate API server-side, returns `{ translatedText, detectedLang }`. Max 5000 chars per request.

## Configuration

The proxy URL and secret must be set in `src/app.ts`:

```ts
const CONFIG = {
  PROXY_BASE: 'https://article-voice-proxy.fabian20ro.workers.dev',
  PROXY_SECRET: '',  // same value as the PROXY_SECRET worker secret
};
```

After changing, run `npm run build` to recompile.
Never add the npm package `tsc` to dependencies; it shadows the real TypeScript compiler binary.

## CI/CD

See [README.md — CI/CD](README.md#cicd) for workflow details and required GitHub secrets (`CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`, `PROXY_SECRET`, optional `JINA_KEY`).

## Testing Notes

- Tests use Vitest with `jsdom` environment for DOM API access
- `tts-engine.test.ts` mocks `speechSynthesis` and `SpeechSynthesisUtterance` globally
- `extractor.test.ts` mocks `fetch`, `Readability`, and `TurndownService`
- Pure-function modules (`url-utils.ts`, `lang-detect.ts`) are tested directly without mocks
