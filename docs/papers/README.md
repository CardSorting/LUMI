# LUMI papers

Three documents describe the **agent layer** (`src/`, `webview-ui/`) the same way BroccoliDB papers describe the substrate (`broccolidb/`). Read them in this order:

| Order | Doc | Audience | Time |
|-------|-----|----------|------|
| 1 | [Companion brief](companion-brief.md) | Executives, PMs, new contributors | 5 min |
| 2 | [Philosophy](philosophy.md) | Designers, tech leads — *why* calm agency | 15 min |
| 3 | [Whitepaper](whitepaper.md) | Engineers — *how* it is built (incl. §8 governed execution) | 45 min |

## One-line summary

**LUMI** is a VS Code extension that runs an approval-gated agent loop (Plan/Act, 63 tools, 4 providers) with **governed subagent swarms** (lock-necessity, roadmap/audit coordination, merge gate, receipt schema v3) on top of **BroccoliDB** memory and structural proof.

## Two layers in this monorepo

```
┌─────────────────────────────────────────────────────────┐
│  LUMI (agent)          docs/papers/*                    │
│  Session · approval · LLM · tools · governed swarms · webview │
│  src/ · webview-ui/                                     │
└───────────────────────────┬─────────────────────────────┘
                            │ @noorm/broccolidb
                            │ cognitive memory · Spider · kernel
┌───────────────────────────▼─────────────────────────────┐
│  BroccoliDB (substrate)  broccolidb/docs/papers/*         │
│  Proof · repair · runtime graph · snapshots             │
└─────────────────────────────────────────────────────────┘
```

Do not merge the narratives. Companion UX is not substrate discipline.

## Verify claims

```bash
# Agent workspace
npm run check-types && npm run test:unit
npm run docs:check-agent-links

# Substrate (separate package)
cd broccolidb && npm run test:guardrails
```

## Related

| Doc | Scope |
|-----|-------|
| [Architecture (current)](../architecture/current.md) | Module map |
| [Project map](../PROJECT_MAP.md) | 1-to-1 paths |
| [All tools](../tools-reference/all-dietcode-tools.mdx) | Tool enum |
| [Governed subagent execution](../governed-subagent-execution.md) | Swarm harness + roadmap/audit integration |
| [Governed execution runbook](../governed-execution-runbook.md) | Operator incidents |
| [Governed execution decisions](../governed-execution-decisions.md) | ADRs |
| [BroccoliDB papers](../../broccolidb/docs/papers/philosophy.md) | Substrate philosophy |
