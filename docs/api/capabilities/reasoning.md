# Reasoning Capability

## Purpose
Contradiction detection, pedigree tracing, sovereignty verification, and skeptical audits.

## Methods
| Method | Input | Output |
|--------|-------|--------|
| `detectContradictions` | `ReasoningContradictionsInput` | `ReasoningContradictionsResult` |
| `getReasoningPedigree` | `ReasoningPedigreeInput` | `ReasoningPedigreeResult` |
| `getNarrativePedigree` | `ReasoningNodeInput` | `ReasoningNarrativePedigreeResult` |
| `performSkepticalAudit` | `ReasoningSkepticalAuditInput` | `ReasoningSkepticalAuditResult` |
| `health` | — | `Promise<CapabilityHealth>` |

## Errors
- `LifecycleStateError`
- `AgentGitError` (`INVALID_ARGUMENT`)
- `AgentGitError` (`REASONING_CONFLICT`) — blocking contradictions upstream

## Lifecycle
Requires `await ctx.start()`.

## Example
```ts
const { reports } = await ctx.reasoning.detectContradictions({ startIds: ['node-1'], depth: 2 });
```
