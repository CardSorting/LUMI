# SpiderReport

Typed output of `ctx.graph.spider.audit()`.

## Shape

```typescript
interface SpiderReport {
  reportId: string;
  generatedAt: string;
  scope: string;
  health: SpiderHealth;
  typeMirror: TypeMirrorResult;
  footprints: SemanticFootprint[];
  diskParity: DiskParityResult[];
  findings: SpiderFinding[];
  structuralViolations: StructuralViolation[];
  layerViolations: LayerViolation[];
  cycles: CycleFinding[];
  repairDirectives: RepairDirective[];
  entropy: number;
  degraded: boolean;
  degradedReasons: string[];
  /** Gate for agents — false when ERROR findings exist. */
  passed?: boolean;
  verdict?: 'pass' | 'warn' | 'fail';
  /** SARIF-style digest for agents (default on). */
  agentDigest?: SpiderAgentDigest;
}
```

## Agent digest

When `includeAgentDigest !== false` (default), the report includes:

```typescript
interface SpiderAgentDigest {
  verdict: 'pass' | 'warn' | 'fail';
  passed: boolean;
  summary: string;
  blockers: SpiderFindingRef[];
  recommendedActions: SpiderRecommendedAction[];
  agentNarrative: string; // markdown for tool output
}
```

See [spider-agent-ergonomics.md](./spider-agent-ergonomics.md) for preflight and workflow patterns.

## Finding

```typescript
interface SpiderFinding {
  diagnosticId: SpiderDiagnosticId; // SPI-001 … SPI-010
  severity: 'ERROR' | 'WARN' | 'INFO';
  label: string;
  filePath: string;
  symbolName?: string;
  sourceRange?: SourceRange;
  evidence: SpiderEvidence[];
  message: string;
}
```

## Evidence

```typescript
interface SpiderEvidence {
  diagnosticId: SpiderDiagnosticId;
  severity: SpiderSeverity;
  filePath: string;
  symbolName?: string;
  sourceRange?: SourceRange;
  evidenceKind: EvidenceKind;
  evidenceHash?: string;
  observed: string;
  expected: string;
  rationale: string;
}
```

## Type mirror

When `includeTypes: true` (default), `typeMirror` reports compiler availability explicitly:

| Field | Meaning |
| --- | --- |
| `compilerAvailable` | `tsconfig.json` parsed and program created |
| `diagnosticsComplete` | Full syntactic + semantic pass completed |
| `degradedReason` | Present when type truth was not verified |
| `commandUsed` | e.g. `typescript.createProgram` |
| `tsconfigPath` | Resolved config path |
| `diagnosticCount` | Number of compiler diagnostics |

If the compiler is unavailable, the report sets `degraded: true` and emits an SPI-009 finding.

## Disk parity

Each `DiskParityResult` includes SHA-256 `graphHash` and `diskHash`. Drift is explicit via `driftStatus`.

## Usage

```typescript
const report = await ctx.graph.spider.audit({
  scope: 'changed-files',
  includeTypes: true,
  includeRepairDirectives: true,
});

for (const finding of report.findings) {
  console.log(finding.diagnosticId, finding.message, finding.evidence[0]?.rationale);
}
```
