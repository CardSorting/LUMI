# JoyRide Philosophy

**Design principles and rejected alternatives for LUMI's execution cache.**

| Document | Answers |
|---|---|
| [Brief](./BRIEF.md) | *What* — executive summary |
| **Philosophy** (this doc) | *Why* — principles and tradeoffs |
| [Caching model](./CACHING.md) | *When* — hit/miss semantics |
| [Whitepaper](./WHITEPAPER.md) | *How* — full specification |

---

## Ten principles

### P1 — Cache, not memory

The foundational vocabulary rule.

| Memory implies | Cache implies |
|---|---|
| Identity, continuity, recall | Locality, speed, bounded lifetime |
| Narrative history | Invalidation and eviction |
| Cross-session persistence | Session-scoped TTL |
| "What the agent knows" | "What the agent recently computed" |

JoyRide uses operational terms only. See [Glossary](./GLOSSARY.md) for banned vocabulary.

**Lineage:** Bazel action cache and Turborepo task cache are not "build memory." JoyRide applies the same discipline to agent execution.

---

### P2 — Correctness over speed

> Fast stale state is worse than slow correct state.

JoyRide optimizes repeated *provably safe* work. Incomplete proof, unknown policy, or fingerprint mismatch → execute normally.

**Lineage:** Bazel hermetic inputs · Nx input hashing · HTTP `ETag` revalidation

---

### P3 — Fail-closed by default

Allowlist for active reuse. Unknown commands never skip. Unsafe syntax never skips. Failed verification never reused as truth.

| Tier | Skip? | Store diagnostic? |
|---|---|---|
| `safe-readonly` | Yes (fingerprint match) | Yes |
| `verification` | Only with complete proof | Yes |
| `diagnostic-store-only` | Never | Sometimes |
| `no-store` | Never | Never |

**Lineage:** OpenSSH `AllowUsers` over implicit trust · default-deny security models

---

### P4 — Typed decisions, not booleans

Every lookup returns `JoyRideCacheDecision`:

- `type` — discriminant
- `canReuse` — skip eligibility
- `reasonCode` — stable vocabulary (`JOYRIDE_REASON`)
- `fallbackBehavior` — caller obligation

**Lineage:** Rust `Result<T,E>` · HTTP status + reason · OpenTelemetry span status

Legacy `boolean | undefined` APIs were removed. Ambiguity at the call site caused policy invention.

---

### P5 — Bounded by default

| Limit | Default |
|---|---|
| Total cache | 32 MiB |
| Per entry | 512 KiB |
| Per task | 8 MiB |
| Command summary | 12 KiB (head/tail truncate) |
| Decision log | 128 entries |

Under pressure: TTL → LRU → pressure trim → emergency trim (35% target).

**Lineage:** Redis `maxmemory-policy` · Memcached slab limits

---

### P6 — Invisible but investigable

No UI. UX = behavior + explainability:

- Decision log on every lookup
- Audit trail on every active skip
- Bug-report snapshots (bounded, no secrets)
- Reason codes stable enough for contract tests

**Lineage:** Linux `perf`/`dmesg` · OpenTelemetry without dashboards

---

### P7 — Degraded, not dead

Internal JoyRide failure must not block the agent:

- Suspend active reuse
- Continue normal execution
- Record degraded reason
- Include in bug snapshots

**Lineage:** Circuit breaker — fail optimization path, not request path

---

### P8 — Contract over convention

Frozen export surface (`JOYRIDE_FROZEN_EXPORTS`). Import boundary tests. Forbidden raw cache calls. Contract drift tests in CI.

Prevents the most common failure mode: internal cache layers eroding under maintenance pressure.

**Lineage:** Protobuf field stability · Semver + API compat tests

---

### P9 — Security is admission policy

Reject secrets at the door. Count rejections. Never log raw rejected content. Diagnostics show counts, not credentials.

---

### P10 — Cleanup ownership for scratch

Scratch requires `cleanupHandler`. No handler → no admission. Flush on task end, cancel, shutdown, pressure. Idempotent cleanup.

Hidden temp buildup is an agent-runtime failure mode JoyRide explicitly prevents.

---

## Rejected alternatives

Documented for reviewers — these approaches were considered and rejected.

| Alternative | Why rejected |
|---|---|
| **Boolean cache hit API** | Call sites invented unsafe policy; no audit trail |
| **Blocklist command classifier** | Fails open as shell surface grows |
| **"Trust last test output" verification** | Highest correctness risk in agent loops |
| **Compatibility wrappers for legacy API** | Two APIs = two bugs; modern-only enforced |
| **Export `JoyRideCache` to integrations** | Raw `.get()`/`.set()` bypasses typed gates |
| **Agent memory framing** | Wrong semantics; unbounded retention expectation |
| **Dashboard / status bar UX** | Scope creep; logs + snapshots sufficient |
| **Cross-session persistence (active reuse)** | Stale state risk across workspace changes |
| **Semantic/fuzzy search cache** | Non-deterministic keys; false hits |
| **Distributed remote JoyRide tier** | Complexity; session-local sufficient for v1 |
| **GC-only scratch cleanup** | Orphaned files; no accountability |
| **Unbounded decision log** | Memory leak in long sessions |

---

## Anti-patterns

| Anti-pattern | JoyRide response |
|---|---|
| Cache everything, filter later | Classifier gates admission |
| Boolean cache hit | Typed decision + reason |
| Trust last test output | Verification proof required |
| Memory for context | Bounded TTL + flush |
| Dashboard for debug | Structured logs + snapshots |
| Internal import for speed | Import boundary tests |
| Vague reason codes | `JOYRIDE_FORBIDDEN_VAGUE_REASONS` contract |

---

## Design lineage

JoyRide adapts proven cache-system patterns — not copies:

| System | Concept borrowed |
|---|---|
| [Bazel action cache](https://bazel.build/remote/caching) | Content-addressable keys; input hashing |
| [Turborepo caching](https://turbo.build/repo/docs/core-concepts/caching) | Task hash inputs; hit/miss semantics |
| [Nx computation cache](https://nx.dev/concepts/how-caching-works) | Input-based invalidation |
| [HTTP caching RFC 9111](https://www.rfc-editor.org/rfc/rfc9111) | Validator mismatch → revalidate |
| [Redis eviction](https://redis.io/docs/reference/eviction/) | Bounded memory + policies |
| [OpenTelemetry](https://opentelemetry.io/docs/specs/otel/) | Structured observability |

JoyRide is a **session-scoped, fail-closed, typed decision cache** for VS Code agent runtime — documented with the same rigor those systems established.

---

## Decision framework for new features

Before adding JoyRide capability, answer:

1. **Is it cache or memory?** — if memory semantics, reject
2. **What are the inputs to the hash?** — document in CACHING.md
3. **What proof is required for reuse?** — default: complete proof
4. **What happens when proof fails?** — default: execute normally
5. **What is the budget and TTL?** — default: bounded
6. **What reason codes apply?** — add to `JOYRIDE_REASON`
7. **What tests prove fail-closed behavior?** — contract + dogfood
8. **Does it need UI?** — default: no

---

## Summary

JoyRide should feel like better momentum during coding sessions — not like the agent has a mind.

**Fast when safe. Silent when irrelevant. Explicit when questioned. Disabled when needed. Degraded when suspicious. Fail-closed always.**
