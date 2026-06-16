# SPIDER: Sovereign Structural Forensic Engine (V20)

Spider proves structural truth. It does not guess.

## Forensic Contracts

1. **Evidence** — typed `SpiderEvidence` on every finding
2. **Identity** — `SemanticFootprint` with AST-normalized SHA-256
3. **Reality** — `DiskParityResult` with explicit `driftStatus`
4. **Repair** — JSON-serializable `RepairDirective` with verification commands

## SPI Diagnostics

| ID | Name |
| --- | --- |
| SPI-001 | SymbolicContractBreakage |
| SPI-002 | TypeSoundnessFailure |
| SPI-003 | ArchitecturalVolcano |
| SPI-004 | StructuralLoop |
| SPI-005 | LayerViolation |
| SPI-006 | RealityDrift |
| SPI-007 | SemanticIdentityMismatch |
| SPI-008 | RepairDirectiveUnsafe |
| SPI-009 | CompilerUnavailable |
| SPI-010 | GraphStaleness |

## Agent Workflow

```typescript
const gate = await ctx.graph.spider.preflight('src/core/provider.ts');

const ci = await ctx.graph.spider.gate({ scope: 'changed-files' });
if (ci.blocked) process.exit(ci.exitCode);

const compact = ctx.graph.spider.compact(ci.report);
```

- **Preflight** before editing high-impact files
- **Gate** for CI-style pass/fail (`conclusion`, `exitCode`)
- **Compact** for token-efficient `file:line:col` lines
- Respect SPI-006 drift — `resync` before mutations
- Follow `agentDigest.playbook` in order

See [spider-agent-ergonomics.md](../../../docs/api/spider-agent-ergonomics.md) and [spider-v20-forensic-engine.md](../../../docs/architecture/spider-v20-forensic-engine.md).
