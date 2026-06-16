# Spider Agent Ergonomics

Spider reports are designed for **agents first** — structured like SARIF runs, ESLint JSON output, LSP `PublishDiagnostics`, and GitHub Checks conclusions.

## Quick start

### Pre-edit gate (preflight)

```typescript
const gate = await ctx.graph.spider.preflight('src/core/provider.ts');
if (!gate.audit.passed) {
  console.log(gate.audit.agentDigest!.agentNarrative);
  for (const step of gate.audit.agentDigest!.playbook) {
    console.log(step.step, step.phase, step.instruction);
  }
}
```

### CI gate (audit + block decision)

```typescript
const result = await ctx.graph.spider.gate({
  scope: 'changed-files',
  includeRepairDirectives: true,
  gatePolicy: { blockOnErrors: true, blockOnDrift: true },
});

if (result.blocked) {
  console.log(result.conclusion); // 'failure' | 'neutral'
  process.exit(result.exitCode);  // 0 | 1
}
```

### Token-efficient compact view

```typescript
const report = await ctx.graph.spider.audit({ scope: ['src/foo.ts'] });
const compact = ctx.graph.spider.compact(report);
// compact.lines — ESLint-style: file:line:col: severity rule message [findingId]
// compact.playbook — ordered resync → repair → verify steps
// compact.gate — blocked, conclusion, exitCode
```

## Export formats

| Method | Industry analog | Use |
| --- | --- | --- |
| `compact(report)` | ESLint compact / `cargo check` summary | Low-token agent context |
| `toSarif(report)` | SARIF 2.1.0 | GitHub Code Scanning, CI upload |
| `toLspDiagnostics(report)` | LSP PublishDiagnostics | Editor overlays, relatedInformation → repairs |
| `formatNarrative(report)` | Human + LLM markdown | Tool output |
| `diff(before, after)` | Code scanning delta | PR review — introduced vs resolved |
| `diffSinceLast()` | Session baseline | Before/after mutation in one session |
| `explain(report, findingId)` | Rule doc + directives | Follow-up on a specific finding |

## Agent digest fields

| Field | Purpose |
| --- | --- |
| `verdict` | `pass` \| `warn` \| `fail` |
| `passed` | Boolean gate |
| `blockers` | ERROR findings with `location` (`file:line:col`) and `ruleDoc` |
| `playbook` | Ordered steps: `resync` → `repair` → `verify` → `investigate` |
| `recommendedActions` | Prioritized repairs with `verificationCommand` |
| `agentNarrative` | Full markdown including playbook |

## Gate policy

```typescript
interface SpiderGatePolicy {
  blockOnErrors?: boolean;   // default true
  blockOnWarnings?: boolean; // default false
  blockOnDegraded?: boolean; // default false
  blockOnDrift?: boolean;    // default true
}
```

`conclusion` follows GitHub Checks: `success` | `failure` | `neutral`.

## Stable IDs

- `findingId` — cite in PRs and `explain()`
- `evidenceId` — links evidence to findings
- `directiveId` — links playbook steps to repairs

## Alternate entry

```typescript
await ctx.audit.spider.gate({ scope: 'changed-files' });
```

## Recommended workflow

1. `preflight(file)` before editing high-impact paths
2. Make changes
3. `gate({ scope: 'changed-files' })` — hard stop on `exitCode === 1`
4. `diffSinceLast()` to see introduced vs resolved findings
5. Follow `playbook` in order; never skip `verificationCommand`

## Production guarantees

- `validateSpiderReport()` on every audit
- SARIF fingerprints use stable `findingId`
- LSP diagnostics attach repair `relatedInformation`
- Post-mutation tool mirror appends narrative when verdict ≠ pass
