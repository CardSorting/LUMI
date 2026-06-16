# Errors

BroccoliDB errors are **typed** and **actionable**. Each includes:

- `code` — machine-readable identifier
- Plain-English `message`
- Likely cause and suggested fix (via `GuidedError`)
- Docs link

## LifecycleStateError (`LIFECYCLE_STATE_ERROR`)

**When:** Capability or runtime method called before `start()`, during `stop()`, or after `stop()`.

**Message example:**

```
AgentContext has not been started. Call await ctx.start() before using ctx.query.search().
Cause: Capabilities and runtime require an active lifecycle.
Fix: Wrap usage in try/finally and call await ctx.start() first, await ctx.stop() in finally.
Try: await ctx.start()
Docs: docs/errors.md
```

**Fix:** Always use the lifecycle pattern in [getting-started.md](getting-started.md).

## PolicyBlockedError

**When:** Execution policy blocks a repair plan (e.g. high-risk change under `autonomous_safe`).

**Fix:** Use `human_approval_required` policy and explicit approval flow.

## RuntimeBudgetExceededError (`BUDGET_EXCEEDED`)

**When:** Session exceeds duration, file, directive, or verification limits.

**Fix:** `await ctx.runtime.beginSession({ budget: { maxDirectives: 20 } })` — see `docs/api/execution-budgets.md`.

## RuntimePolicyViolationError

**When:** Operation violates current runtime mode (e.g. autonomous execute in `readonly` mode).

**Fix:** `ctx.runtime.setMode('interactive')` or match mode to your workflow.

## Catching errors in agents

```typescript
import { GuidedError, AgentGitError } from '@noorm/broccolidb';

try {
  await ctx.query.search({ text: 'foo' });
} catch (e) {
  if (e instanceof GuidedError) {
    console.error(e.code, e.guidance.suggestedFix);
  } else if (e instanceof AgentGitError) {
    console.error(e.code, e.message);
  }
}
```
