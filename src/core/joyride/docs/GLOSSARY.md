# JoyRide Glossary

Canonical terminology for JoyRide documentation and code review. Terms marked **avoid** must not appear in product docs, APIs, or user-facing strings.

---

## Core terms

| Term | Definition |
|---|---|
| **JoyRide** | LUMI's bounded in-process typed execution cache (`src/core/joyride/`) |
| **Execution cache** | Short-lived store of computed hot-path results with explicit invalidation |
| **Cache entry** | Keyed value + metadata (TTL, fingerprints, scope, classification) |
| **Cache kind** | Category: `hotExecution`, `verification`, `workspaceIndex`, `scratchArtifact`, `taskLocal` |
| **Cache generation** | Monotonic task counter; obsolete generations cannot write |
| **Fingerprint** | SHA-256 hash of stable-serialized input dimensions |
| **Workspace snapshot** | Point-in-time fingerprints: git, lockfiles, deps, environment |
| **Task scope** | `{ taskId, generation, approvalBoundaryId, cwd, terminalMode }` |
| **Proof** | Validation fingerprint required for verification reuse |
| **Typed decision** | `JoyRideCacheDecision` — hit/miss/stale/rejected/disabled/degraded/diagnosticOnly |
| **Reason code** | Stable string from `JOYRIDE_REASON` (e.g. `miss.command.unknown`) |
| **Fallback behavior** | Caller instruction when decision is not a hit |
| **Active reuse** | Skipping execution based on cache hit (audited) |
| **Diagnostic-only** | Stored for stats/investigation; never skips work |
| **Degraded mode** | Internal failure; active reuse suspended; agent continues |

---

## Decision vocabulary

| Term | Definition |
|---|---|
| **Hit** | Proof matched; `canReuse: true`; `value` present |
| **Miss** | No reusable entry; execute normally |
| **Stale** | Entry exists but validation failed; rerun |
| **Rejected** | Admission refused (secret, budget, missing handler) |
| **Disabled** | JoyRide off via config |
| **Degraded** | JoyRide internal error path |

---

## Lifecycle terms

| Term | Definition |
|---|---|
| **Flush** | Remove entries for task or workspace scope |
| **Bump generation** | Increment task generation; reject late writes |
| **Shutdown** | Extension deactivate cleanup |
| **Pressure trim** | Evict entries when over memory budget |
| **Emergency trim** | Aggressive eviction to 35% of total budget |
| **Cleanup handler** | Required callback for scratch artifact disposal |
| **Late write** | Store attempt after generation bump → rejected |

---

## Classifier tiers

| Tier | Skip execution? |
|---|---|
| `safe-readonly` | Yes, when fingerprint matches |
| `verification` | Only with complete proof |
| `diagnostic-store-only` | Never |
| `no-store` | Never |

---

## Avoid (memory/brain vocabulary)

These terms describe a different product category. Do **not** use for JoyRide:

| Avoid | Use instead |
|---|---|
| memory, recall, remember | cache, entry, reuse |
| brain, mind, cognition | execution cache, hot path |
| thoughts, reflection | decision log, diagnostic |
| long-term context | session-scoped cache |
| agent knows | agent recently computed |

Exception: explicitly stating "JoyRide is **not** memory" in non-goals documentation.

---

## Industry analogues (not synonyms)

| External term | JoyRide equivalent |
|---|---|
| Turbo task hash | Cache key + validation fingerprint |
| Nx inputs | Key input dimensions (command, cwd, globs, …) |
| Bazel action key | `createJoyRideKey(namespace, parts)` |
| Redis key TTL | Entry `ttlMs` + invalidation reasons |
| HTTP ETag | Validation fingerprint on `get()` |
| Circuit breaker open | Degraded mode |

JoyRide is not Turbo, Nx, Bazel, or Redis — these mappings explain design lineage only.
