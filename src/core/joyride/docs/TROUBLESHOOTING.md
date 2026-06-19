# JoyRide Troubleshooting

**Symptom → cause → action runbook.**

JoyRide has no UI. Debug through config, decision logs, audit trails, and bug-report snapshots — the same operational pattern as Redis `INFO`, Turbo `--summarize`, or Nx `--verbose` without a dashboard.

---

## Emergency actions

| Goal | Action |
|---|---|
| **Stop all reuse immediately** | `JOYRIDE_MODE=disabled` + restart VS Code |
| **Observe without skipping** | `JOYRIDE_MODE=diagnostics-only` + restart |
| **Disable verification reuse only** | `JOYRIDE_VERIFICATION_CACHE=0` |
| **Attach debug bundle** | `createJoyRideBugReportSnapshot(getJoyRideCache())` |

---

## Symptom index

| Symptom | Section |
|---|---|
| Agent repeated a command but shouldn't have | [§1 Unexpected hit](#1-unexpected-cache-hit) |
| Agent re-ran tests when nothing changed | [§2 Unexpected miss](#2-unexpected-cache-miss) |
| Tests skipped but should have run | [§3 Verification false hit suspicion](#3-verification-reuse-suspicion) |
| JoyRide seems off / no entries | [§4 Disabled or degraded](#4-disabled-or-degraded) |
| High memory / many entries | [§5 Budget pressure](#5-budget-and-pressure) |
| Secret in logs concern | [§6 Secret rejection](#6-secret-rejection) |
| Scratch files not cleaned | [§7 Scratch cleanup](#7-scratch-cleanup) |

---

## 1. Unexpected cache hit

**Symptom:** Command output reused when you expected fresh execution.

### Checklist

1. Confirm command is allowlisted safe-readonly (`classifyCommand(cmd).tier === "safe-readonly"`)
2. Inspect audit trail: `getJoyRideCacheHitAuditTrail()`
3. Check last decision: `getLastJoyRideDecision()`
4. Verify workspace fingerprints unchanged (git HEAD, lockfiles)

### Common causes

| Cause | Reason code | Fix |
|---|---|---|
| Identical safe-readonly command + workspace | `hit.command.safeAllowlisted` | Expected behavior; disable command reuse if needed |
| Diagnostics-only misunderstood | `miss.config.diagnosticsOnly` | Should not skip — file bug if it did |
| Stale hit suspicion | — | Check `stale.*` codes in decision log |

### Mitigation

```bash
JOYRIDE_COMMAND_REUSE=0 code .
# or
JOYRIDE_MODE=disabled code .
```

---

## 2. Unexpected cache miss

**Symptom:** Same `git status` / search re-runs every time.

### Checklist

1. `summarizeJoyRideHealth(getJoyRideCache())` — is `helping=true`?
2. `explainJoyRideConfig()` — mode enabled? feature flags on?
3. Decision log — `miss.*` reason codes?
4. For search: did `changedFileGeneration` bump?

### Common causes

| Cause | Reason code |
|---|---|
| JoyRide disabled | `miss.config.disabled` |
| Diagnostics-only | `miss.config.diagnosticsOnly` |
| Degraded | `miss.cacheDegraded` |
| Workspace generation changed | `stale.workspaceGenerationChanged` |
| Query/glob changed | `miss.search.queryChanged` |
| No prior store | `miss.noEntry` |
| Verification without proof | `miss.verification.missingFileHashes` |

---

## 3. Verification reuse suspicion

**Symptom:** Tests appear skipped after code changes.

### Important

Verification **requires complete proof**. If file hashes are not provided at lookup, reuse cannot occur (`miss.verification.missingFileHashes`).

### Checklist

1. Confirm proof dimensions: `validateVerificationProof(proof)`
2. Check for `stale.fileHashChanged`, `stale.lockfileChanged`, `stale.gitHeadChanged`
3. Confirm failed test output is not reused (`diagnosticOnly` entries)

### Mitigation

```bash
JOYRIDE_VERIFICATION_CACHE=0 code .
```

---

## 4. Disabled or degraded

**Symptom:** No cache activity; `degraded=true` in health summary.

| State | Indicator | Action |
|---|---|---|
| Disabled | `mode=disabled` in config | Set `JOYRIDE_MODE=enabled` or remove env var |
| Degraded | `degraded=true`, `getJoyRideDegradedReason()` | File issue with snapshot; agent still works |
| Feature off | `commandReuse=false` etc. | Check per-feature env vars |

Degraded mode **never** produces trusted hits. Agent execution continues normally.

---

## 5. Budget and pressure

**Symptom:** Entries evicted unexpectedly; `pressureTrimEvents` > 0 in stats.

### Defaults

- Total budget: 32 MiB
- Per entry max: 512 KiB
- Command output summary max: 12 KiB (truncated head/tail)

### Actions

1. Check `getJoyRideStats(cache).largestEntries`
2. Review `trim.pressure` / `trim.emergency` in decision patterns
3. Ensure large outputs are summarized, not stored raw

---

## 6. Secret rejection

**Symptom:** Command output not cached; `reject.secretDetected`.

**Expected behavior.** JoyRide rejects credential-like patterns at admission.

- Secrets are **not** included in diagnostics or snapshots
- Check `rejectedUnsafeEntryCount` in stats summary

Do not disable secret scanning. Fix command output handling at integration layer if false positives occur (file issue with redacted sample).

---

## 7. Scratch cleanup

**Symptom:** Temp artifacts remain after task end.

### Checklist

1. Was `cleanupHandler` provided at store time?
2. Did `flushTaskGeneration` run on completion/cancel?
3. Check `cleanupFailureCount` in stats
4. `cleanupHandler` throws are counted, not propagated

---

## Diagnostic commands (developer console / test)

```typescript
import {
  getJoyRideCache,
  explainJoyRideConfig,
  summarizeJoyRideHealth,
  getJoyRideDecisionLog,
  getJoyRideCacheHitAuditTrail,
  createJoyRideBugReportSnapshot,
  getJoyRideStats,
} from "@core/joyride"

const cache = getJoyRideCache()
console.log(explainJoyRideConfig())
console.log(summarizeJoyRideHealth(cache))
console.log(getJoyRideDecisionLog(16))
console.log(getJoyRideCacheHitAuditTrail())
console.log(JSON.stringify(getJoyRideStats(cache), null, 2))
console.log(createJoyRideBugReportSnapshot(cache))
```

---

## Filing a bug report

Include:

1. `createJoyRideBugReportSnapshot(getJoyRideCache())`
2. `JOYRIDE_MODE` and feature env vars
3. Command/search/verification that behaved unexpectedly
4. Expected vs actual behavior

Do **not** include raw terminal output that may contain secrets.

---

## Related docs

- [Caching model](./CACHING.md) — when hit/miss is expected
- [API reference](./API.md) — diagnostic functions
- [Operator guide](../../../docs/features/joyride.mdx) — configuration reference
