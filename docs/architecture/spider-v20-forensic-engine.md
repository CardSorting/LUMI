# Spider V20: Forensic Structural Engine

Spider is a **typed forensic witness**, not an architectural oracle. It observes physical files, symbolic identity, compiler truth, and layer constraints, then emits deterministic evidence and repair directives. Spider never guesses and never mutates disk during audit.

## Doctrine

1. No heuristic-only claims without evidence.
2. No repair suggestion without source location and rationale.
3. No symbolic diagnosis without physical disk parity.
4. No confidence without explaining evidence.
5. No hidden compiler invocation outside lifecycle.
6. No silent LSP/compiler failure.
7. No mutation during audit.
8. No repair execution inside Spider; directives only.
9. No untyped diagnostic payloads.
10. No generic “architectural issue” messages.

## Staged Pipeline

| Stage | Responsibility |
| --- | --- |
| `scanPhysicalFiles()` | Read bytes-on-disk for scoped files |
| `buildSymbolIndex()` | Update in-memory graph (not disk) |
| `computeSemanticFootprints()` | AST-normalized SHA-256 identity |
| `verifyDiskParity()` | Graph vs disk hash comparison |
| `runTypeMirror()` | TypeScript program diagnostics |
| `detectStructuralViolations()` | Cycles, ghosts, layer leaks |
| `generateRepairDirectives()` | JSON-serializable ARM output |
| `emitForensicReport()` | Typed `SpiderReport` |

## Four Contracts

### Evidence

Every finding includes `diagnosticId`, `severity`, `filePath`, optional `symbolName`/`sourceRange`, `evidenceKind`, optional `evidenceHash`, `observed`, `expected`, and `rationale`.

### Identity

`SemanticFootprint` records AST hash, signature hash, export/import identity, previous/current location, move confidence, and match reason.

### Reality

`DiskParityResult` exposes `graphHash`, `diskHash`, timestamps, and `driftStatus` (`clean` | `drifted` | `missing` | `unknown`).

### Repair

`RepairDirective` is JSON-serializable with `directiveId`, `type`, `targetFile`, optional `targetRange`, `suggestedValue`, `rationale`, `preconditions`, `verificationCommand`, `riskLevel`, and `supportingEvidenceIds`.

## SPI Diagnostic IDs

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

## Agent API

Spider is exposed only through `GraphCapability`:

```typescript
await ctx.graph.spider.audit({
  scope: 'changed-files',
  includeTypes: true,
  includeRepairDirectives: true,
});

await ctx.graph.spider.resync({
  files: ['core/foo.ts'],
});
```

## Lifecycle

`ForensicSpider` is pure: no constructor side effects, no background workers. Compiler invocation happens only inside `runTypeMirror()` during `audit()`. LSP processes remain owned by `LspService`.

## Final Rule

Agents may follow Spider repair maps. Spider proves; it does not execute repairs.
