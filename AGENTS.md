# AGENTS.md

> Non-discoverable bootstrap context only.
> If the model can find it in the codebase, it does not belong here.
> For corrections and patterns, see LESSONS_LEARNED.md.

## Constraints

- PROXY_SECRET is injected by CI from a GitHub secret into `src/app.ts` at build time — local builds need it set manually in CONFIG to authenticate with the Worker
- Bump `SW_VERSION` in `sw.js` when changing cache behavior or app-shell file list — forgetting causes users to stay on stale PWA versions

## Legacy & Deprecated

<!-- Nothing currently — project is new (Feb 2026) -->

## Learning System

This project uses a persistent learning system. Follow this workflow every session:

1. **Start of task:** Read `LESSONS_LEARNED.md` — validated corrections and patterns
2. **During work:** Note any surprises or non-obvious discoveries
3. **End of iteration:** Append to `ITERATION_LOG.md` with what happened
4. **If insight is reusable:** Also add to `LESSONS_LEARNED.md`
5. **If same issue 2+ times in log:** Promote to `LESSONS_LEARNED.md`

| File | Purpose | When to Write |
|------|---------|---------------|
| `LESSONS_LEARNED.md` | Curated, validated wisdom | When insight is reusable |
| `ITERATION_LOG.md` | Raw session journal (append-only) | Every iteration (always) |

Rules: Never delete from ITERATION_LOG. Obsolete lessons → Archive section in LESSONS_LEARNED (not deleted). Date-stamp everything YYYY-MM-DD. When in doubt: log it.

### Periodic Maintenance
This project's config files are audited periodically using `SETUP_AI_AGENT_CONFIG.md`.

## Sub-Agents

Specialized agents in `.claude/agents/`. Invoke proactively — don't wait to be asked.

| Agent | File | Invoke When |
|-------|------|-------------|
| Architect | `.claude/agents/architect.md` | System design, scalability, ADRs |
| Planner | `.claude/agents/planner.md` | Complex multi-step features — plan before coding |
| Code Reviewer | `.claude/agents/code-reviewer.md` | After writing or modifying code |
| Doc Updater | `.claude/agents/doc-updater.md` | Codemaps, README, documentation updates |
| Refactor Cleaner | `.claude/agents/refactor-cleaner.md` | Dead code removal, cleanup |
| Security Reviewer | `.claude/agents/security-reviewer.md` | User input handling, API endpoints, sensitive data |
| UX Expert | `.claude/agents/ux-expert.md` | UI components, interaction patterns, accessibility |
| Agent Creator | `.claude/agents/agent-creator.md` | Need a new specialized agent for a recurring domain |
