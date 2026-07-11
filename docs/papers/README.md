# LUMI papers

Three documents describe the **agent layer** (`src/`, `webview-ui/`) the same way BroccoliDB papers describe the substrate (`broccolidb/`). Read them in this order:

| Order | Doc | Audience | Time |
|-------|-----|----------|------|
| 1 | [Companion brief](companion-brief.md) | Executives, PMs, new contributors | 5 min |
| 2 | [Philosophy](philosophy.md) | Designers, tech leads — *why* calm agency | 15 min |
| 3 | [Whitepaper](whitepaper.md) | Engineers — *how* it is built (incl. §8 governed execution) | 45 min |
| 4 | [Knowledge brief](knowledge-brief.md) | Designers, Leads — Workspace Knowledge brief | 5 min |
| 5 | [Knowledge philosophy](knowledge-philosophy.md) | Leads, Designers — Advisory memory tenets | 10 min |
| 6 | [Knowledge thesis](knowledge-thesis.md) | Architects — Sovereign advisory invariant | 15 min |
| 7 | [Knowledge whitepaper](knowledge-whitepaper.md) | Engineers — Architecture details | 30 min |
| 8 | [Golden Cartridge brief](golden-cartridge-brief.md) | PMs, contributors — Workbench summary | 5 min |
| 9 | [Golden Cartridge philosophy](golden-cartridge-philosophy.md) | Leads, designers — Resource tenets | 15 min |
| 10 | [Golden Cartridge whitepaper](golden-cartridge-whitepaper.md) | Engineers — Integration details | 30 min |

## One-line summary

**LUMI** is a VS Code extension that runs an approval-gated agent loop (Plan/Act, 64 tools, 6 providers) with **governed subagent swarms** (lock-necessity, per-agent roadmap projection, patch reconciliation, merge gate, receipt schema v3) on top of **BroccoliDB** memory and structural proof.

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

| Doc | Purpose |
|-----|---------|
| [Architecture (current)](../architecture/current.md) | Module map |
| [Project map](../PROJECT_MAP.md) | 1-to-1 paths |
| [All tools](../tools-reference/all-dietcode-tools.mdx) | Tool enum |
| [Roadmap projection quick reference](../governed-roadmap-projection-quickref.md) | Patch tags, operator legend |
| [Governed subagent execution](../governed-subagent-execution.md) | Swarm harness architecture |
| [Governed execution runbook](../governed-execution-runbook.md) | Operator incidents |
| [Governed execution decisions](../governed-execution-decisions.md) | ADRs |
| [BroccoliDB papers](../../broccolidb/docs/papers/philosophy.md) | Substrate philosophy |
| [Workspace Knowledge Thesis](knowledge-thesis.md) | Invariant thesis |
| [Workspace Knowledge Philosophy](knowledge-philosophy.md) | Philosophy tenets |
| [Workspace Knowledge Brief](knowledge-brief.md) | Executive brief |
| [Workspace Knowledge Whitepaper](knowledge-whitepaper.md) | Technical whitepaper |
| [Golden Cartridge Brief](golden-cartridge-brief.md) | Workbench brief |
| [Golden Cartridge Philosophy](golden-cartridge-philosophy.md) | Philosophy paper |
| [Golden Cartridge Whitepaper](golden-cartridge-whitepaper.md) | Technical whitepaper |
