# Code Structure & Maintainability Analysis

**Date:** 2026-02-25
**Scope:** Full codebase analysis across architecture, security, code quality, and dead code
**Agents used:** Architect, Security Reviewer, Code Reviewer, Refactor Cleaner

---

## Codebase Overview

| File | Lines | Role |
|------|-------|------|
| `src/lib/extractor.ts` | 1204 | Content extraction (HTML, PDF, EPUB, text) |
| `src/app.ts` | 850 | Main orchestrator / UI wiring |
| `src/lib/tts-engine.ts` | 773 | Text-to-Speech engine |
| `src/lib/article-controller.ts` | 540 | Article rendering + management |
| `worker/cors-proxy.js` | 542 | Cloudflare Worker proxy |
| `src/lib/queue-controller.ts` | 354 | Queue management |
| `src/lib/media-session.ts` | 244 | Media Session API integration |
| `src/lib/translator.ts` | 207 | Translation support |
| `src/lib/dom-refs.ts` | 157 | DOM element references |
| `style.css` | 1144 | Styles |
| `index.html` | 286 | Single-page HTML |
| **Total** | **~7100** | |

---

## 1. Architecture Findings

### 1.1 [HIGH] `app.ts` is a God Function (850 lines)

The `main()` function spans lines 53–841 and mixes:
- Controller instantiation and callback wiring (~90 lines)
- Queue drawer open/close logic
- Settings drawer open/close logic
- Chapters bottom sheet logic (~75 lines)
- Queue list HTML rendering with imperative DOM construction (~100 lines)
- Drag-and-drop state machine for queue reordering (~120 lines)
- Voice gender detection heuristics
- PWA install prompt handling
- All settings control wiring (~60 lines)
- All player control wiring (~35 lines)
- UI update helper functions (~110 lines)

**Impact:** Adding any new feature means adding more code to this already-large function. The drag-and-drop and queue rendering are self-contained concerns that don't belong in the orchestrator.

**Recommendation:** Extract `renderQueueUI()` into `queue-renderer.ts`, the drag-and-drop state machine into `queue-drag.ts`, and drawer open/close into a shared `openDrawer(panel, overlay)` / `closeDrawer(panel, overlay)` utility.

### 1.2 [HIGH] Article Object Mutated In-Place Across Layers

**File:** `src/lib/article-controller.ts:337-338`

```typescript
article.paragraphs = ttsParagraphs;
article.textContent = ttsParagraphs.join('\n\n');
```

The `renderArticleBody()` method mutates the `article` object's `paragraphs` and `textContent` fields. The same reference may be held by the queue controller. Similarly, `translateCurrentArticle()` (lines 446-451) mutates five fields on the shared object.

**Impact:** Any code capturing an `Article` reference and reading it later may see stale or unexpectedly modified data. The current ordering works by accident.

**Recommendation:** Either make `Article` immutable (return new objects), or pass the `Article` directly as a parameter to `onArticleRendered(article, totalParagraphs)` instead of relying on temporal coupling with `getCurrentArticle()`.

### 1.3 [HIGH] Near-Duplicate Types: `Article` vs `StoredArticleContent`

**Files:** `src/lib/extractor.ts:68-81`, `src/lib/article-content-store.ts:8-21`

`Article` has 12 fields. `StoredArticleContent` has 11 — it's `Article` minus `content`/`resolvedUrl`, plus `id`. The manual mapping in `queue-controller.ts:335-348` hardcodes `content: ''` and casts `lang`. Adding a field to `Article` requires remembering to update three separate locations.

**Recommendation:** Define a shared `ArticleData` base type. Provide `toStorable(article, id)` / `fromStorable(stored)` mapper functions as the single source of truth.

### 1.4 [MEDIUM] QueueController Has Direct Dependency on ArticleController

**File:** `src/lib/queue-controller.ts:47`

`QueueController` holds a direct reference to `ArticleController` and calls `loadArticleFromUrl()` and `loadArticleFromStored()`. This creates tight coupling between two peer controllers.

**Recommendation:** `QueueController` should declare a loading callback interface that `app.ts` provides at construction time, inverting the dependency.

### 1.5 [MEDIUM] TTS Engine Carries Too Many Responsibilities (773 lines)

`TTSEngine` manages: two TTS backends (audio-fetch + speechSynthesis), audio elements, blob URL lifecycles, wake locks, media sessions, dead-man switches, generation counters, sentence splitting, and a resume watchdog.

**Impact:** Adding a third TTS backend would require threading conditional logic through 5+ methods.

**Recommendation:** Extract a strategy-pattern interface (`speak(text, lang)` / `pause()` / `resume()` / `cancel()`) for each backend.

### 1.6 [MEDIUM] `extractor.ts` at 1204 Lines Handling 5 Formats

Handles HTML, PDF, EPUB, plain text, and markdown. Each has its own extraction pipeline with lazy-loading.

