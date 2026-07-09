# Decisions Log (ADRs)

> **What is this?** A log of Architectural Decision Records (ADRs) tracking structural agreements, boundaries, and lifecycles.
> **When do I use it?** Before introducing new abstractions, changing completion contracts, or altering workspace data-flow spines.
> **What is the source of truth?** Approved implementation plans, user-signed ADRs, and structural design conventions.

Last audited: 2026-07-09

## ADR-001: Root continuity docs are the first agent entry point

**Status:** Accepted

**Context:** The repository already had extensive user/developer docs and an older `.wiki`, but future agents needed a direct operating layer that separated current task state from stable architecture.

**Decision:** Maintain these root files:

- `AGENT_PLAYBOOK.md` for current agent operating guidance.
- `WIKI.md` for stable workspace architecture and workflows.
- `TROUBLESHOOTING.md` for negative knowledge and reproduced failures.
- `DECISIONS.md` for root-level continuity decisions.
- `HANDOFF.md` for current working-tree state and next steps.

**Consequences:**

- Future agents can start at the root without scanning the whole docs tree.
- Stable knowledge and temporary handoff state have separate homes.
- Root docs must be kept concise and linked to deeper docs rather than duplicating them.

## ADR-002: Implementation beats stale documentation

**Status:** Accepted

**Context:** Some existing docs lagged current code. Examples found in this pass: provider count drift, stale roadmap bootstrap content, README version badge drift, and old `.wiki` DietCode/Spider claims.

**Decision:** When docs and implementation disagree, use implementation and manifests as source of truth, then update or flag stale docs.

**Consequences:**

- Provider truth comes from `src/core/api/index.ts` and `src/shared/providers/providers.json`; provider-count docs were corrected to 5 in this pass.
- Version truth comes from `package.json`; root README version references were corrected to 2.10.0 in this pass.
- Architecture truth comes from maintained docs plus current source layout.
- The roadmap and `.wiki` need explicit refresh passes before they can be treated as authoritative.

## ADR-003: Agent Playbook Method is both prompt contract and generated wiki artifact

**Status:** Accepted

**Context:** Human-oriented wiki notes did not reliably reduce future-agent rediscovery.

**Decision:** Embed the Agent Playbook Method in:

- system prompt wiki rules (`integrity_wiki.ts`),
- same-session finalization generation (`AutonomousDocumentationFinalizer.ts`),
- a workspace skill (`.agents/skills/agent-playbook-method/SKILL.md`),
- root operating docs (`AGENT_PLAYBOOK.md` and `HANDOFF.md`).

**Consequences:**

- Future finalization runs can create `.wiki/agent/*` files from workspace evidence.
- Manual wiki/playbook work has a project skill and root standard.
- Generated wiki sections should be managed and replaceable, not endlessly appended.

## ADR-004: Completion/finalization policy stays centralized

**Status:** Accepted

**Context:** The completion lifecycle decision engine was added to prevent stale audit reuse, duplicate retry loops, and agent misinterpretation.

**Decision:** New completion eligibility behavior must go through the snapshot -> decision -> action contract -> action guard spine.

**Consequences:**

- Do not add completion/finalization routing policy directly in handlers.
- Tests should verify decision output and guard behavior.
- Finalization documentation work happens after engineering verification via `run_finalization`.

## ADR-005: Use focused validation before broad validation in constrained environments

**Status:** Accepted

**Context:** Broad mocha can load unrelated tests and hit sandbox-only failures, such as roadmap progress writes under `~/.dietcode/session`.

**Decision:** For a small change, run a focused spec with `--no-config`, then production typecheck and style checks. Run broad suites when the environment supports their filesystem requirements.

**Consequences:**

- Final responses should report both focused proof and broad-suite limitations.
- Sandbox failures should be documented in `TROUBLESHOOTING.md`.
- Do not hide unrelated failures; classify them.

## ADR-006: Keep LUMI session and BroccoliDB substrate docs separate

**Status:** Accepted

**Context:** The monorepo contains the extension session layer and a substrate package with its own public API and docs.

**Decision:** Root and `docs/` should describe LUMI session behavior and link to BroccoliDB docs for substrate details. BroccoliDB-specific architecture belongs under `broccolidb/docs/`.

**Consequences:**

- `WIKI.md` can map the two layers but should not duplicate BroccoliDB internals.
- BroccoliDB changes should run BroccoliDB package tests and update BroccoliDB docs.

## ADR-007: Workspace Intelligence Engine is a finalization subsystem

**Status:** Accepted

**Context:** Prompt/wiki instructions and manual memory are not enough to preserve engineering intelligence. Completed tasks need a harness-owned learning pass that classifies durable knowledge, detects drift, and persists a structured cognitive model.

