# AGENTS.md

work style: telegraph; noun-phrases ok; drop grammar; min tokens.

> bootstrap context only
- discoverable from codebase → don't put here.
> corrections + patterns → LESSONS_LEARNED.md.
> development:
- correctness first
- smallest good change
- preserve behavior / interfaces / invariants unless task says otherwise
- simple, explicit code
- KISS
- YAGNI
- DRY; rule of three; temp duplication ok during migration
- high cohesion; low coupling
- follow repo patterns unless intentionally replacing with better consistent one
- refactor when patch would raise future complexity
- for broad changes: optimize for coherent end-state; stage changes; each step verifiable
- no unrelated churn
- leave code better
> validation:
- fastest relevant proof
- targeted tests first
- typecheck / build / lint as needed
- smoke tests for affected flows when useful
- update tests when behavior intentionally changes
> ambiguity:
- cannot decide from code -> explain; ask; no assume
- otherwise choose most reversible reasonable path; state assumption

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
