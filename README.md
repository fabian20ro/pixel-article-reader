# Article Local Reader

**Live app: https://fabian20ro.github.io/pixel-article-reader/**

PWA that turns any article into audio using on-device TTS with a queue-based playlist system. Extracts readable content from URLs, renders it as formatted markdown, and reads it aloud with sentence-level controls. Also supports local files (PDF, TXT, Markdown, EPUB) and pasted text.

## How It Works

1. **Share, paste, or upload** an article URL, text, file, or YouTube link (PDF/TXT/MD/EPUB/YouTube)
2. The app fetches the page through a CORS proxy, extracts readable content with [Readability.js](https://github.com/mozilla/readability), converts it to markdown, and renders a formatted reading view
3. Articles are added to a **queue** — play now or add to queue for later
4. Press **Play** — TTS reads the article aloud using your device's voices (Web Speech API for foreground, Google Translate TTS audio for background playback)
5. When an article finishes, the next one in the queue auto-advances after a countdown

The app runs mostly client-side. The Cloudflare Worker proxies article fetches, Google Translate TTS audio, text translation, and YouTube transcript extraction.

## Quick Start

### 1. Set up the Cloudflare Worker (CORS proxy)

The worker deploys via **Cloudflare Git integration** (not GitHub Actions). Connect this repo in Cloudflare so pushes to `main` that change `worker/**` trigger a redeploy.

#### Step-by-step: Choose a Proxy Secret

Pick any random string to use as a shared secret between the app and the worker. This prevents unauthorized use of your proxy. Example:

```sh
openssl rand -hex 32
```

#### Step-by-step: Configure Worker bindings in Cloudflare

In Cloudflare Worker settings:

1. Set `ALLOWED_ORIGIN` to `https://fabian20ro.github.io`
2. Add secret `PROXY_SECRET` (optional)

You can also set secrets with Wrangler:

```sh
cd worker
npx wrangler secret put PROXY_SECRET
```

#### Step-by-step: Set `PROXY_SECRET` for the client build (optional)

For GitHub Pages deployments, add repository secret `PROXY_SECRET` in:
`Settings -> Secrets and variables -> Actions`.

`deploy-pages.yml` injects this value into `src/app.ts` at CI build time.
For local/manual builds, set `CONFIG.PROXY_SECRET` directly in `src/app.ts` before running `npm run build`.
If Worker `PROXY_SECRET` is set but the client secret is missing/mismatched, proxy calls fail with HTTP 403.

> **Note:** `PROXY_SECRET` is visible in client-side JS. It prevents casual abuse, not determined attackers. If you don't need it, leave it empty in both app and worker.

### 2. Deploy to GitHub Pages

GitHub Actions handles this automatically. On every push to `main`:

1. Typecheck runs
2. Tests are run
3. `PROXY_SECRET` is injected into the client config when the GitHub secret is set
4. Vite builds `dist/`, emits `dist/sw.js`, and the built app shell is deployed to GitHub Pages

To enable: go to **Settings > Pages > Source** and select **GitHub Actions**.

The site will be available at `https://fabian20ro.github.io/pixel-article-reader/`.

### 3. Deploy the Cloudflare Worker

Cloudflare redeploys the worker automatically from Git when changes land in `worker/` on `main`.
No GitHub Action or GitHub Cloudflare API credentials are required for this path.
If Worker auth is enabled, keep `PROXY_SECRET` configured for Pages builds so the browser can send `X-Proxy-Key`.

The worker URL will be: `https://pixel-article-reader.fabian20ro.workers.dev`

#### Manual first deploy (alternative)

If you prefer to deploy manually the first time:

```sh
cd worker
npx wrangler deploy
npx wrangler secret put PROXY_SECRET
# paste your secret when prompted
```

### 4. Install the PWA

Open the live app on your phone (Chrome or Brave). Tap the install banner or use the browser menu to **Add to Home Screen**. Once installed, you can share articles directly from your browser to Article Local Reader.

## Usage

### Share Target (primary flow)

After installing the PWA, use your browser's **Share** menu on any article. Select **Article Local Reader** — the app opens, extracts the article, and is ready to play.

### Paste URL or Article Text

Open Article Local Reader directly and paste an article URL **or full article text** into the input field. Press **GO** or hit Enter. If no URL is detected at the end of the text, it will be treated as pasted article content and displayed directly.

### Local File Upload

Tap the file button to upload a local file. Supported formats: **PDF**, **TXT**, **Markdown (.md)**, and **EPUB**. The file content is parsed, stored locally in IndexedDB, and added to the queue.

### Article Queue

Articles are managed in a playlist-style queue:

- **Play Now / Add to Queue** — when a new article is loaded, a snackbar offers to play immediately or add to the end of the queue
- **Queue drawer** — tap the menu icon (top-left) to open the queue panel with all articles
- **Drag to reorder** — use the grip handle on each queue item to rearrange order
- **Delete** — remove individual articles from the queue (pasted and uploaded content is also cleaned from local storage)
- **Clear all** — remove all articles at once
- **Auto-advance** — when an article finishes, a countdown toast offers to play the next article or cancel

### Player Controls

| Control | Action |
|---------|--------|
| Play / Pause | Start or pause reading |
| Skip forward / back | Jump to next or previous paragraph |
| Speed buttons | Set reading speed (0.75x to 3x) |
| Sentence skip | Skip forward / back one sentence within a paragraph |
| Chapters | Navigate by heading (when the article has headings) |
| Translate | Translate extracted paragraphs via Worker + Google Translate API |
| Tap a paragraph | Jump to that paragraph and start reading |
| Progress bar | Click to seek to a position |
| Media notification | Lock-screen controls and seekbar on Android |

### Reading View Actions

- **Copy as Markdown** — copies normalized article markdown to clipboard

### Settings (gear icon)

- **Default Speed** — 0.5x to 3.0x
- **Preferred Language** — Auto (detected), English, or Romanian
- **Voice** — pick from available system voices, filtered by gender
- **Theme** — light or dark mode
- **Keep screen on** — uses Wake Lock API to prevent screen timeout during playback

Settings are persisted in `localStorage`. Queue metadata is stored in `localStorage`; content for local files and pasted text is stored in IndexedDB.

## PWA Recovery (stale install)

If the installed app is stuck on an older UI (for example, missing the **Check for Updates** button), run this cleanup flow.

### Desktop Chrome / Edge

1. Open `https://fabian20ro.github.io/pixel-article-reader/`
2. Open DevTools → **Application** → **Service Workers** → **Unregister**
3. DevTools → **Application** → **Storage** → **Clear site data**
4. Hard reload (`Cmd/Ctrl+Shift+R`)
5. Reinstall the PWA

### Android Chrome PWA

1. Long-press app icon → **App info**
2. **Storage & cache** → **Clear storage** and **Clear cache**
3. In Chrome site settings for `fabian20ro.github.io`, clear site data
4. Uninstall the home-screen app
5. Reopen the site in Chrome and install again

### Emergency Console Reset (desktop)

Run this in DevTools Console on the app page:

```js
(async () => {
  const regs = await navigator.serviceWorker.getRegistrations();
  await Promise.all(regs.map((r) => r.unregister()));
  const keys = await caches.keys();
  await Promise.all(keys.map((k) => caches.delete(k)));
  location.reload();
})();
```

## Development

### Prerequisites

- Node.js (for TypeScript compilation)

### Setup

```sh
npm install
```

### Build

```sh
npm run typecheck
npm test
npm run build
```

TypeScript source lives in `src/`. Production output is emitted to `dist/` by Vite. `scripts/update-precache.mjs` then renders `dist/sw.js` from the emitted asset list while keeping `sw.js` in the repo as the manual version source.

### Test

```sh
npm test
```

### CI/CD

| Workflow | Trigger | What it does |
|---|---|---|
| `ci.yml` | Push / PR | Runs typecheck, tests, and production build |
| `deploy-pages.yml` | Push to `main` | Injects release secrets, rebuilds `dist/`, deploys to GitHub Pages |

### Project Structure

```
├── index.html              # App shell template
├── style.css               # Global app styles
├── manifest.json           # PWA manifest source
├── sw.js                   # Service Worker template + manual SW_VERSION
├── dist/                   # Vite build output (generated)
├── src/                    # TypeScript source
├── worker/
│   ├── index.ts            # Cloudflare Worker
│   └── wrangler.toml       # Wrangler deployment config
├── .github/workflows/
│   ├── ci.yml              # Typecheck/test/build gate
│   └── deploy-pages.yml    # GitHub Pages deploy
├── icons/                  # PWA icons (192px, 512px)
├── tsconfig.json
├── tsconfig.worker.json
└── package.json
```

### Key Design Decisions

| Decision | Why |
|---|---|
| Web Speech API + Google Translate TTS | Web Speech API for free on-device voices (foreground). Google Translate TTS audio via `<audio>` element for background playback on Android (speechSynthesis is suspended when backgrounded). |
| Sentence-level chunking | Avoids Chrome Android's 15-second TTS cutoff bug. Each sentence is a separate `SpeechSynthesisUtterance`, chained via `onend`. |
| Cloudflare Worker proxy | Articles can't be fetched client-side due to CORS. CF free tier gives 100k req/day. Returns `X-Final-URL` header for redirect resolution. |
| Markdown intermediate format | Extraction output is normalized to markdown so the app can render rich content, keep TTS chunks deterministic, and support clipboard export. |
| Queue with IndexedDB | Queue metadata in localStorage, file/pasted content in IndexedDB. URL-based articles are re-fetched from network; local content is preserved because files can't be re-read after the picker closes. |
| Silent audio media session | A looping silent WAV keeps the PWA alive in background on Android Chrome and enables lock-screen media controls. |
| Mozilla Readability.js | Battle-tested article extraction — same engine as Firefox Reader View. |
| Vite build + generated SW | The app now ships as hashed `dist/assets/*` bundles. `sw.js` stays human-edited for `SW_VERSION`, then `scripts/update-precache.mjs` renders the final `dist/sw.js` from emitted assets. |
| GitHub Pages | Free HTTPS hosting (required for PWA + Share Target). |

### Language Detection

The app auto-detects English vs Romanian using character-based heuristics (Romanian diacritics: ă, â, î, ș, ț) and common Romanian word frequency. Users can manually override with the language toggle.

### Offline Support

After the first load, the Service Worker caches the app shell. Navigations use network-first with cache fallback, while same-origin static assets use stale-while-revalidate. The app itself loads offline; article fetching still requires network.

`sw.js` includes `SW_VERSION`. Bump it when release changes affect cache behavior or app-shell wiring.
