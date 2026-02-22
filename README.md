# ArticleVoice

PWA that turns any article into audio using on-device TTS. Zero cost. Works offline after first load.

## How It Works

1. **Share or paste** an article URL
2. ArticleVoice fetches the page through a CORS proxy, extracts the readable content with [Readability.js](https://github.com/mozilla/readability), and displays it
3. Press **Play** — the Web Speech API reads the article aloud using your device's built-in voices
4. Control playback with skip, speed, and language controls

The entire app runs client-side. The only server component is a lightweight Cloudflare Worker that proxies article fetches to avoid CORS restrictions.

## Quick Start

### 1. Deploy the CORS proxy

Create a free [Cloudflare Workers](https://workers.cloudflare.com/) account, then deploy `worker/cors-proxy.js`:

1. Go to **Workers & Pages > Create Worker**
2. Paste the contents of `worker/cors-proxy.js`
3. Deploy and note the URL (e.g. `https://article-voice-proxy.your-subdomain.workers.dev`)

### 2. Configure the proxy URL

In `src/app.ts`, update the `PROXY_BASE` constant:

```ts
const CONFIG = {
  PROXY_BASE: 'https://article-voice-proxy.your-subdomain.workers.dev',
  // ...
};
```

Then rebuild:

```sh
npm run build
```

### 3. Deploy to GitHub Pages

Push the repo to GitHub, then go to **Settings > Pages** and set the source to the `main` branch root (`/`). The site will be available at `https://<username>.github.io/<repo>/`.

### 4. Install the PWA

Open the deployed site on your phone (Chrome or Brave). Tap the install banner or use the browser menu to **Add to Home Screen**. Once installed, you can share articles directly from your browser to ArticleVoice.

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
│   └── cors-proxy.js       # Cloudflare Worker CORS proxy
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
