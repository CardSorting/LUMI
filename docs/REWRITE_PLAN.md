# Documentation Rewrite Status

Agent workspace docs (`docs/` excluding `broccolidb/`) rewritten to match the LUMI codebase as of this repo.

## Completed

- Index: `docs/README.md`, `docs/home.mdx`, `docs/DOCS_GUIDE.md`
- Architecture: `docs/architecture/current.md`, `docs/PROJECT_MAP.md`, `docs/SYSTEM_COMMUNICATION.md`
- Getting started: quick-start, what-is, installing, authorizing, glossary
- Reference: `tools-reference/all-dietcode-tools.mdx`, `core-features/model-selection-guide.mdx`
- Advanced: `MEMORY_AND_REASONING.md`, `WORKING_WITH_SUBAGENTS.md`
- Root `README.md` (LUMI)
- `docs/docs.json` — LUMI branding, repo links
- Batch pass: `scripts/rewrite-agent-docs.mjs` (110 files — user-facing DietCode→LUMI, stale link fixes)

## Accurate codebase facts documented

| Topic | Source of truth |
|-------|-----------------|
| Product name | `package.json` → LUMI (`CardSorting.lumi`) |
| Controller | `src/core/controller/index.ts` — class `Controller` |
| Tools | `src/shared/tools.ts` + `ToolExecutorCoordinator.ts` |
| Providers (wired) | `src/shared/providers/providers.json` — 4 providers |
| Slash commands | `src/core/slash-commands/index.ts` |
| Roadmap settings | `lumi.roadmap.*` in `package.json` |

## Not rewritten (intentionally)

- **`broccolidb/docs/**`** — separate package docs per user request
- **Provider-config pages** for unwired handlers — may describe upstream providers; see model-selection-guide for active four

## Maintenance

Re-run after large code changes:

```bash
node scripts/rewrite-agent-docs.mjs
npm run docs:check-links
```
