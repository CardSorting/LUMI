# Dependency-Oriented High-Throughput Execution Philosophy

This document defines the reasoning behind the Dependency-Oriented High-Throughput Execution Architecture. It is normative for future contributors: extend the implementation in ways that preserve these principles, and treat a departure as an architectural decision rather than a local convenience.

The document separates **principles** (desired design constraints), **mechanisms** (the implementation that exists), and **evidence** (measurements and tests). A principle is not evidence that the current implementation satisfies it universally. Where the implementation is narrower, the mechanism description governs claims about present behavior.

## Execution is the product

The system exists to turn an authorized task into useful, correct work. Governance, audit, diagnostics, and presentation are support systems for that outcome. They must be strong where a concrete failure can occur and quiet where they cannot affect the decision. A safe operation that waits for an unrelated receipt, re-acquires an existing authority, or re-runs a settled validation is not safer; it is merely slower and harder to reason about.

Latency is therefore part of correctness at the experience boundary. The implementation records time to first model token, first recognized tool, first useful I/O, visible progress, authoritative completion, and final presentation. This makes delay an engineering fact instead of an impression. Instrumentation is advisory: it cannot become a new prerequisite for execution.

## Evidence over speculation

Investigation should terminate when the system has enough evidence to act. Source code, deterministic tests, runtime events, version-control state, and latency snapshots are stronger than repeated plans or hypothetical risks. When uncertainty can be resolved by a bounded read, a dependency classification, a reversible operation, or a focused test, perform that work. Treat incomplete evidence as incomplete—not as proof that execution is unsafe.

## Risk proportionality

Governance cost scales with material risk. A workspace read, repository search, diagnostic, or local reversible change uses the fast path and existing task authority. A protected-path write, external publication, destructive command, credential operation, or unresolved mutation conflict uses the governed path. The distinction is explicit in the sibling dependency model (`SiblingToolDependency.ts`), not inferred from general unease.

The safety rule is precise:

```text
advisory system + non-critical failure -> record and continue
destructive/externally visible decision + unresolved failure -> stop that operation
```

Scheduled completion-audit persistence and roadmap finalization are best-effort after presentation. Completion audit evaluation still runs before the authoritative decision, and optional audit workspace-artifact persistence is awaited but catches and logs its own failure. Workspace boundaries, approvals, rollback, receipt integrity, and direct validation retain their existing blocking behavior.

## Optimistic execution with deterministic validation

Optimism means starting work when the evidence is sufficient, not ignoring constraints. Eligible sibling batches receive conservative resource claims and backward dependency edges. The scheduler starts nodes with no unresolved edge. The completion handler evaluates one lifecycle/action-guard decision per attempt, while additional advisory diagnostics and persistence work still exist around that decision.

## Bounded concurrency and structured cancellation

Concurrency is useful only when it is owned, bounded, and attributable. `SiblingToolScheduler` gives each admitted node a scheduler-owned abort signal, sequence number, and result envelope; the task path uses a capacity of four. Task abort cancels the active scheduler and waits for the batch promise. Active work stops promptly only when its tool stack honors the signal. Independent failure is local to the child unless a prerequisite edge makes another child depend on it.

## Authority is durable within scope

An operation should not repeatedly reacquire authority that the task already holds. Authority lasts for the valid operation scope and narrows when the resource scope narrows. This avoids procedural hesitation while preserving protected-path, approval, checkpoint, and mutation-conflict boundaries. A scope change is a reason to reclassify; a repeated observation of the same scope is not.

## Local reasoning beats global coordination

Resource identity is narrow for queries and path targets, but deliberately conservative elsewhere. All mutations share a `workspace-mutation` write claim. Mutating commands and unknown tools use a workspace-wide fence. Read-only verification commands share one command-lane claim. This means the current mechanism does not yet provide file-level parallel mutation even when targets differ.

## Presentation is a projection, not a scheduler

Users need stable output, not presentation-driven serialization. Invocation-local contexts isolate result content for scheduled children and capture presentation events for workspace-local queries. Results may complete out of order; the scheduler returns envelopes and the batch projection replays them in model-emission order. A captured query-card replay failure does not erase its result content. Interactive and non-query presentation still uses shared state.

## Authoritative decision points

One component owns each decision: the dependency model classifies conflicts, the scheduler owns readiness and cancellation, and the completion handler owns final validity. Downstream layers consume those results instead of reconstructing the same decision. This is simpler, faster, and more auditable than recursive validation.

## Momentum with honest failure

Forward progress does not mean hiding failure. A failed independent query is represented beside successful siblings. A failed prerequisite blocks only its dependents. A rejected destructive action remains rejected. A cancellation stops the task promptly. Partial success is useful only when it is represented deterministically and attributed to the correct invocation.

## Simplicity over ceremonial governance

Every gate must answer: what concrete material failure does this prevent, and why is it on this path? If a check cannot change the execution decision, move it after execution or make it advisory. Do not add a coordinator to manage coordinators, a receipt to approve a receipt, or a lifecycle state solely to narrate a wait. The preferred optimization is deletion or narrowing of machinery.

## Investigation terminates in implementation

The architecture values measured bottlenecks over theoretical elegance. A latency trace, a deterministic barrier test, or a reproducible queue wait should lead to a small change and a verification pass. Reopening settled decisions without new evidence is itself throughput debt. Future contributors should preserve the current boundaries and change only the contention that evidence identifies.
