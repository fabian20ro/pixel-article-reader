# ArticleVoice

**Live app: https://fabian20ro.github.io/pixel-article-reader/**

PWA that turns any article into audio using on-device TTS. It now renders extracted content as formatted markdown (headings, links, lists, code blocks) and supports markdown export.

## How It Works

1. **Share or paste** an article URL
2. ArticleVoice fetches the page through a CORS proxy, extracts readable content with [Readability.js](https://github.com/mozilla/readability), converts it to markdown, and renders a formatted reading view
3. Press **Play** — the Web Speech API reads the article aloud using your device's built-in voices
4. Optionally retry parsing with **Jina Reader** and copy the article as markdown

The entire app runs client-side. The only server component is a lightweight Cloudflare Worker that proxies article fetches (and optional Jina markdown fetches) to avoid CORS restrictions.

## Quick Start

### 1. Set up the Cloudflare Worker (CORS proxy)

The worker deploys automatically via GitHub Actions when you push changes to `worker/`. Configure the required secrets first.

#### Step-by-step: Create a Cloudflare API Token

1. Sign up for a free account at [dash.cloudflare.com](https://dash.cloudflare.com)
2. Go to **My Profile > API Tokens > Create Token**
3. Use the **"Edit Cloudflare Workers"** template, or create a custom token with:
   - **Account / Workers Scripts**: Edit
   - **Zone / Zone**: Read (optional, only if using a custom domain)
4. Copy the generated token — you'll need it for GitHub

#### Step-by-step: Find your Cloudflare Account ID

1. Go to the [Cloudflare dashboard](https://dash.cloudflare.com)
2. Click any domain (or Workers & Pages)
3. Your **Account ID** is shown on the right sidebar under the API section
4. Copy it

#### Step-by-step: Choose a Proxy Secret

Pick any random string to use as a shared secret between the app and the worker. This prevents unauthorized use of your proxy. Example:

```sh
openssl rand -hex 32
```

#### Step-by-step: Add secrets to GitHub

Go to your repo **Settings > Secrets and variables > Actions > New repository secret** and add:

| Secret name | Value |
|---|---|
| `CLOUDFLARE_API_TOKEN` | The API token from step 1 |
| `CLOUDFLARE_ACCOUNT_ID` | Your Account ID from step 2 |
| `PROXY_SECRET` | The random string from step 3 |
| `JINA_KEY` | Optional Jina Reader API key for higher markdown-mode limits |

#### Step-by-step: Set the proxy secret in the app

In `src/app.ts`, set `CONFIG.PROXY_SECRET` to the same value you used for `PROXY_SECRET` above:

```ts
const CONFIG = {
  PROXY_BASE: 'https://article-voice-proxy.fabian20ro.workers.dev',
  PROXY_SECRET: 'your-secret-here',
  // ...
};
```

Then rebuild: `npm run build`

> **Note:** `PROXY_SECRET` is visible in client-side JS. It prevents casual abuse, not determined attackers. If you don't need it, leave it empty in both app and worker.

### 2. Deploy to GitHub Pages

GitHub Actions handles this automatically. On every push to `main`:

1. TypeScript is compiled
2. Tests are run
3. The app shell is deployed to GitHub Pages

To enable: go to **Settings > Pages > Source** and select **GitHub Actions**.

The site will be available at `https://fabian20ro.github.io/pixel-article-reader/`.

### 3. Deploy the Cloudflare Worker

The worker deploys automatically on push to `main` when any file in `worker/` changes. The GitHub Action uses `wrangler` with your `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` secrets.

To trigger the first deploy, push any change to `worker/` (or push after setting up the secrets).

The worker URL will be: `https://article-voice-proxy.fabian20ro.workers.dev`

#### Manual first deploy (alternative)

If you prefer to deploy manually the first time:

```sh
cd worker
npx wrangler deploy
npx wrangler secret put PROXY_SECRET
npx wrangler secret put JINA_KEY   # optional
# paste your secret when prompted
```

### 4. Install the PWA

Open the live app on your phone (Chrome or Brave). Tap the install banner or use the browser menu to **Add to Home Screen**. Once installed, you can share articles directly from your browser to ArticleVoice.

## Usage

### Share Target (primary flow)

After installing the PWA, use your browser's **Share** menu on any article. Select **ArticleVoice** — the app opens, extracts the article, and is ready to play.

### Paste URL or Article Text

Open ArticleVoice directly and paste an article URL **or full article text** into the input field. Press **GO** or hit Enter. If no URL is detected at the end of the text, it will be treated as pasted article content and displayed directly.

### Player Controls

| Control | Action |
|---------|--------|
| Play / Pause | Start or pause reading |
| Skip forward / back | Jump to next or previous paragraph |
| Speed buttons | Set reading speed (0.75x to 2x) |
| Language toggle | Switch between Auto, EN, and RO |
| Sentence skip | Skip forward / back one sentence within a paragraph |
| Translate | Translate extracted paragraphs via Worker + Google Translate API |
| Tap a paragraph | Jump to that paragraph and start reading |
| Progress bar | Click to seek to a position |

### Reading View Actions

- **Try with Jina Reader** — re-fetches the same URL via Worker `mode=markdown` using Jina Reader and re-renders
- **Copy as Markdown** — copies normalized article markdown to clipboard

### Settings (gear icon)

- **Default Speed** — slider from 0.5x to 3.0x
- **Preferred Language** — Auto (detected), English, or Romanian
- **Voice** — pick from available system voices
- **Keep screen on** — uses Wake Lock API to prevent screen timeout during playback

Settings are persisted in `localStorage`.

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
npm run build    # compile TypeScript once
npm run watch    # compile on file changes
```

TypeScript source lives in `src/`. Compiled JS output goes to the project root (`app.js`, `lib/*.js`) and is generated during build/deploy (not tracked in git).

### Test

```sh
npm test
```

### CI/CD

| Workflow | Trigger | What it does |
|---|---|---|
| `deploy-pages.yml` | Push to `main` | Builds TS, runs tests, deploys to GitHub Pages |
| `deploy-worker.yml` | Push to `main` changing `worker/**` | Deploys Cloudflare Worker via wrangler |

### Project Structure

```
├── index.html              # App shell
├── style.css               # Mobile-first dark theme
├── manifest.json           # PWA manifest with Share Target
├── sw.js                   # Service Worker (network-first nav + stale-while-revalidate assets)
├── app.js                  # Generated at build time (gitignored)
├── lib/                    # Generated JS at build time (gitignored)
│   ├── url-utils.js
│   ├── lang-detect.js
│   ├── extractor.js
│   ├── translator.js
│   ├── settings-store.js
│   ├── dom-refs.js
│   ├── pwa-update-manager.js
│   ├── article-controller.js
│   ├── release.js
│   └── tts-engine.js
├── src/                    # TypeScript source
│   ├── app.ts
│   └── lib/
│       ├── url-utils.ts
│       ├── lang-detect.ts
│       ├── extractor.ts
│       ├── translator.ts
│       ├── settings-store.ts
│       ├── dom-refs.ts
│       ├── pwa-update-manager.ts
│       ├── article-controller.ts
│       ├── release.ts
│       └── tts-engine.ts
├── vendor/
│   ├── Readability.js      # Mozilla Readability (vendored)
│   ├── turndown.js         # Markdown conversion adapter (global TurndownService)
│   └── marked.js           # Markdown renderer adapter (global marked.parse)
├── worker/
│   ├── cors-proxy.js       # Cloudflare Worker CORS proxy
│   └── wrangler.toml       # Wrangler deployment config
├── .github/workflows/
│   ├── deploy-pages.yml    # GitHub Pages CI/CD
│   └── deploy-worker.yml   # Cloudflare Worker CI/CD
├── icons/                  # PWA icons (192px, 512px)
├── tsconfig.json
└── package.json
```

### Key Design Decisions

| Decision | Why |
|---|---|
| Web Speech API | Free, zero-network, on-device voices. No server needed for audio. |
| Sentence-level chunking | Avoids Chrome Android's 15-second TTS cutoff bug. Each sentence is a separate `SpeechSynthesisUtterance`, chained via `onend`. |
| Cloudflare Worker proxy | Articles can't be fetched client-side due to CORS. CF free tier gives 100k req/day. Returns `X-Final-URL` header for redirect resolution. |
| Markdown intermediate format | Extraction output is normalized to markdown so the app can render rich content, keep TTS chunks deterministic, and support clipboard export. |
| Jina fallback mode | On-demand retry path for sites where Readability performs poorly; key is kept server-side in Worker `JINA_KEY`. |
| Mozilla Readability.js | Battle-tested article extraction — same engine as Firefox Reader View. |
| No bundler | Vanilla TypeScript compiled with `tsc`. ES modules loaded directly by the browser. Keeps deployment simple — just static files. |
| GitHub Pages | Free HTTPS hosting (required for PWA + Share Target). |

### Language Detection

The app auto-detects English vs Romanian using character-based heuristics (Romanian diacritics: ă, â, î, ș, ț) and common Romanian word frequency. Users can manually override with the language toggle.

### Offline Support

After the first load, the Service Worker caches the app shell. Navigations use network-first with cache fallback, while same-origin static assets use stale-while-revalidate. The app itself loads offline; article fetching still requires network.

`sw.js` includes `SW_VERSION`. Bump it when release changes affect cache behavior or app-shell wiring.
