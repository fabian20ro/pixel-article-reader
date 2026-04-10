# AGENTS.md

work style: telegraph; noun-phrases ok; drop grammar; min tokens.

> bootstrap context only. discoverable from codebase → don't put here.
> corrections + patterns → LESSONS_LEARNED.md.

## Constraints

- `PROXY_SECRET`: Injected by CI into `src/app.ts`. Local dev requires manual set in `CONFIG`.
- `SW_VERSION`: Bump in `sw.js` on cache/file-list changes to avoid stale PWA versions.

## Legacy & Deprecated

<!-- Nothing currently -->

## Learning System

Read `LESSONS_LEARNED.md` (wisdom) and `ITERATION_LOG.md` (journal).
Log every session in `ITERATION_LOG.md`. Promote patterns 2+ times to `LESSONS_LEARNED.md`.
Date format: `YYYY-MM-DD`. Never delete from journal. Obsolete lessons → Archive.

## Sub-Agents

Proactively invoke specialized agents in `.claude/agents/`.

| Agent | Invoke When |
|-------|-------------|
| Architect | Design decisions, scalability, ADRs |
| Planner | Complex multi-step features — plan first |
| Code/Sec Reviewer | After code changes, input/API handling |
| Doc Updater | Codemaps, README, docs |
| Refactor/Legal | Cleanup, dead code, license audits |
| UX Expert | UI/UX, interaction, accessibility |
| Agent Creator | New recurring task domain |
