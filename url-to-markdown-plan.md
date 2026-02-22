# Plan: URL Content to Markdown — Better Reading & Export

## Context

ArticleVoice currently fetches article HTML via a CORS proxy, parses it with Readability.js to extract clean HTML/text, then renders plain text paragraphs for TTS playback. The visual reading experience is basic — unstyled plain text with no formatting (headings, bold, lists, links, images are all stripped). The user wants:

1. **Better visual reading view** — render formatted article content (headings, bold/italic, lists, links, images)
2. **Markdown as intermediate format** — clean, normalized content that can be copied/exported
3. **Improved extraction quality** — add Jina Reader as an on-demand alternative for URLs where Readability struggles

All libraries must be permissively licensed (MIT/Apache 2.0). No AGPL.

---

## Architecture

```
URL input
  │
  ├─ Default path (always):
  │    CF Worker → fetch HTML → browser Readability.js → Turndown → markdown
  │
  └─ "Try with Jina" button (on demand):
  │    CF Worker (mode=markdown) → Jina Reader API (key stored in CF secrets) → markdown
  │
  ▼
markdown
  ├─→ marked.js → formatted HTML (visual reading view)
  ├─→ split on blank lines → plain text paragraphs (TTS)
  └─→ clipboard copy (export)
```

**Jina API Key Security**: Stored as `JINA_KEY` Cloudflare Worker secret (via `wrangler secret put JINA_KEY`). The browser never sees the key — it calls the CF Worker with `mode=markdown`, and the Worker attaches `Authorization: Bearer <JINA_KEY>` to the Jina request server-side. Same pattern as existing `PROXY_SECRET`.

---

## Steps

### Step 1: Vendor Turndown.js and marked.js

**New file: `vendor/turndown.js`** — Download browser dist from unpkg (MIT license)
**New file: `vendor/marked.js`** — Download browser dist from jsdelivr (MIT license)

Both loaded as `<script>` tags in `index.html` (same pattern as existing `vendor/Readability.js`).

**File: `index.html`** — Add script tags:
```html
<script src="vendor/Readability.js"></script>
<script src="vendor/turndown.js"></script>
<script src="vendor/marked.js"></script>
<script type="module" src="app.js"></script>
```

**File: `sw.js`** — Add both vendor files to cache list.

### Step 2: Add `mode=markdown` Jina proxy path in CF Worker

**File: `worker/cors-proxy.js`**

When `GET /?url=<URL>&mode=markdown`:
1. Read `JINA_KEY` from `env` (Cloudflare secret)
2. Fetch `https://r.jina.ai/<URL>` with headers:
   - `Authorization: Bearer ${env.JINA_KEY}` (if key exists; works without key too, just lower rate limits)
   - `Accept: text/markdown`
3. Return markdown response with `Content-Type: text/markdown; charset=utf-8`
4. Still apply: rate limiting, SSRF check on original URL, size limits, CORS headers
5. Return `X-Final-URL` from Jina response if available

When `mode` is omitted → existing HTML fetch behavior (unchanged).

### Step 3: Update Article interface and extractor

**File: `src/lib/extractor.ts`**

Add to `Article` interface:
```typescript
markdown: string;  // markdown content for display and export
```

Add TypeScript declarations for globals:
```typescript
declare const TurndownService: new (options?: object) => {
  turndown(html: string): string;
};
```

Update `parseArticle()`:
- After Readability extracts clean HTML, run it through Turndown to produce markdown
- Store in `article.markdown`

Add new function:
```typescript
export async function extractArticleWithJina(
  url: string, proxyBase: string, proxySecret?: string
): Promise<Article>
```
- Calls `proxyBase?url=<URL>&mode=markdown`
- Parses the returned markdown:
  - Title: first `# heading` or first line
  - Paragraphs: split on `\n\n`, strip markdown syntax for TTS plain text
  - Word count, estimated minutes from plain text
  - Language detection on plain text
- Falls back to `extractArticle()` on any error

Update `createArticleFromText()`:
- Set `markdown` to the plain text (no conversion needed for pasted text)

### Step 4: Update `displayArticle()` for rendered markdown

**File: `src/app.ts`**

Add declaration for marked.js:
```typescript
declare const marked: { parse(md: string): string };
```

Modify `displayArticle()`:

```typescript
function displayArticle(article: Article): void {
  // ... existing title/info/translate logic unchanged ...

  // Render markdown as formatted HTML
  if (article.markdown) {
    articleText.innerHTML = sanitize(marked.parse(article.markdown));
    // Tag each top-level block element as a "paragraph" for highlighting
    const blocks = articleText.querySelectorAll(
      ':scope > h1, :scope > h2, :scope > h3, :scope > h4, :scope > h5, :scope > h6, ' +
      ':scope > p, :scope > ul, :scope > ol, :scope > blockquote, :scope > pre, ' +
      ':scope > hr, :scope > figure'
    );
    blocks.forEach((el, i) => {
      el.classList.add('paragraph');
      el.dataset.index = String(i);
      el.addEventListener('click', () => {
        tts.jumpToParagraph(i);
        if (!tts.state.isPlaying) tts.play();
      });
    });
  } else {
    // Fallback: plain text rendering (for pasted text with no markdown)
    article.paragraphs.forEach((p, i) => {
      const div = document.createElement('div');
      div.className = 'paragraph';
      div.textContent = p;
      div.dataset.index = String(i);
      div.addEventListener('click', () => {
        tts.jumpToParagraph(i);
        if (!tts.state.isPlaying) tts.play();
      });
      articleText.appendChild(div);
    });
  }

  // ... rest unchanged (TTS load, show view, etc.) ...
}
```

