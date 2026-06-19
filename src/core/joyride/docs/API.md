# JoyRide API Reference

**Frozen public surface — `@core/joyride`**

Source of truth: `index.ts` + `JoyRideContract.ts` (`JOYRIDE_FROZEN_EXPORTS`). Changes require contract review and `JoyRideContractDrift.test.ts` update.

---

## Hot-path lookup

| Function | Returns | Purpose |
|---|---|---|
| `lookupSafeCommandResult(cache, command, scope, changedFileGeneration?, fileHashes?)` | `JoyRideCommandLookupDecision` | Command or verification lookup (classifier routes) |
| `lookupSearchResult(cache, query, options, scope, changedFileGeneration?)` | `JoyRideSearchLookupDecision` | Grep/search reuse |
| `lookupVerificationProof(cache, command, scope, snapshot?, fileHashes?)` | `JoyRideCommandLookupDecision` | Verification-only lookup |
| `lookupVerificationProofWithExplain(...)` | `JoyRideCommandLookupDecision` | Verification lookup with built snapshot |

### Hit guard

```typescript
if (isJoyRideHitDecision(decision)) {
  return decision.value
}
```

---

## Hot-path store

| Function | Purpose |
|---|---|
| `storeReusableCommandResult(cache, command, result, scope, changedFileGeneration?)` | Store command output (classifier gates) |
| `storeSearchResult(cache, query, options, results, count, scope, changedFileGeneration?)` | Store search results |
| `storeVerificationProof(cache, command, entry, scope, snapshot?, diagnosticOnly?, fileHashes?)` | Store verification entry with proof |
| `storeCommandDiagnostic(cache, command, result, scope, changedFileGeneration?)` | Diagnostic-only store |
| `storeFailedVerificationDiagnostic(cache, command, result, scope, changedFileGeneration?)` | Failed verification diagnostic |
| `storeScratchArtifactWithCleanup(cache, spec, value, scope)` | Scratch admission → `JoyRideCacheDecision` |

---

## Lifecycle

| Function | Purpose |
|---|---|
| `getJoyRideCache()` | Singleton cache instance (pass to helpers only) |
| `createJoyRideTaskScope(taskId, cwd, terminalMode, generation)` | Build task scope |
| `registerTaskLifecycle(cache, taskId, generation)` | Register task generation |
| `bumpTaskGeneration(cache, taskId)` | Cancel / invalidate generation |
| `flushTaskGeneration(cache, taskId, reason?)` | Flush task entries |
| `flushWorkspace(cache, workspaceFingerprint, reason?)` | Invalidate workspace-scoped entries |
| `shutdownJoyRide(cache, reason?)` | Full shutdown |
| `shutdownJoyRideCache()` | Extension deactivate wrapper |
| `withTaskCacheScope(cache, taskId, generation, fn)` | Scope helper |

---

## Configuration

| Function | Purpose |
|---|---|
| `getJoyRideConfig()` | Current operational config |
| `setJoyRideConfig(partial)` | Override config (tests) |
| `loadJoyRideConfigFromEnv(env?)` | Load from environment |
| `resetJoyRideConfig()` | Reset to defaults |
| `explainJoyRideConfig()` | Human-readable config string |
| `isJoyRideDisabled()` | Mode === disabled |
| `isDiagnosticsOnly()` | Mode === diagnostics-only |
| `isJoyRideDegraded()` | Degraded flag |
| `getJoyRideDegradedReason()` | Degraded reason string |
| `isCommandReuseEnabled()` | Command skip allowed |
| `isVerificationCacheEnabled()` | Verification reuse allowed |
| `isSearchCacheEnabled()` | Search reuse allowed |
| `isScratchCacheEnabled()` | Scratch retention allowed |

### Environment variables

| Variable | Values |
|---|---|
| `JOYRIDE_MODE` | `enabled` · `diagnostics-only` · `disabled` |
| `JOYRIDE_COMMAND_REUSE` | `0`/`false` disables command skip |
| `JOYRIDE_VERIFICATION_CACHE` | `0`/`false` disables verification reuse |
| `JOYRIDE_SEARCH_CACHE` | `0`/`false` disables search reuse |
| `JOYRIDE_SCRATCH_CACHE` | `0`/`false` disables scratch retention |

