# Repair Directives

Spider emits repair directives as **evidence-backed suggestions**. Spider does not execute them.

## Allowed types

| Type | Purpose |
| --- | --- |
| `UPDATE_IMPORT_PATH` | Point import at registered provider |
| `ADD_MISSING_EXPORT` | Restore exported symbol contract |
| `REMOVE_STALE_IMPORT` | Drop unused import |
| `RENAME_SYMBOL_REFERENCE` | Rename reference after symbol move |
| `MOVE_SYMBOL_REFERENCE` | Update reference to new file path |
| `BREAK_CYCLE_BY_INTERFACE` | Invert cycle via shared interface |
| `FIX_LAYER_VIOLATION` | Resolve joy-zoning layer leak |
| `REFRESH_GRAPH_NODE` | Re-index graph from disk |
| `RESYNC_DISK_PARITY` | Align graph hash with disk bytes |

## Shape

```typescript
interface RepairDirective {
  directiveId: string;
  type: RepairDirectiveType;
  targetFile: string;
  targetRange?: SourceRange;
  suggestedValue: string;
  rationale: string;
  preconditions: string[];
  verificationCommand?: string;
  riskLevel: 'low' | 'medium' | 'high';
  supportingEvidenceIds: string[];
}
```

## Requirements

Every directive must include:

1. **Why it is safe** — `rationale` + `preconditions`
2. **What evidence supports it** — `supportingEvidenceIds` referencing SPI findings
3. **What command verifies it** — `verificationCommand` (e.g. `npx tsc --noEmit`, `grep`)

Directives without evidence or verification commands are filtered out by `RepairDirectiveEngine.validateDirectives()`.

## Example

```json
{
  "directiveId": "…",
  "type": "RESYNC_DISK_PARITY",
  "targetFile": "core/foo.ts",
  "suggestedValue": "re-read disk bytes and refresh graph node",
  "rationale": "Disk bytes diverged from indexed graph state.",
  "preconditions": ["File exists on disk", "No concurrent writer holds lock"],
  "verificationCommand": "npx tsc --noEmit",
  "riskLevel": "medium",
  "supportingEvidenceIds": ["SPI-006"]
}
```

## Requesting directives

```typescript
const report = await ctx.graph.spider.audit({
  scope: 'all',
  includeRepairDirectives: true,
});

for (const directive of report.repairDirectives) {
  // Agent applies changes externally; Spider only witnesses.
}
```

## Resync

`ctx.graph.spider.resync({ files })` returns additional `REFRESH_GRAPH_NODE` directives when parity drift remains after re-indexing.
