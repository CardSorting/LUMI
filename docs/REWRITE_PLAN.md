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

## Reinforcement (round 5 — README hardening)

- [x] Root `README.md` / `readme.md` — BroccoliDB-style structure: badges, prerequisites, capabilities table, architecture diagram, repo layout, CI guardrails, security, contributing, license
- [x] `docs/README.md` — audience reading paths, release/policy section, expanded features table, runtime API index, local dev + quality checks, principles

## Reinforcement (round 6 — world-class README)

- [x] Root README — centered hero, demo GIF, nav links, TOC, design pillars, compatibility matrix, provider table, mermaid task flow, slash command reference, FAQ (collapsible), scripts table, security boundary table
- [x] `scripts/check-root-readme.mjs` — README/readme parity + required sections/links; wired to `ci:check-all`
- [x] `docs/README.md` — at-a-glance metrics, mermaid doc map, "where to document what" decision table, time estimates on reading paths

## Reinforcement (round 7 — README + contributor hardening)

- [x] Root README — comparison table, keyboard shortcuts, lifecycle hooks, roadmap settings, trust-model mermaid, tech stack, changelog link, 6th FAQ
- [x] `CONTRIBUTING.md` — LUMI-branded, correct GitHub URLs, PR checklist, doc guardrails
- [x] `SECURITY.md` — LUMI scope, supported versions, safe-use guidance
- [x] `scripts/check-docs-readme.mjs` — docs hub structure CI; expanded `check-root-readme.mjs`

## Reinforcement (round 8 — audit + metrics CI)

- [x] Fixed hooks path: `.dietcoderules/hooks/` (was incorrect `.dietcode/hooks`)
- [x] Root README — project config table, @ mentions, recommended workflows, troubleshooting matrix, by-the-numbers metrics
- [x] `check-root-readme.mjs` — validates version/tools/providers against live `package.json` + `tools.ts`
- [x] `docs/README.md` — project configuration section, expanded metrics (12 read-only tools)

## Reinforcement (round 9 — personas, Plan/Act, quality gates)

- [x] Root README — Who LUMI is for, Plan & Act modes, VS Code commands, module mermaid, monorepo packages table, Quality gates (ci:check-all breakdown)
- [x] `npm run docs:check-all` — unified doc guardrail script
- [x] `check-root-readme.mjs` — validates slash/hook/read-only counts from source files
- [x] Fixed companion-brief read-only tools: 13 → **12** (matches `READ_ONLY_TOOLS`)

## Reinforcement (round 10 — local-first, papers, metrics CI)

- [x] Doctrine one-liner (session chain)
- [x] **Local-first & data** — `~/.dietcode/data/`, secrets, `dietcode.db`, checkpoints, provider egress
- [x] Starter `.dietcodeignore` example in README
- [x] **Papers** reading-order table in root README
- [x] **Getting help** channel table; uninstall/reset troubleshooting rows
- [x] `scripts/check-readme-metrics.mjs` — README + companion-brief synced to live codebase; in `docs:check-all`

## Reinforcement (round 11 — link CI + performance)

- [x] `scripts/check-root-readme-links.mjs` — validates all relative README links resolve
- [x] `docs:check-readme-metrics` + `docs:check-root-readme-links` wired into `ci:check-all`
- [x] Quick-install block + jump anchors (Install · Quick start · Docs · Develop · Help)
- [x] **Performance & context** section; Spider policy + enterprise rows in overview
- [x] Version badge validated against `package.json` in metrics check

## Maintenance

Re-run after large code changes:

```bash
node scripts/rewrite-agent-docs.mjs
npm run docs:check-agent-links
npm run docs:check-agent-branding
npm run docs:tag-legacy-providers   # after adding unwired provider pages
npm run docs:check-links
```