Note: `sanitize()` is a simple function that strips `<script>`, `onclick`, `onerror`, etc. from the HTML output. Marked.js already doesn't execute scripts, but belt-and-suspenders.

**TTS paragraph alignment**: The `article.paragraphs` array (used for TTS) and the rendered block elements need to align 1:1 for paragraph highlighting to work. The paragraph extraction from markdown (split on `\n\n`) will be designed to match the block elements marked.js produces.

### Step 5: Add "Try with Jina Reader" button

**File: `index.html`**

Add in the `article-meta` div:
```html
<button id="jina-retry-btn" class="translate-link hidden">Try with Jina Reader</button>
```

**File: `src/app.ts`**

Wire up:
```typescript
jinaRetryBtn.addEventListener('click', async () => {
  if (!currentArticleUrl) return;
  jinaRetryBtn.disabled = true;
  jinaRetryBtn.textContent = 'Re-parsing...';
  try {
    const article = await extractArticleWithJina(
      currentArticleUrl, CONFIG.PROXY_BASE, CONFIG.PROXY_SECRET
    );
    currentArticle = article;
    displayArticle(article);
  } catch (err) {
    showError(err instanceof Error ? err.message : 'Jina extraction failed.');
  }
});
```

Show the button whenever a URL-based article is displayed (not for pasted text).

### Step 6: Add "Copy as Markdown" button

**File: `index.html`**

Add in the `article-meta` div:
```html
<button id="copy-md-btn" class="translate-link hidden">Copy as Markdown</button>
```

**File: `src/app.ts`**

```typescript
copyMdBtn.addEventListener('click', async () => {
  if (!currentArticle?.markdown) return;
  await navigator.clipboard.writeText(currentArticle.markdown);
  copyMdBtn.textContent = 'Copied!';
  setTimeout(() => { copyMdBtn.textContent = 'Copy as Markdown'; }, 2000);
});
```

Show the button when article has markdown content.

### Step 7: Add markdown content styles

**File: `style.css`**

Add styles for rendered markdown inside `.article-text`:

```css
/* Markdown rendered content */
.article-text h1, .article-text h2, .article-text h3,
.article-text h4, .article-text h5, .article-text h6 {
  color: var(--text-primary);
  margin-top: 1.2em;
  margin-bottom: 0.5em;
  line-height: 1.3;
}
.article-text h2 { font-size: 1.3em; }
.article-text h3 { font-size: 1.15em; }
.article-text a { color: var(--accent); text-decoration: underline; }
.article-text img { max-width: 100%; border-radius: var(--radius-sm); margin: 8px 0; }
.article-text blockquote {
  border-left: 3px solid var(--accent);
  padding-left: 12px;
  color: var(--text-secondary);
  margin: 8px 0;
}
.article-text code {
  background: var(--bg-card);
  padding: 2px 6px;
  border-radius: 3px;
  font-size: 0.9em;
}
.article-text pre {
  background: var(--bg-card);
  padding: 12px;
  border-radius: var(--radius-sm);
  overflow-x: auto;
}
.article-text ul, .article-text ol { padding-left: 24px; margin: 8px 0; }
.article-text li { margin-bottom: 4px; }
.article-text hr { border: none; border-top: 1px solid var(--border); margin: 16px 0; }

/* Paragraph highlighting still works on any block element with .paragraph class */
.article-text .paragraph.active { color: var(--text-primary); background: var(--bg-card); }
.article-text .paragraph.past { color: var(--text-secondary); }
```

### Step 8: Update tests

**File: `src/__tests__/extractor.test.ts`**
- Test that `parseArticle()` now produces `markdown` field via Turndown
- Test `extractArticleWithJina()` with mocked fetch
- Test fallback: when Jina call fails, falls back to Readability path
- Test paragraph extraction from markdown produces reasonable TTS chunks

### Step 9: Build and verify

1. `npm run build` — no TypeScript errors
2. `npm test` — all pass
3. Manual: paste URL → see formatted article with headings, links, images
4. Manual: click "Copy as Markdown" → verify clean markdown in clipboard
5. Manual: click "Try with Jina Reader" → verify re-renders with Jina content
6. Manual: TTS playback → paragraphs highlight correctly, speech works
7. Manual: paste raw text → still works as before (plain text mode)

---

## Files changed

| File | Change type |
|------|-------------|
| `vendor/turndown.js` | New (vendored, MIT) |
| `vendor/marked.js` | New (vendored, MIT) |
| `worker/cors-proxy.js` | Modified — add `mode=markdown` Jina path |
| `src/lib/extractor.ts` | Modified — add `markdown` field, `extractArticleWithJina()`, Turndown integration |
| `src/app.ts` | Modified — render markdown HTML, add copy/Jina buttons |
| `index.html` | Modified — add script tags, add buttons |
| `style.css` | Modified — add markdown content styles |
| `sw.js` | Modified — cache new vendor files |
| `src/__tests__/extractor.test.ts` | Modified — test markdown extraction |
