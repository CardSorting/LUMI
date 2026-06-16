# BroccoliDB v26: Substrate Convergence

BroccoliDB v26 unifies capability intent, Spider forensic audit, repair planning, approval policy, mutation execution, verification, trace emission, rollback, and health into a single deterministic orchestration pipeline.

## Thesis

BroccoliDB is a **deterministic substrate runtime** that absorbs agent pressure through:

- explicit intent
- forensic verification
- lifecycle discipline
- governed orchestration

The system thinks in **sessions**, **plans**, **executions**, and **verifications** — not disconnected helper calls.

## Orchestration Pipeline

```text
CapabilityIntent
  → Trace
  → Spider Audit (read-only)
  → MutationPlan (RepairDirective → ordered steps)
  → ApprovalPolicyEngine.assertAllowed(plan)
  → RepairExecutor (sole mutation path)
  → VerificationPipeline (re-audit, gate, invariants, diff)
  → ExecutionTrace emission
  → RollbackCoordinator (on failure)
```

Every step is linked by `sessionId`, `correlationId`, and `intentId`.

## Components

| Component | Responsibility |
| --- | --- |
| `OrchestrationRuntime` | Session lifecycle, pipeline coordination, health |
| `MutationPlanner` | `RepairDirective[]` → `MutationPlan` |
| `ApprovalPolicyEngine` | Policy authorization before mutation |
| `RepairExecutor` | Applies file mutations (Spider never mutates) |
| `VerificationPipeline` | Post-mutation Spider + invariants + gate |
| `RollbackCoordinator` | Pre-execution snapshots, restore on failure |
| `ExecutionTrace` | Observable session events |

All components implement v21 lifecycle: `start()`, `flush()`, `health()`, `stop()`.

## Agent Flow

```typescript
await ctx.start();

const session = ctx.runtime.beginSession({ taskId: 'repair-auth-flow' });

const audit = await ctx.graph.spider.audit({
  scope: 'changed-files',
});
ctx.runtime.recordAudit(session.sessionId, audit);

const gate = await ctx.graph.spider.gate({ scope: 'changed-files' });

if (gate.blocked) {
  const plan = ctx.runtime.planRepairs({
    audit,
    policy: 'autonomous_safe',
    sessionId: session.sessionId,
  });

  ctx.runtime.preview(plan, 'autonomous_safe');

  const { execution } = await ctx.runtime.execute({ plan, policy: 'autonomous_safe' });
  await ctx.runtime.verify({ execution, sessionId: session.sessionId });
}

await ctx.stop();
```

Access via `ctx.runtime` — registered in `LifecycleRegistry` as `orchestration`.

## Forbidden Patterns

- Autonomous repair loops
- Mutation during Spider audit
- Direct file mutation outside `RepairExecutor`
- Direct repair execution from Spider
- Sidecar orchestration queues
- Hidden rollback behavior
- Implicit retries without traces
- Constructor-started orchestration
- Silent recovery

## Observability

`OrchestrationRuntime.getRuntimeHealth()` exposes:

- `activeSessions`
- `failedSessions`
- `rollbackCount`
- `verificationFailures`
- `averageExecutionLatencyMs`
- `averageVerificationLatencyMs`
- `pendingApprovals`

`getTrace(sessionId?)` returns typed `ExecutionTraceEvent[]`.

## Doctrine

Agents express intent.  
Capabilities validate intent.  
Spider proves structural truth.  
Policies authorize mutation.  
Executors apply disciplined change.  
Verification confirms reality.  
Rollback restores sovereignty.  
The substrate owns consequences.
