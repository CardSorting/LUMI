# Verification Pipeline

No mutation is complete until verification succeeds. The verification pipeline re-proves structural truth after every repair execution.

## VerificationResult

```typescript
interface VerificationResult {
  verificationId: string;
  sessionId: string;
  executionId: string;
  passed: boolean;
  introducedFindings: SpiderFinding[];
  resolvedFindings: SpiderFinding[];
  remainingFindings: SpiderFinding[];
  driftStatus: 'clean' | 'drifted';
  gateStatus: 'pass' | 'fail';
  invariantViolations: string[];
  diff?: SpiderReportDiff | null;
  gate?: SpiderGateResult;
  verifiedAt: number;
}
```

## Pipeline Stages

After `RepairExecutor` completes:

1. **Re-audit** — `spider.audit({ scope: 'changed-files', includeTypes: true })`
2. **Gate** — `spider.gate({ scope: 'changed-files' })`
3. **Invariants** — `InvariantEngine.auditInvariants()`
4. **Diff** — `spider.diffSinceLast(postAudit)` or baseline comparison

## Pass Criteria

Verification `passed` is `true` only when **all** hold:

- `gate.exitCode === 0`
- `invariantViolations.length === 0`
- `driftStatus === 'clean'`
- No new ERROR-severity findings vs baseline

## Usage

```typescript
const { execution } = await ctx.runtime.execute({ plan, policy: 'autonomous_safe' });

const result = await ctx.runtime.verify({
  execution,
  sessionId: session.sessionId,
  baselineReport: audit, // optional; defaults to last session audit
});

if (!result.passed) {
  // Session marked failed; rollback triggered if snapshots exist
  console.log(result.introducedFindings);
  console.log(result.invariantViolations);
}
```

## Failure Handling

When verification fails:

1. Session status → `failed`
2. `RollbackCoordinator.restore(snapshotIds)` if execution snapshots exist
3. Session status → `rolled_back` when restore succeeds
4. `verificationFailures` metric incremented
5. `session_rolled_back` trace emitted

## Doctrine

- Spider audit during verification is read-only
- Verification always runs after execution — no skip path
- Introduced findings are compared against session baseline audit
- Gate failure is a hard stop regardless of partial repair success

## Forbidden

- Marking execution complete without `verify()`
- Skipping gate or invariant checks
- Silent rollback without trace emission
- Autonomous re-execution loops on verification failure