**Recommendation:** Split into `extractor-html.ts`, `extractor-pdf.ts`, `extractor-epub.ts` with `extractor.ts` as a thin dispatcher.

### 1.7 [LOW] No Centralized Language Configuration

`Language = 'en' | 'ro'` is defined in `lang-detect.ts:11`. Adding a third language would require changes in 5+ files with no single configuration point.

### 1.8 [LOW] ArticleController Directly Manipulates DOM

Takes `AppDomRefs` and manipulates DOM elements throughout, making it untestable without a DOM. A cleaner boundary would emit events/data and let the caller handle DOM updates.

---

## 2. Security Findings

### 2.1 [HIGH] SSRF: DNS Rebinding and Redirect-Chained Private IP Bypass

**File:** `worker/cors-proxy.js:240-247`

The worker validates the URL hostname against a private-IP blocklist before fetch, but follows redirects with `redirect: 'follow'`. An attacker can bypass SSRF protection by:
1. Submit `https://attacker.com/redirect` — passes validation
2. Attacker's server responds with `301` to `http://169.254.169.254/latest/meta-data/`
3. Worker follows the redirect to the internal address

Also missing: IPv4-mapped IPv6 patterns (`::ffff:127.0.0.1`, etc.)

**Remediation:** Use `redirect: 'manual'`, validate redirect `Location` headers. Add `::ffff:` patterns to `PRIVATE_IP_PATTERNS`.

### 2.2 [HIGH] XSS: Sanitizer Misses `data:` URIs on `href`/`src`

**File:** `src/lib/article-controller.ts:525`

The sanitizer blocks `javascript:` but not `data:text/html,...` URIs. Also missing: `<base>`, `<form>`, `<meta>`, `<link>` elements not stripped.

**Remediation:** Extend blocked-protocol check: `/^(javascript|data|vbscript):/i`. Add `form, meta, link, base` to removed elements.

### 2.3 [HIGH] CDN Libraries Without Subresource Integrity

**File:** `src/lib/extractor.ts:50-52, 317-323`

`pdf.js` and `JSZip` are loaded from `cdn.jsdelivr.net` with no integrity check. A compromised CDN response would execute arbitrary code.

**Remediation:** Add `integrity` + `crossorigin="anonymous"` to JSZip injection. Vendor pdf.js locally.

### 2.4 [HIGH] No Content Security Policy

**File:** `index.html`

No `<meta http-equiv="Content-Security-Policy">` tag exists. No browser-enforced fallback if the sanitizer is bypassed.

**Remediation:** Add a restrictive CSP meta tag:
```html
<meta http-equiv="Content-Security-Policy" content="
  default-src 'self';
  script-src 'self' https://cdn.jsdelivr.net;
  style-src 'self' 'unsafe-inline';
  connect-src 'self' https://*.workers.dev https://translate.googleapis.com;
  media-src blob:;
  object-src 'none';
  base-uri 'none';
  frame-ancestors 'none';
">
```

### 2.5 [MEDIUM] CORS Wildcard Fallback When `ALLOWED_ORIGIN` Unset

**File:** `worker/cors-proxy.js:107`

Falls back to `'*'` if `ALLOWED_ORIGIN` binding is absent. A misconfigured deployment becomes a public open proxy.

**Remediation:** Fail closed — remove the `|| '*'` fallback.

### 2.6 [MEDIUM] In-Memory Rate Limiter Not Distributed

**File:** `worker/cors-proxy.js:29-32`

Rate limit counters are per-isolate, not global across Cloudflare PoPs.

**Remediation:** Use Cloudflare's native rate limiting or KV-based counters.

### 2.7 [MEDIUM] Jina URL Built Without `encodeURIComponent`

**File:** `worker/cors-proxy.js:329`

Path/header injection risk when building `https://r.jina.ai/${targetUrl}`.

**Remediation:** Use `encodeURIComponent(targetUrl)`.

### 2.8 [LOW] Blob URLs Not Revoked (Memory Leak)

**File:** `src/lib/tts-audio-fetcher.ts:42`

`URL.createObjectURL(blob)` returns blob URLs that are never revoked, causing slow memory leaks in long sessions.

---

## 3. Dead Code & Cleanup Findings

### SAFE to Remove

| # | Item | File | Lines |
|---|------|------|-------|
| 1 | `notifyPause()`, `notifyResume()` — dead methods | `media-session.ts` | 123–134 |
| 2 | `private pitch = 1.0` — never settable | `tts-engine.ts` | 167 |
| 3 | `PwaUpdateActionResult` — exported, never imported | `pwa-update-manager.ts` | 8 |
| 4 | `moveUp()`, `moveDown()` — never called | `queue-controller.ts` | 153–168 |
| 5 | `playPrevious()` — never called | `queue-controller.ts` | 232–252 |
| 6 | `hasPrevious()` — only used by dead `playPrevious()` | `queue-controller.ts` | 81–83 |
| 7 | `.text-secondary` class in HTML, no CSS rule | `index.html:67` | — |
| 8 | `.handle-bar` always `display: none` | `style.css:863–870` | — |
| 9 | `persistSettings()` — single-line passthrough | `app.ts` | 748–750 |

