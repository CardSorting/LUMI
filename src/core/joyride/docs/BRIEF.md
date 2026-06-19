# JoyRide Brief

**Executive summary — LUMI typed execution cache**

| | |
|---|---|
| **What** | Bounded in-process cache for agent command, search, and verification hot paths |
| **Why** | Repeated safe work should not re-execute; unsafe reuse must not happen silently |
| **Status** | GA — 179+ contract tests, frozen API, no UI |
| **Kill switch** | `JOYRIDE_MODE=disabled` |

Full documentation: [docs/README.md](./README.md)

---

## Problem

Agent coding sessions repeat expensive operations:

```
inspect → edit → command → verify → search → inspect → ...
```

Without caching: every loop pays full latency. With naive caching: stale tests pass, secrets persist, memory grows, unknown commands skip execution.

## Solution

**JoyRide** returns a typed decision on every lookup — hit, miss, stale, rejected, disabled, or degraded — with stable reason codes and explicit fallback behavior. Reuse occurs only when policy and proof allow it.

JoyRide is **cache infrastructure**, not agent memory.

---

## Value proposition

| Stakeholder | Benefit |
|---|---|
| **Users** | Faster iteration on repeated safe operations (status, search) |
| **Engineering** | Fail-closed correctness; instant disable; no UI debt |
| **Support** | Bug-report snapshots + reason codes; no secret leakage |
| **Security** | Admission rejection for credentials; allowlist command reuse |

---

## What JoyRide accelerates

| Operation | Reuse when… |
|---|---|
| Safe-readonly commands | Allowlist match + workspace fingerprint |
| Workspace search | Identical query, cwd, globs, generation |
| Verification | Complete file-hash + workspace proof |
| Scratch artifacts | Retained only — never skips work |

---

## What JoyRide refuses

| Refusal | Mechanism |
|---|---|
| Unknown commands (skip) | Classifier: `miss.command.unknown` |
| Unsafe shell syntax | Classifier: `miss.command.unsafeSyntax` |
| Verification without proof | `miss.verification.*` |
| Secret-bearing output | `reject.secretDetected` |
| Failed test as truth | `diagnosticOnly` storage |
| Late writes after cancel | `reject.lateWrite` |

---

## Operational modes

| Mode | Store | Skip work | Use case |
|---|---|---|---|
| **enabled** | ✓ | ✓ when safe | Production default |
| **diagnostics-only** | ✓ | ✗ | Observe without risk |
| **disabled** | ✗ | ✗ | Incident response |
| **degraded** | best-effort | ✗ | Internal failure recovery |

---

## Guarantees (G1–G8)

1. **Correctness over speed** — incomplete proof → execute
2. **Typed decisions** — no boolean cache API
3. **Bounded resources** — 32 MiB default, pressure trim
4. **No silent cache failure** — degraded suspends reuse
5. **Inspectable** — decision log, audit trail, snapshots
6. **Contract-tested** — frozen exports, import boundaries
7. **Secret-safe admission** — reject + count, never log raw
8. **Cleanup-owned scratch** — mandatory handlers

---

## Risk register

| Risk | Mitigation | Residual |
|---|---|---|
| Stale verification reuse | 10-dimension proof gate | Low — fail-closed |
| Secret retention | Pattern scan at admission | Low — false positives possible |
| Memory growth | Multi-level budgets + trim | Low |
| Classifier bypass | Allowlist + unsafe-syntax scan | Low — requires code change to extend |
| Architectural drift | Contract drift tests | Low — CI enforced |
| Cache layer crash | Degraded mode | None — agent continues |

---

## Non-goals

- UI, dashboards, status-bar controls
- Cross-session agent memory
- Caching LLM reasoning or plans
- Approval boundary bypass
- Distributed / remote cache tier (today)
- Anthropomorphic naming

---

## Architecture

```
Integrations → JoyRideHotPath → JoyRideCache
                  ↓
            Classifier · Verification · Fingerprints
```

Single import: `@core/joyride`. Legacy APIs removed.

---

## Maturity indicators

| Indicator | Status |
|---|---|
| Real-session dogfood tests | ✓ 11 scenarios |
| Contract drift prevention | ✓ frozen exports |
| Performance gates | ✓ benchmark suite |
| Contributor documentation | ✓ README + API + caching model |
| Operator runbook | ✓ troubleshooting guide |
| GA release notes | ✓ published |

---

## Further reading

| Document | Link |
|---|---|
| Documentation hub | [docs/README.md](./README.md) |
| Design philosophy | [PHILOSOPHY.md](./PHILOSOPHY.md) |
| How caching works | [CACHING.md](./CACHING.md) |
| Technical whitepaper | [WHITEPAPER.md](./WHITEPAPER.md) |
| Package README | [../README.md](../README.md) |

**Tagline:** Fast when safe. Silent when irrelevant. Explicit when questioned. Disabled when needed. Degraded when suspicious. Fail-closed always.
