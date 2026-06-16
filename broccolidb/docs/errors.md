# Errors

BroccoliDB errors are **typed** and **actionable**.

Every public error extends `AgentGitError` with a `code`. Lifecycle misuse uses `GuidedError`, which extends `LifecycleStateError` and adds structured `guidance`:

| Field | Description |
|-------|-------------|
| `code` | Machine-readable identifier |
| `message` | Plain-English summary (multi-line for `GuidedError`) |
| `guidance.likelyCause` | Why this happened |
| `guidance.suggestedFix` | What to do |
| `guidance.command` | Example fix (when applicable) |
| `guidance.docsPath` | Link to this document |

## LifecycleStateError (`LIFECYCLE_STATE_ERROR`)

**When:** A capability or `ctx.runtime` method is called before `start()`, during `stop()`, or after `stop()`.

**Example message:**

```
AgentContext has not been started. Call await ctx.start() before using ctx.query.search().
Cause: Capabilities and runtime require an active lifecycle.
Fix: Wrap usage in try/finally and call await ctx.start() first, await ctx.stop() in finally.
Try: await ctx.start()
Docs: broccolidb/docs/errors.md
```

**Fix:** Follow the lifecycle pattern in [getting-started.md](getting-started.md).

**Demo:** `npx tsx examples/lifecycle-error.ts`

## PolicyBlockedError

**When:** Execution policy blocks a repair plan (e.g. high-risk change under `autonomous_safe`).

**Fix:** Use `human_approval_required` policy, review `ctx.runtime.preview(plan, policy)`, then execute with an allowed policy.

## RuntimeBudgetExceededError (`BUDGET_EXCEEDED`)

**When:** Session exceeds duration, file, directive, or verification limits.

**Fix:**

```typescript
await ctx.runtime.beginSession({
  budget: { maxDirectives: 20, maxDurationMs: 120_000 },
});
```

See [execution budgets](../../docs/api/execution-budgets.md).

## RuntimePolicyViolationError

**When:** Operation violates the current runtime mode (e.g. `execute` in `readonly` mode).

**Fix:** Use `human_approval_required` policy on `planRepairs` / `execute`, or switch to `development` / `recovery` mode if appropriate.

## InvariantViolationError (`INVARIANT_VIOLATION`)

**When:** Constitutional or workspace invariant check fails during deep health or audit.

**Fix:** Run `await ctx.health({ deep: true })` and inspect `invariantViolations`. Resolve violations before mutations.

## StorageIntegrityError (`STORAGE_CORRUPT`)

**When:** CAS blob or snapshot metadata fails integrity verification.

**Fix:** Check `ctx.runtime.getMemoryHealth()`. Replay from last known-good snapshot if available.

## Catching errors in agents

```typescript
import { GuidedError, AgentGitError, PolicyBlockedError } from '@noorm/broccolidb';

try {
  await ctx.query.search({ text: 'foo' });
} catch (e) {
  if (e instanceof GuidedError) {
    console.error(e.code);
    console.error(e.guidance.suggestedFix);
  } else if (e instanceof PolicyBlockedError) {
    console.error('Policy blocked:', e.message);
  } else if (e instanceof AgentGitError) {
    console.error(e.code, e.message);
  } else {
    throw e;
  }
}
```

Guardrail: `tests/error-message.test.ts`
