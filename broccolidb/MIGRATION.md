# Migration guide (→ v30)

## Public import path

**Before:** Mixed imports from package root and deep paths.

**After:** Import stable symbols from `@noorm/broccolidb` only.

```typescript
// ✅ v30
import { AgentContext, OrchestrationRuntime, GuidedError } from '@noorm/broccolidb';

// ❌ Avoid in application code
import { MutationPlanner } from '@noorm/broccolidb/core/orchestration/...';
```

Internal types remain importable via deep paths for BroccoliDB development and tests only.

## Lifecycle (required)

If you called capabilities without `start()`:

```typescript
await ctx.start();
try {
  await ctx.graph.spider.audit({ scope: 'all' });
} finally {
  await ctx.stop();
}
```

Errors now include explicit fix text (`GuidedError`).

## Spider access

**Before:** `ctx` service bridges or direct `SpiderService`.

**After:** `ctx.graph.spider` only.

## Runtime memory

**Before:** In-memory session state lost on restart.

**After:** `await ctx.runtime.snapshot(sessionId)` persists graph; `await ctx.runtime.replay(sessionId)` after restart.

## Removed public exports

These are **internal** as of v30 (import from deep paths only if you maintain BroccoliDB):

- `MutationPlanner`, `RepairExecutor`, `RuntimeStateGraph`, `RuntimeGraphStore`, …
- `Connection`, `mcp`, `watcher` from package root (use CLI or deep imports)

## Renaming (public-facing)

Prefer boring names in docs and agent prompts:

| Avoid (public) | Prefer |
|----------------|--------|
| sovereign runtime | durable runtime memory |
| vitality | capability health |
| oracle / god paths | graph.spider audit |

Internal source files may retain historical names; public API and docs do not.

## Breaking changes summary

| Area | Change |
|------|--------|
| Package exports | Narrowed to `public-api.ts` |
| Lifecycle errors | Stricter messages; `GuidedError` metadata |
| Spider | Capability-only access enforced by convention + docs |

See [API_STABILITY.md](API_STABILITY.md) for stability tiers.
