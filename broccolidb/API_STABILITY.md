# API stability policy (v30)

## Stable (semver)

Exported from `broccolidb/core/public-api.ts` and documented in `docs/public-api.md`.

Includes:

- `AgentContext` lifecycle and capability getters
- `OrchestrationRuntime` operator methods
- Public error types and `GuidedError`
- Capability and intent **types**
- `Workspace`, `Connection` for bootstrap scripts

**Guarantee:** Minor versions add backward-compatible APIs only. Patch versions fix bugs without signature changes.

## Internal

Everything under `broccolidb/core/**` not listed in `public-api.ts`:

- Services (`SpiderService`, `GraphService`, …)
- Orchestration internals (`MutationPlanner`, `RuntimeGraphStore`, …)
- MCP server implementation
- Infrastructure (`BufferedDbPool`, …)

May change in any release without notice.

## Deprecated for removal

Documented only in `MIGRATION.md`. No new usage.

- Direct `ServiceContext` mutation
- Compatibility bridge exceptions without `deletionDate`
- Public experimental names (sovereign, vitality, oracle in user-facing strings)

## Forbidden patterns

| Pattern | Why |
|---------|-----|
| Capabilities before `start()` | Lifecycle violation |
| `SpiderService` on AgentContext | Bypasses capability tracing |
| Spider mutating during audit | Forensic integrity |
| Undocumented public `any` | Type safety |
| Examples bypassing capabilities | Teaches misuse |

## Required lifecycle

```typescript
await ctx.start();
try { /* work */ } finally { await ctx.stop(); }
```

## Supported runtime modes

`readonly` | `interactive` | `autonomous_safe` | `ci`

## Verification

- `tests/public-api-snapshot.test.ts` — export allowlist
- `tests/no-experimental-public-names.test.ts` — naming guard
- `tests/examples-smoke.test.ts` — golden paths execute
- `npm run build` — types compile

## Change process

1. Update `public-api.ts`
2. Update `docs/public-api.md` and this file
3. Update `public-api-snapshot.test.ts` allowlist
4. Add/adjust tests
5. Entry in `CHANGELOG.md`
