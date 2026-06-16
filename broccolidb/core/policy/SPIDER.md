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
await ctx.graph.spider.audit({
  scope: 'changed-files',
  includeTypes: true,
  includeRepairDirectives: true,
});
```

- Respect SPI-006 drift before continuing mutations
- Address SPI-002 compiler findings when `typeMirror.diagnosticsComplete`
- Follow repair directives; never invent fixes without evidence

See [spider-v20-forensic-engine.md](../../../docs/architecture/spider-v20-forensic-engine.md) for full architecture.
