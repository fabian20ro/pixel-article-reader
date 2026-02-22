# Lessons Learned

> This file is maintained by AI agents working on this project.
> It captures validated, reusable insights discovered during development.
> **Read this file at the start of every task. Update it at the end of every iteration.**

## How to Use This File

### Reading (Start of Every Task)
Before starting any work, read this file to avoid repeating known mistakes and to leverage proven approaches.

### Writing (End of Every Iteration)
After completing a task or iteration, evaluate whether any new insight was gained that would be valuable for future sessions. If yes, add it to the appropriate category below.

### Promotion from Iteration Log
Patterns that appear 2+ times in `ITERATION_LOG.md` should be promoted here as a validated lesson.

### Pruning
If a lesson becomes obsolete (e.g., a dependency was removed, an API changed), move it to the Archive section at the bottom with a date and reason.

---

## Architecture & Design Decisions

**[2026-02-22]** TypeScript outDir overlaps with source root — `tsconfig.json` uses `outDir: "."` and `rootDir: "src"`, so compiled JS lands at the project root (e.g. `src/app.ts` → `./app.js`). This means the root-level `.js` files are generated artifacts. Never edit them directly — always edit the TypeScript source in `src/` and run `npm run build`.

**[2026-02-22]** Exclude test files from tsc build — Tests in `src/__tests__/` must be listed in `tsconfig.json`'s `exclude` array, otherwise `tsc` compiles them into a `__tests__/` directory at the project root, polluting the deployable output. Vitest has its own TypeScript handling and doesn't need `tsc` to compile tests.

**[2026-02-22]** Service Worker must stay plain JS — `sw.js` runs in a ServiceWorker scope (no DOM, different globals). Keeping it as plain JS avoids needing a separate `tsconfig` for the SW context and keeps the file directly deployable without compilation.

## Code Patterns & Pitfalls

**[2026-02-22]** Import paths must end in `.js` even in TypeScript source — Since the browser loads ES modules directly (no bundler), TypeScript `import` statements must use `.js` extensions (e.g. `import { foo } from './lib/bar.js'`). The `tsc` compiler preserves these extensions as-is in the output. Forgetting `.js` will cause runtime `ERR_MODULE_NOT_FOUND` in the browser.

**[2026-02-22]** Readability.js is a global, not an ES module — The vendored `Readability.js` declares a global `function Readability(...)` and uses `module.exports` behind a `typeof module` guard. It's loaded via a plain `<script>` tag. In TypeScript, access it with `declare const Readability` (ambient declaration in `extractor.ts`). Don't try to `import` it — it won't work as an ES module.

## Testing & Quality

**[2026-02-22]** Test data must match actual code behavior, not assumed behavior — When writing the extractor test for "single-newline fallback", the test assumed the fallback path would be triggered, but the code's double-newline split actually succeeds with a single large paragraph. Always trace through the actual splitting logic before asserting paragraph counts.

**[2026-02-22]** Mock SpeechSynthesis carefully — The TTS engine tests require mocking both `speechSynthesis` (the global singleton) and `SpeechSynthesisUtterance` (the constructor). Set them on `globalThis` in `beforeEach` and restore in `afterEach`. The mock `speak()` should call `onend` via `setTimeout` to simulate the async callback chain. Use `vi.useFakeTimers()` for tests that involve the resume watchdog timer.

## Performance & Infrastructure

<!-- Insights about deployment, CI/CD, build performance -->

## Dependencies & External Services

**[2026-02-22]** Vendored Readability.js comes from `mozilla/readability` main branch — Downloaded from `https://raw.githubusercontent.com/mozilla/readability/main/Readability.js`. It's ~2800 lines. When updating, verify the export format hasn't changed (must still declare global `function Readability` and use `module.exports` guard).

## Process & Workflow

**[2026-02-22]** Build before committing — Since compiled JS files are committed (needed for GitHub Pages deployment), always run `npm run build` after editing TypeScript source and before committing. Stale `.js` files that don't match the `.ts` source will cause confusing runtime behavior.

---

## Archive

<!-- Lessons that are no longer applicable. Keep for historical context. -->
<!-- Format: **[YYYY-MM-DD] Archived [YYYY-MM-DD]** Title — Reason for archival -->