---

## Command classifier

| Function | Returns |
|---|---|
| `classifyCommand(command)` | `JoyRideCommandClassification` |
| `canCommandSkipExecution(command)` | `boolean` |
| `isCommandCacheEligible(command)` | `boolean` |
| `isVerificationCommand(command)` | `boolean` |
| `isEnvAlteringCommand(command)` | `boolean` |
| `isReadOnlyCacheableCommand(command)` | `boolean` (deprecated alias) |

---

## Verification helpers

| Function | Purpose |
|---|---|
| `validateVerificationProof(proof)` | `{ valid, missing[] }` |
| `buildVerificationFingerprint(input)` | `{ key, fingerprint }` |
| `explainVerificationMiss(proof)` | Miss decision for incomplete proof |

---

## Scratch helpers

| Function | Purpose |
|---|---|
| `storeScratchArtifactWithCleanup(...)` | Admit scratch with cleanup |
| `flushScratchForTask(cache, taskId)` | Flush task scratch |
| `disposeScratchArtifact(cache, key)` | Dispose single entry |
| `rejectUnsafeArtifact(reasonCode, message)` | Explicit rejection |
| `createScratchArtifactEntry(spec, value)` | Build entry struct |

---

## Observability

| Function | Purpose |
|---|---|
| `getJoyRideDecisionLog(limit?)` | Recent decisions (max 128) |
| `getLastJoyRideDecision()` | Most recent decision |
| `clearJoyRideDecisionLog()` | Clear log |
| `explainJoyRideDecision(decision)` | Format decision string |
| `getJoyRideCacheHitAuditTrail(limit?)` | Active skip audit |
| `getJoyRideCacheHitAuditCount()` | Audit count |
| `buildJoyRideDiagnosticReport(cache)` | Full report object |
| `formatJoyRideDiagnosticReport(report)` | Format for logs |
| `createJoyRideBugReportSnapshot(cache)` | JSON for bug reports |
| `summarizeJoyRideHealth(cache)` | One-line health |
| `getJoyRideStats(cache)` | Raw cache stats |
| `logJoyRideDiagnostics(cache)` | Log formatted report |
| `dumpJoyRideDiagnostics(cache)` | Log + return report |
| `buildJoyRideWorkspaceSnapshot(cwd, terminalMode, changedFileGeneration?)` | Workspace fingerprints |

---

## Types (exported)

`JoyRideCacheDecision`, `JoyRideHitDecision`, `JoyRideMissDecision`, `JoyRideStaleDecision`, `JoyRideRejectedDecision`, `JoyRideDisabledDecision`, `JoyRideDegradedDecision`, `JoyRideDiagnosticOnlyDecision`, `JoyRideCommandLookupDecision`, `JoyRideSearchLookupDecision`, `JoyRideFallbackBehavior`, `JoyRideDecisionType`, `JoyRideReasonCode`, `JoyRideOperationalConfig`, `JoyRideOperationalMode`, `JoyRideCommandClassification`, `JoyRideCommandTier`, `JoyRideDiagnosticReport`, `JoyRideCommandCacheEntry`, `JoyRideGrepCacheEntry`, `JoyRideSearchLookupOptions`, `ScratchArtifactSpec`, `ScratchArtifactEntry`, `VerificationProofInput`, `JoyRideCacheHitAudit`

---

## Constants

| Export | Purpose |
|---|---|
| `JOYRIDE_REASON` | Stable reason-code vocabulary |

---

## Forbidden (do not import or call)

| Symbol / pattern | Why |
|---|---|
| `JoyRideCache` class | Internal — use helpers |
| `create*CacheKey`, `createJoyRideFingerprint` | Internal key material |
| `hitDecision`, `missDecision`, … | Internal constructors |
| `lookupCommandResult`, `storeCommandResult` | Legacy — removed |
| `getJoyRideCache().get/set/trySet` | Bypasses typed API |

Enforced by `JoyRideImportBoundary.test.ts` and `JoyRideContractDrift.test.ts`.