**Decision:** Add `src/core/workspace-intelligence/` as a first-class subsystem invoked by `AutonomousDocumentationFinalizer` during `run_finalization`. The engine writes a canonical `.wiki/intelligence/workspace-intelligence.json`, a scan-friendly markdown projection, optional BroccoliDB cognitive memory entries, and receipt evidence fields.

**Consequences:**

- Workspace intelligence is now part of the completion/finalization contract, not only prompt guidance.
- Knowledge is classified as permanent, operational, historical, failure, or predictive.
- Drift findings and category counts travel with finalization evidence.
- Future improvements should expand discovery signals and lifecycle hooks through this subsystem rather than scattering continuity logic across handlers.

## Open Decision Items

| Item | Needed evidence |
|---|---|
| Whether `ROADMAP.md` should be regenerated or manually repaired | Roadmap audit/checkpoint output and maintainer preference |
| Whether root continuity docs should be included in docs CI | Link-check scope and release policy |
| Whether `.wiki/00-forensics.md` should be replaced by generated current-state sections | Fresh Spider/roadmap diagnostics |
| Whether Workspace Intelligence should also observe task-start/tool-execution phases | Design pass over task lifecycle hooks, storage volume, and privacy constraints |

## ADR-008: Structuring Workspace Intelligence around Provenance and Query Services

**Status:** Accepted

**Context:** Storing raw unstructured conclusions makes facts opaque and prevents future tasks from validating why a subsystem was marked volatile or risky.

**Decision:** Commit to a two-phase evolution for the Workspace Intelligence subsystem:
1. **Provenance & Auditing:** Every derived fact/signal stored in the cognitive model must preserve its evidence trail (provenance metadata, e.g., finalization run, specific manifest, verification artifacts, or ADR file links) to answer *why* it is believed.
2. **Query Service Interface:** Evolve the architecture from a monolithic model object to a queryable domain service exposing dedicated APIs (e.g., `getSubsystemHealth()`, `getRecurringFailurePatterns()`, `getMostVolatileAreas()`) rather than expanding the schema indefinitely.

**Consequences:**
- Conclusions remain auditable by both humans and subsequent agent instances.
- Downstream features (planning, completion guidance, roadmap steering) consume structured queries rather than raw JSON structures.

## ADR-009: Fact Lifecycle Management for Workspace State Infrastructure

**Status:** Accepted

**Context:** Over time, workspace facts can linger, accumulate, or become outdated, leading to drift between the persisted cognitive model and the actual codebase.

**Decision:** Evolve the Workspace Intelligence subsystem to support a explicit fact lifecycle:
1. **Lifecycle States:** Define `WorkspaceFactLifecycle` as `"active" | "stale" | "superseded" | "disputed" | "archived"`.
2. **Management Queries:** Extend the query service to expose operations like `explainFact(factId)`, `getStaleFacts()`, and `supersedeFact(oldFactId, newFactId)` to handle conflict resolution and deprecate old conclusions.

**Consequences:**
- The intelligence reader is robust against stale assertions.
- Subsequent tasks can dynamically update or dispute existing facts based on new execution evidence.

## ADR-010: Transitioning from State Surfaces to a Unified Workspace Knowledge Schema and Projections

**Status:** Accepted

**Context:** Treating the workspace intelligence model as a set of flat "state surfaces" restricts scalability. Adding new categories (e.g. dependency graphs, ownership, test coverage) forces schema changes and pollutes the storage layer with raw presentation structures.

**Decision:** Formally define the subsystem as a **Workspace Knowledge System** and decouple storage from presentation:
1. **Unified Storage Schema:** Define a normalized database model consisting of a collection of `WorkspaceFact` entities (containing `id`, `value`, `confidence`, `provenance[]`, and `lifecycle` fields) and their relationships.
2. **Projections as Views:** Redefine the current state surfaces (e.g., `volatileSubsystems`, `stableSubsystems`) as dynamic "views" or "projections" computed by the Query Layer over the core facts database, rather than hardcoding them in the storage schema.
3. **Reasoning Invariant:** Enforce that the knowledge system only records deterministic execution evidence and parsed repository signals. Planning, heuristic interpretation, and reasoning remain the sole responsibility of the active planning model/agent, keeping the data layer clean and auditable.

**Consequences:**
- The knowledge layer can expand to capture new engineering dimensions (dependency maturity, code coverage, performance hotspots) without database migrations.
- Producers (finalizers, observers) write normalized facts, while consumers (wiki projection, agent playbook, system prompt) retrieve query-driven views.