### CAREFUL — Likely Unused Feature Scaffolding

| # | Item | File | Lines |
|---|------|------|-------|
| 10 | `snackbarTitle` DOM ref — wired, never written to | `dom-refs.ts:60` | — |
| 11 | Entire `addQueueSnackbar` flow — never activated | `app.ts` | 212–229 |
| 12 | `FETCH_TIMEOUT` bypassed in main HTML fetch (uses `PDF_FETCH_TIMEOUT` instead) | `extractor.ts` | 86, 565 |

### Consolidation Opportunities

| # | Item | Files | Impact |
|---|------|-------|--------|
| 13 | Duplicate `splitSentences` — two independent implementations | `tts-engine.ts:70`, `extractor.ts:1119` | Divergent behavior |
| 14 | Inline proxy header construction repeated 3x | `extractor.ts:559,651,868` | Could share `translator.ts`'s helper |
| 15 | Image-stripping regex duplicated 3x across 2 files | `extractor.ts`, `article-controller.ts` | Extract to shared constants |
| 16 | Duplicate voice filter in `populateVoices`/`applyVoiceGender` | `app.ts:755,793` | Cache filtered list |
| 17 | Three near-identical drawer open/close pairs (~45 lines) | `app.ts:158–512` | Extract `openDrawer(panel, overlay)` |

---

## 4. Code Quality Observations

### Positive Patterns

- **Zero `any` types** across the entire TypeScript source
- **Exactly one `console.error`** in the entire client (`app.ts:849`), used only for fatal init failure
- **No empty catch blocks** — all catches either handle errors or are intentional fire-and-forget (`.catch(() => {})` on audio `.play()` and wake lock `.release()`, which are correct patterns)
- **Good error handling pattern** — consistent `err instanceof Error ? err.message : 'fallback'` across all catch blocks
- **Clean dependency graph** — acyclic, top-down, no circular dependencies
- **Clean store APIs** — `settings-store`, `queue-store`, `article-content-store` are stateless pure-function modules
- **`npm audit` clean** — 0 vulnerabilities

### Areas for Improvement

- **Large functions** — `main()` in app.ts (790 lines), `parsePdfFromArrayBuffer()` in extractor.ts (102 lines, 4 distinct phases mixed), `renderArticleBody()` in article-controller.ts (85 lines, 5-level nesting), `parseArticleFromHtml()` in extractor.ts (74 lines, multi-branch parse path)
- **Paragraph filter duplication** — the chain `.map(stripNonTextContent).filter(p => p.length >= MIN_PARAGRAPH_LENGTH).filter(isSpeakableText)` appears in 4 separate locations in extractor.ts (lines 296, 722, 1040, 1056). A single `filterReadableParagraphs()` helper would eliminate this.
- **Inline `import()` type cast** — `queue-controller.ts:341` uses `as import('./lang-detect.js').Language` instead of a top-level type import. Add `import type { Language } from './lang-detect.js'`.
- **Magic numbers** — WAV header offsets in media-session.ts (documented inline), queue badge cap at 99, auto-advance delay of 2000ms (extracted to constant), max queue size of 50 (extracted to constant)
- **Silent `.catch(() => {})` patterns** — 7 occurrences across tts-engine.ts and media-session.ts for audio `.play()` and wake lock `.release()`. These are intentionally silenced (browser APIs that throw when not ready), but a comment on each explaining why would improve maintainability.

---

## Priority Matrix

### Must Fix (Structural Risk)

1. Add Content Security Policy to `index.html`
2. Fix SSRF redirect-following in worker (use `redirect: 'manual'`)
3. Extend HTML sanitizer to block `data:` URIs, `<form>`, `<meta>`, `<base>`
4. Add SRI to CDN-loaded scripts (JSZip) or vendor them locally

### Should Fix (Maintainability)

5. Extract queue rendering and drag-and-drop from `app.ts` (~220 lines)
6. Unify `Article` / `StoredArticleContent` types with a shared base
7. Stop mutating `Article` in-place — return new objects or use explicit mapping
8. Remove confirmed dead code (9 items, ~80 lines)
9. Consolidate duplicate `splitSentences` implementations
10. Extract shared image-stripping regex constants
11. Extract `filterReadableParagraphs()` helper (duplicated 4x in extractor.ts)
12. Extract `parsePdfFromArrayBuffer` into phases (102-line function)

### Nice to Have (Long-term)

13. Split `extractor.ts` into per-format extractors
14. Extract TTS backend into strategy pattern
15. Centralize language configuration
16. Decouple ArticleController from DOM
17. Extract drawer open/close utility
18. Vendor pdf.js locally to eliminate CDN dependency for sensitive code path
