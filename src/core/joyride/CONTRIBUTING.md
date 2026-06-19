# Contributing to JoyRide

Thank you for contributing to **JoyRide** — LUMI's bounded typed execution cache.

JoyRide is production infrastructure. Changes must preserve fail-closed behavior, typed decisions, import boundaries, and contract test coverage. This guide follows the contributor patterns used by mature cache systems (Turbo, Nx, Redis): **read concepts → understand inputs → change code → prove with tests → update docs**.

---

## Table of contents

1. [Before you start](#before-you-start)
2. [Development setup](#development-setup)
3. [Architecture orientation](#architecture-orientation)
4. [Change categories](#change-categories)
5. [Adding a JoyRide-backed hot path](#adding-a-joyride-backed-hot-path)
6. [Testing requirements](#testing-requirements)
7. [Reason codes](#reason-codes)
8. [Contract and API changes](#contract-and-api-changes)
9. [Documentation requirements](#documentation-requirements)
10. [Pull request checklist](#pull-request-checklist)
11. [Review criteria](#review-criteria)
12. [What we reject](#what-we-reject)
13. [License](#license)

---

## Before you start

Read in order:

| Step | Document | Time |
|---|---|---|
| 1 | [Brief](./docs/BRIEF.md) | 5 min |
| 2 | [Caching model](./docs/CACHING.md) | 15 min |
| 3 | [Philosophy](./docs/PHILOSOPHY.md) | 15 min |
| 4 | [API reference](./docs/API.md) | reference |

If you are changing verification, search, or classifier behavior, also read [Whitepaper](./docs/WHITEPAPER.md) sections 8–11.

**Non-negotiable vocabulary:** JoyRide is **cache**, not memory. Do not introduce brain, memory, recall, or cognition language in code, docs, or comments.

---

## Development setup

```bash
# From repository root
npm install

# Run JoyRide tests only
npm run test:unit -- --grep "JoyRide"

# Run a single suite
npm run test:unit -- --grep "JoyRideContractDrift"

# Run full unit suite (CI parity)
npm run test:unit
```

Test helpers live in `__tests__/JoyRideTestHelpers.ts`:

```typescript
import {
  createJoyRideTestCache,
  createTaskScope,
  expectCacheHit,
  expectNoActiveReuse,
  assertDecisionInvariants,
} from "./JoyRideTestHelpers"
```

**Important:** `createJoyRideTestCache()` resets config to `enabled`. Set `disabled` / `degraded` **after** calling it, not before.

---

## Architecture orientation

```
Integrations (4 files) → @core/joyride → JoyRideHotPath → JoyRideCache (internal)
                              ↓
                    Classifier · Verification · Context
```

| Layer | You may edit | You may import from integrations |
|---|---|---|
| `index.ts` | Contract reviewers only | `@core/joyride` only |
| `JoyRideHotPath.ts` | Hot-path engineers | — |
| `JoyRideCache.ts` | Cache maintainers | **Never** |
| `keys.ts` | Cache maintainers | **Never** |
| Runtime integrations | Integration engineers | `@core/joyride` only |

Approved integration files (`JoyRideContract.ts`):

- `src/core/task/index.ts`
- `src/core/task/tools/handlers/SearchFilesToolHandler.ts`
- `src/core/task/tools/handlers/AttemptCompletionHandler.ts`
- `src/extension.ts`

---

## Change categories

| Category | Examples | Bar |
|---|---|---|
| **Bug fix** | Incorrect stale detection, secret false negative | Test repro + regression test |
| **Hot-path integration** | Wire new tool through typed lookup | Contract + dogfood test |
| **Classifier allowlist** | Add safe-readonly command | Allowlist test + security review |
| **Reason code** | New miss/stale code | Uniqueness test + docs |
| **Config** | New env flag | Config contract test |
| **Performance** | Lookup optimization | Benchmark gate must pass |
| **Public API** | New export | Contract review + drift test update |
| **Docs only** | README, whitepaper | GaReadiness cross-links |

---

## Adding a JoyRide-backed hot path

### Step 1 — Define inputs

Document what goes into the cache key and validation fingerprint. Use [Caching model](./docs/CACHING.md) as template.

Ask:

- What dimensions change should invalidate reuse?
- What proof is required before skipping work?
- What is the TTL and cache kind?

### Step 2 — Use typed helpers only

```typescript
import {
  getJoyRideCache,
  createJoyRideTaskScope,
  isJoyRideHitDecision,
  lookupSafeCommandResult, // or lookupSearchResult, lookupVerificationProof
  registerTaskLifecycle,
  storeReusableCommandResult,
} from "@core/joyride"
```

**Never:**

```typescript
// FORBIDDEN
import { JoyRideCache } from "../joyride/JoyRideCache"
getJoyRideCache().get(key)
getJoyRideCache().set(key, value)
if (decision.canReuse) { ... }  // without isJoyRideHitDecision
```

### Step 3 — Handle every decision path

```typescript
const decision = await lookupSafeCommandResult(cache, command, scope)
assertDecisionInvariants(decision) // in tests

if (isJoyRideHitDecision(decision)) {
  return decision.value
}

// Follow decision.fallbackBehavior — do not invent policy
const result = await execute(command)
await storeReusableCommandResult(cache, command, result, scope)
return result
```

### Step 4 — Register lifecycle

```typescript
registerTaskLifecycle(cache, taskId, scope.generation)
// On cancel: bumpTaskGeneration + flushTaskGeneration
// On complete: flushTaskGeneration
```

### Step 5 — Add tests

Minimum for a new hot path:

| Test | Suite location |
|---|---|
| Hit when inputs match | New test or `JoyRideRealSession.test.ts` |
| Miss when disabled | Config contract pattern |
| Miss when diagnostics-only | Config contract pattern |
| No reuse when degraded | Degraded contract pattern |
| Stale when fingerprint changes | Focused invalidation test |
| Unsafe input refused | Classifier or hardening test |
| Decision invariants | `assertDecisionInvariants()` |

### Step 6 — Update docs

- [Caching model](./docs/CACHING.md) input table (if new dimensions)
- [API reference](./docs/API.md) (if new public function)
- [Troubleshooting](./docs/TROUBLESHOOTING.md) (if new failure mode)

---

## Testing requirements

### Always run

```bash
npm run test:unit -- --grep "JoyRide"
```

### Suite matrix

| Change touches… | Required suites |
|---|---|
| Public exports | `JoyRideContractDrift`, `JoyRideModernApi` |
| Integration imports | `JoyRideImportBoundary` |
| Decisions | `JoyRideDecisionInvariants` |
| Config / modes | `JoyRideConfigContract`, `JoyRideDegradedContract` |
| Reason codes | `JoyRideReasonCodes` |
| Verification | `JoyRideVerificationGa` |
| Search | `JoyRideSearchGa` |
| Scratch | `JoyRideScratchGa` |
| Performance | `JoyRideBenchmark` |
| Session behavior | `JoyRideRealSession` |

### Test patterns

```typescript
// Config modes — set AFTER createJoyRideTestCache()
const cache = createJoyRideTestCache()
setJoyRideConfig({ mode: "disabled" })

// Expect no skip
expectNoActiveReuse(decision)

// Expect hit
expectCacheHit(decision)
expectDecisionReason(decision, JOYRIDE_REASON.HIT_COMMAND_SAFE_ALLOWLISTED)
```

---

## Reason codes

Reason codes are part of the operational contract — not debug strings.

### Rules

1. Use existing `JOYRIDE_REASON` codes when possible
2. New codes must use approved prefix: `hit.` `miss.` `stale.` `reject.` `degraded.` `trim.` `cleanup.` `lifecycle.`
3. Must explain a **real operational cause**
4. Must not use vague fragments: `unknown`, `invalid`, `failed`, `skipped`, `error` as standalone codes
5. Exception: `miss.command.unknown` is the deliberate unknown-command code

### Adding a new code

1. Add to `JoyRideReasonCodes.ts`
2. Update `JoyRideReasonCodes.test.ts` expectations
3. Document in [Whitepaper Appendix A](./docs/WHITEPAPER.md#appendix-a-reason-code-catalog)
4. Use in production path — do not add dead codes

---

## Contract and API changes

The public API is **frozen** (`JOYRIDE_FROZEN_EXPORTS` in `JoyRideContract.ts`).

### To add a public export

1. Justify in PR — why integration cannot use existing helpers
2. Add to `index.ts`
3. Add to `JOYRIDE_FROZEN_EXPORTS`
4. Update `JoyRideContractDrift.test.ts` if needed
5. Update [API reference](./docs/API.md)
6. Security + architecture review required

### Never re-export

- `JoyRideCache` class
- Key builders (`create*CacheKey`)
- Decision constructors (`hitDecision`, etc.)
- Legacy APIs (`lookupCommandResult`, etc.)
- Test-only helpers (`resetJoyRideForTest`)

---

## Documentation requirements

| Change | Update |
|---|---|
| Any public API change | `API.md`, `JoyRideContract.ts` |
| New cache kind or inputs | `CACHING.md`, whitepaper §5–7 |
| New reason code | Whitepaper Appendix A |
| New allowlist command | Whitepaper Appendix B + classifier tests |
| New config env var | `README.md`, operator guide, whitepaper §14 |
| New failure mode | `TROUBLESHOOTING.md` |
| Philosophy shift | `PHILOSOPHY.md` rejected alternatives table |

Docs are enforced by `JoyRideGaReadiness.test.ts`.

---

## Pull request checklist

Copy into your PR description:

```markdown
## JoyRide PR checklist

- [ ] Imports only from `@core/joyride` in integration files
- [ ] No raw `getJoyRideCache().get/set/trySet` calls
- [ ] Uses `isJoyRideHitDecision()` before skipping work
- [ ] Handles `fallbackBehavior` — no hand-rolled policy
- [ ] Reason codes are precise and prefixed
- [ ] Tests: enabled, disabled, diagnostics-only, degraded (as applicable)
- [ ] Tests: stale invalidation and unsafe refusal (as applicable)
- [ ] `npm run test:unit -- --grep "JoyRide"` passes
- [ ] Docs updated (API, CACHING, TROUBLESHOOTING, or whitepaper)
- [ ] No UI added
- [ ] No legacy API reintroduced
- [ ] No memory/brain vocabulary
- [ ] Contract files updated if public surface changed
```

---

## Review criteria

Reviewers evaluate against:

| Criterion | Question |
|---|---|
| **Correctness** | Can this cause stale or unsafe reuse? |
| **Fail-closed** | Does unknown input default to execute? |
| **Bounds** | Is retention TTL/size bounded? |
| **Secrets** | Could credentials enter cache or diagnostics? |
| **Observability** | Are reason codes and decisions auditable? |
| **Contract** | Does drift test pass? |
| **Docs** | Are inputs and invalidation documented? |

---

## What we reject

| Proposal | Why |
|---|---|
| Boolean cache hit API | Typed decisions required |
| Blocklist-only command classifier | Fails open |
| Export `JoyRideCache` | Bypasses typed gates |
| Compatibility wrappers | Two APIs = two bugs |
| Agent memory framing | Wrong semantics |
| UI / dashboard | Out of scope |
| Unbounded logs or caches | Memory risk |
| Verification without proof | Correctness risk |
| Vague reason codes | Unoperational |

See [Philosophy §Rejected alternatives](./docs/PHILOSOPHY.md#rejected-alternatives).

---

## Getting help

| Need | Resource |
|---|---|
| How caching works | [CACHING.md](./docs/CACHING.md) |
| Debug reuse issue | [TROUBLESHOOTING.md](./docs/TROUBLESHOOTING.md) |
| Full specification | [WHITEPAPER.md](./docs/WHITEPAPER.md) |
| Term definitions | [GLOSSARY.md](./docs/GLOSSARY.md) |

---

## License

By contributing to JoyRide, you agree that your contributions will be licensed under the [MIT License](./LICENSE) Copyright (c) CardSorting.

The broader LUMI repository may be licensed separately. JoyRide source and documentation in `src/core/joyride/` are MIT-licensed by CardSorting unless otherwise noted.
