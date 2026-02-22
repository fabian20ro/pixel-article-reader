# ArticleVoice

**Live app: https://fabian20ro.github.io/pixel-article-reader/**

PWA that turns any article into audio using on-device TTS. Zero cost. Works offline after first load.

## How It Works

1. **Share or paste** an article URL
2. ArticleVoice fetches the page through a CORS proxy, extracts the readable content with [Readability.js](https://github.com/mozilla/readability), and displays it
3. Press **Play** — the Web Speech API reads the article aloud using your device's built-in voices
4. Control playback with skip, speed, and language controls

The entire app runs client-side. The only server component is a lightweight Cloudflare Worker that proxies article fetches to avoid CORS restrictions.

## Quick Start

### 1. Set up the Cloudflare Worker (CORS proxy)

The worker deploys automatically via GitHub Actions when you push changes to `worker/`. You need to configure three repository secrets first.

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

> **Note:** The secret is visible in the client-side JS. Its purpose is to prevent casual abuse of the proxy, not to be cryptographically secure. If you don't need this, leave `PROXY_SECRET` empty in both the worker and the app — the worker will skip validation.

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
# paste your secret when prompted
```

### 4. Install the PWA

Open the live app on your phone (Chrome or Brave). Tap the install banner or use the browser menu to **Add to Home Screen**. Once installed, you can share articles directly from your browser to ArticleVoice.

## Usage

### Share Target (primary flow)

After installing the PWA, use your browser's **Share** menu on any article. Select **ArticleVoice** — the app opens, extracts the article, and is ready to play.

### Paste URL

Open ArticleVoice directly and paste an article URL into the input field. Press **GO** or hit Enter.

### Player Controls

| Control | Action |
|---------|--------|
| Play / Pause | Start or pause reading |
| Skip forward / back | Jump to next or previous paragraph |
| Speed buttons | Set reading speed (0.75x to 2x) |
| Language toggle | Switch between Auto, EN, and RO |
| Tap a paragraph | Jump to that paragraph and start reading |
| Progress bar | Click to seek to a position |

### Settings (gear icon)

- **Default Speed** — slider from 0.5x to 3.0x
- **Preferred Language** — Auto (detected), English, or Romanian
- **Voice** — pick from available system voices
- **Keep screen on** — uses Wake Lock API to prevent screen timeout during playback

Settings are persisted in `localStorage`.

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

TypeScript source lives in `src/`. Compiled JS output goes to the project root (`app.js`, `lib/*.js`), matching the file structure that `index.html` expects.

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
├── sw.js                   # Service Worker (cache-first)
├── app.js                  # Compiled main orchestrator
├── lib/                    # Compiled library modules
│   ├── url-utils.js
│   ├── lang-detect.js
│   ├── extractor.js
│   └── tts-engine.js
├── src/                    # TypeScript source
│   ├── app.ts
│   └── lib/
│       ├── url-utils.ts
│       ├── lang-detect.ts
│       ├── extractor.ts
│       └── tts-engine.ts
├── vendor/
│   └── Readability.js      # Mozilla Readability (vendored)
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
| Cloudflare Worker proxy | Articles can't be fetched client-side due to CORS. CF free tier gives 100k req/day. |
| Mozilla Readability.js | Battle-tested article extraction — same engine as Firefox Reader View. |
| No bundler | Vanilla TypeScript compiled with `tsc`. ES modules loaded directly by the browser. Keeps deployment simple — just static files. |
| GitHub Pages | Free HTTPS hosting (required for PWA + Share Target). |

### Language Detection

The app auto-detects English vs Romanian using character-based heuristics (Romanian diacritics: ă, â, î, ș, ț) and common Romanian word frequency. Users can manually override with the language toggle.

### Offline Support

After the first load, the Service Worker caches the entire app shell. The app itself loads offline — only article fetching requires a network connection.
