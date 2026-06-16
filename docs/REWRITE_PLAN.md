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
- Batch pass: `scripts/rewrite-agent-docs.mjs` (110+ files — user-facing DietCode→LUMI, stale link fixes)

## Reinforcement (latest)

- [x] `docs/papers/README.md` — reading order + two-layer diagram
- [x] `docs/api/README.md` — runtime API index (BroccoliDB capabilities)
- [x] `scripts/check-agent-docs-links.mjs` — 18 required docs + paper link validation
- [x] `npm run docs:check-agent-links` in `ci:check-all`
- [x] `docs/home.mdx` — papers + architecture + security cards
- [x] `docs/docs.json` — Architecture tab: papers group, `architecture/current`, security/memory docs
- [x] `SECURITY_BEST_PRACTICES.md` — code-accurate layer table
- [x] `CODEBASE_STANDARDS.md` — accurate repo layout + LUMI UX refs
- [x] Cross-links in `architecture/current.md`, `what-is-dietcode.mdx`, `task-management.mdx`

## Reinforcement (round 3)

- [x] `docs/AGENT_STACK.md` — canonical two-layer hub
- [x] `docs/CODE_TO_DOC_MAP.md` — source path → doc lookup
- [x] `docs/features/roadmap-steering.mdx` — `lumi.roadmap.*` settings + tools
- [x] `docs/provider-config/README.mdx` — 4 active vs legacy provider pages
- [x] Expanded `check-agent-docs-links.mjs` — 23 required docs, 87 files scanned
- [x] `docs.json` — AGENT_STACK, CODE_TO_DOC_MAP, roadmap, provider README
- [x] Fixed broken relative links (papers, skills examples, roadmap security)
- [x] Stale DietCode → LUMI in dietcodeignore, task-management, skills, subagents

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

## Reinforcement (round 4)

- [x] `docs:check-agent-branding` wired into `package.json` and `ci:check-all`
- [x] `scripts/tag-legacy-provider-docs.mjs` — 34 legacy provider pages tagged
- [x] Branding fixes: overview, MCP remote server, multiroot, memory-bank, your-first-project, openai-codex
- [x] Expanded link scan: `core-features/`, `tools-reference/`, `mcp/` (+ fixed broken MCP transport link)
- [x] `docs/MAINTAINER.md` linked from README, DOCS_GUIDE, docs.json
- [x] Code-path sections: checkpoints, auto-approve, MCP overview
- [x] `tools-reference/README.mdx` — tools index for maintainers

## Maintenance

Re-run after large code changes:

```bash
node scripts/rewrite-agent-docs.mjs
npm run docs:check-agent-links
npm run docs:check-agent-branding
npm run docs:tag-legacy-providers   # after adding unwired provider pages
npm run docs:check-links
```
