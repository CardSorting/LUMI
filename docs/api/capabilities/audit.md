# Audit Capability

## Purpose
Invariant checks, impact speculation, and constitutional constraint enforcement.

## Methods
| Method | Input | Output |
|--------|-------|--------|
| `invariants` | — | `AuditInvariantsResult` |
| `speculateImpact` | `AuditSpeculateImpactInput` | `AuditSpeculateImpactResult` |
| `addLogicalConstraint` | `AuditLogicalConstraintInput` | `AuditLogicalConstraintResult` |
| `getLogicalConstraints` | — | `AuditLogicalConstraintsResult` |
| `checkConstitutionalViolation` | `AuditConstitutionalViolationInput` | `AuditConstitutionalViolationResult` |
| `health` | — | `Promise<CapabilityHealth>` |

## Errors
- `LifecycleStateError`
- `InvariantViolationError` — deep invariant failures
- `AgentGitError` (`INVALID_ARGUMENT`)

## Lifecycle
Requires `await ctx.start()`.

## Example
```ts
const { violations } = await ctx.audit.invariants();
```
