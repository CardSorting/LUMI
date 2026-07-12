# Workspace Knowledge Ledger

This ledger now routes to the current LUMI workspace operating docs and preserves older forensic pages as historical context. Prefer the root continuity docs for current agent operation.

## 🗺️ Navigation

- [**Agent Playbook**](../AGENT_PLAYBOOK.md) — Current-state operating brief for future agents.
- [**Agent Fast Orientation**](agent/playbook.md) — Current execution hot paths and validation loop.
- [**Agent Memory**](agent/agent-memory.md) — Durable constraints and safety boundaries.
- [**Key Findings**](agent/key-findings.md) — Evidence-backed execution and throughput findings.
- [**Troubleshooting**](agent/troubleshooting.md) — Reproduced failures and exact recovery commands.
- [**Common Pitfalls**](agent/common-pitfalls.md) — Workspace-specific execution traps.
- [**Patterns**](agent/patterns.md) — Repeatable fast-path implementation patterns.
- [**Workspace Wiki**](../WIKI.md) — Stable architecture, subsystem map, setup, testing, deployment notes.
- [**Troubleshooting**](../TROUBLESHOOTING.md) — Reproduced failures, fixes, confirmed non-causes, validation guidance.
- [**Decisions**](../DECISIONS.md) — Root-level continuity ADRs and operating decisions.
- [**Handoff**](../HANDOFF.md) — Current working-tree transfer notes.
- [**01 System Overview**](01-system-overview.md) — Current `.wiki` overview aligned to LUMI + BroccoliDB.
- [**Active Technical Changelog**](changelog.md) — Ledger change record.
- [**Dependency-Oriented Execution Executive Brief**](high-throughput-execution-executive-brief.md) — Maintainer and onboarding summary.
- [**Dependency-Oriented Execution Philosophy**](high-throughput-execution-philosophy.md) — Normative reasoning and operating principles.
- [**Dependency-Oriented Execution Whitepaper**](high-throughput-execution-whitepaper.md) — Canonical technical architecture reference.
- [**Dependency-Oriented Execution ADRs**](adr/README.md) — Decision records for the execution model.
- [**Dependency-Oriented Execution Migration Report**](high-throughput-execution-migration.md) — Before/after evolution and measured evidence.
- [**00 Forensic Substrate Report**](00-forensics.md) — Historical forensic report; refresh before treating as current.

## Current Verification Matrix

| Requirement | Current status |
| :--- | :--- |
| Root agent playbook exists | [x] `AGENT_PLAYBOOK.md` |
| Stable workspace wiki exists | [x] `WIKI.md` |
| Troubleshooting captures reproduced failures | [x] `TROUBLESHOOTING.md` |
| Root decisions / ADR log exists | [x] `DECISIONS.md` |
| Current handoff exists | [x] `HANDOFF.md` |
| Sibling concurrency and latency evidence recorded | [x] [Agent key findings](agent/key-findings.md) |
| Canonical high-throughput architecture suite linked | [x] [Whitepaper](high-throughput-execution-whitepaper.md) |
| Historical forensic report refreshed after 2026-07-09 | [ ] Pending fresh diagnostics |
| `ROADMAP.md` repaired after bootstrap drift | [ ] Pending roadmap pass |

## Current Source Priority

1. Implementation and package manifests.
2. Root continuity docs listed above.
3. Maintained docs under `docs/` and `broccolidb/docs/`.
4. Historical `.wiki` forensic pages after they are revalidated.

---
*Custodian: LUMI Agent*
*Last Updated: 2026-07-12*
