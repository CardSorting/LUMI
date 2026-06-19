# JoyRide Documentation

**Documentation map for LUMI's typed execution cache.**

JoyRide docs follow the layered structure used by mature cache systems (Turbo task cache, Nx computation cache, Bazel action cache, Redis operations manuals): **Concepts → How it works → Reference → Operations**.

---

## Reading paths by role

| Role | Start here | Then read |
|---|---|---|
| **Executive / PM** | [Brief](./BRIEF.md) | [Philosophy §P1–P3](./PHILOSOPHY.md) |
| **Architect / reviewer** | [Philosophy](./PHILOSOPHY.md) | [Whitepaper](./WHITEPAPER.md) · [Caching model](./CACHING.md) |
| **Contributor** | [CONTRIBUTING.md](../CONTRIBUTING.md) | [Caching model](./CACHING.md) · [API](./API.md) |
| **Operator / support** | [Operator guide](../../../docs/features/joyride.mdx) | [Troubleshooting](./TROUBLESHOOTING.md) |
| **Auditor / security** | [Whitepaper §13](./WHITEPAPER.md#13-security-model) | [Philosophy §9](./PHILOSOPHY.md) · [Contract](../JoyRideContract.ts) |

---

## Document catalog

### Concepts (why)

| Document | Description |
|---|---|
| [Brief](./BRIEF.md) | One-page executive summary — problem, solution, guarantees |
| [Philosophy](./PHILOSOPHY.md) | Design principles, rejected alternatives, industry lineage |
| [Glossary](./GLOSSARY.md) | Canonical terminology (cache vs memory vocabulary) |

### How it works (what happens)

| Document | Description |
|---|---|
| [Caching model](./CACHING.md) | Inputs → hash → hit/miss flow (Turbo/Nx-style) |
| [Whitepaper](./WHITEPAPER.md) | Full technical specification with appendices |

### Reference (API and vocabulary)

| Document | Description |
|---|---|
| [API reference](./API.md) | Frozen public surface, lookup/store matrix |
| [Contributing guide](../CONTRIBUTING.md) | Hot path workflow, tests, PR checklist |
| [Package README](../README.md) | Quick start, module map |
| [LICENSE](../LICENSE) | MIT — Copyright CardSorting |
| `JoyRideReasonCodes.ts` | Stable `JOYRIDE_REASON` vocabulary (source of truth) |
| `JoyRideContract.ts` | Export/import contract (source of truth) |

### Operations (run and debug)

| Document | Description |
|---|---|
| [Troubleshooting](./TROUBLESHOOTING.md) | Symptom → cause → action runbook |
| [Operator guide](../../../docs/features/joyride.mdx) | Config, diagnostics, disable |
| [Release notes](../../../docs/features/joyride-release-notes.mdx) | GA changelog |

---

## Documentation conventions

Following patterns from Turbo, Nx, and Redis docs:

1. **Cache, not memory** — operational vocabulary only; no anthropomorphic terms
2. **Inputs define reuse** — document what goes into keys and validation fingerprints
3. **Explicit hit/miss/stale** — never imply boolean cache semantics
4. **Fail-closed defaults** — document what is refused before what is allowed
5. **No UI assumption** — observability through logs, snapshots, and tests
6. **Contract-tested claims** — guarantees in docs map to test suites

---

## Status

| Metric | Value |
|---|---|
| API status | GA — modern-only, frozen exports |
| Test suites | 179+ unit tests (`npm run test:unit -- --grep "JoyRide"`) |
| Public entrypoint | `@core/joyride` |
| Implementation | `src/core/joyride/` |
| License | MIT — [CardSorting](../LICENSE) |

---

## Quick links

```bash
# Run JoyRide tests
npm run test:unit -- --grep "JoyRide"

# Disable JoyRide instantly
JOYRIDE_MODE=disabled code .

# Diagnostics-only (observe without skipping)
JOYRIDE_MODE=diagnostics-only code .
```
