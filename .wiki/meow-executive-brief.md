# Dependency-Oriented High-Throughput Execution Architecture

## Executive Brief

**Status:** Canonical architecture reference  
**Audience:** Maintainers, reviewers, contributors, and project leads  
**Scope:** Task execution, dependency scheduling, structured concurrency, presentation, completion, caching, auditing, and lifecycle management within `src/core/task/`.

## Executive Summary

The execution engine was historically optimized for correctness through conservative serialization. Although safe, this design allowed presentation, governance, and bookkeeping concerns to occupy portions of the critical path without materially improving correctness. Independent sibling tools waited behind one another, shared presentation state acted as an accidental execution lock, and advisory persistence could delay results whose validity had already been established.

This work replaces that model with dependency-oriented execution.

Throughput is the outcome; dependencies, resource ownership, and authoritative completion are the governing principles. Eligible sibling operations can execute concurrently under a bounded, task-owned scheduler. Conflicting, prerequisite-bound, interactive, and conservatively classified operations remain ordered. Batch results are projected deterministically. The critical path is narrower than before, although completion still contains synchronous audit evaluation, optional workspace-artifact persistence, UI persistence, and checkpoint work.

This is not merely a local performance optimization. For model turns that expose an eligible sibling batch, it changes admission from presenter-driven sequencing to dependency-constrained scheduling.

## Problem Statement

The previous execution path treated a model response as a sequential series of tool invocations:

```text
model response
    -> presentation ownership
    -> execute one tool
    -> update shared state
    -> admit the next tool
    -> repeat
```

Presentation controlled execution, execution controlled admission, and shared UI state became an implicit scheduler. Operations with no dependency or resource conflict were serialized because they shared presentation machinery rather than because correctness required ordering.

Completion had similar coupling. Diagnostics, audit persistence, roadmap bookkeeping, and other advisory work could remain on the response path even after the requested work had been validated successfully.

The architecture therefore conflated four distinct concerns:

* execution eligibility
* safety and governance
* visual presentation
* durable observability

The redesign separates those concerns and gives each one an explicit contract.

## Architectural Transformation

A contiguous group of complete tool blocks is interpreted as a dependency-constrained batch when parallel tool calling is enabled and the group contains more than one tool:

```text
model response
    -> dependency and resource classification
    -> bounded task-owned scheduling
    -> concurrent independent tool children
    -> deterministic result projection
    -> authoritative completion
    -> deferred completion-audit and roadmap persistence
```

Within that batch, execution eligibility is determined by model-emission dependencies, conservative resource claims, checkpoint readiness, and safety boundaries. Outside the batch path, the existing single-tool presentation flow remains in service.

For workspace-local query siblings, presentation is captured per invocation and replayed after execution in canonical order. Interactive and non-query tools retain shared presentation constraints and are conservatively ordered.

## Architectural Principles

### 1. Dependency-Oriented Execution

Eligible independent siblings should begin independently.

Ordering is introduced only when required by:

* an explicit prerequisite
* a tool-result reference
* a shared resource
* a mutation conflict
* an approval boundary
* a completion barrier
* another correctness-bearing constraint

Model-emission order determines canonical presentation, not execution eligibility.

### 2. Resource-Oriented Coordination

Coordination is scoped to the resource being protected.

Relevant resources include:

* normalized filesystem targets
* diff-buffer ownership
* terminal process ownership
* shared environment state
* approval channels
* checkpoint-sensitive mutations
* workspace-wide mutation scope

The current classifier permits read/read independence and permits queries to overlap a mutation when their claims do not conflict. It deliberately serializes every classified mutation against every other classified mutation through the `workspace-mutation` claim, even when file targets differ.

### 3. Risk-Proportional Governance

Governance exists to contain concrete material risk, not to serve as a general-purpose scheduler.

Synchronous blocking is reserved for work that is:

* destructive
* protected
* externally visible
* approval-bound
* credential-sensitive
* mutually conflicting
* checkpoint-dependent
* directly invalid

Advisory uncertainty should produce evidence, diagnostics, or bounded fallback behavior—not automatic execution paralysis.

### 4. Authoritative Completion

Completion is the single point at which required work has been validated and determined correct.

Completion is not redefined by the settlement of every supporting subsystem.

The following are currently scheduled after result presentation where implemented:

* audit persistence
* roadmap journaling
* completion-audit persistence
* roadmap finalization

Completion audit evaluation is still performed before the authoritative decision, and optional audit workspace artifacts are persisted synchronously when enabled. Completion-message persistence and checkpoint saving also remain awaited after presentation. These are residual critical-path mechanisms, not claims of fully asynchronous completion.

### 5. Deterministic Projection

Execution order and presentation order are intentionally separate.

Eligible sibling operations may start and finish out of order. The batch executor returns envelopes in model-emission sequence, replays captured query presentation in that order, and appends tool-result content in that order.

This preserves responsiveness without making the user experience nondeterministic.

### 6. Structured Concurrency

Every child admitted through `SiblingToolScheduler` is:

* owned by its parent task
* bounded by scheduler capacity
* cancellable through task lifecycle
* attributable to one invocation
* joined before finalization
* represented by an isolated result envelope

Task abort cancels the active scheduler, and task abort handling waits for the active batch promise. The scheduler itself waits for every `run` promise to settle; prompt interruption inside a tool still depends on that tool honoring the supplied `AbortSignal`.

## Implementation Mechanisms

The architecture is implemented through the following components.

### `TaskLatencyTracker.ts`

Records bounded, monotonic lifecycle evidence from task admission through deferred persistence.

Instrumentation is advisory and fail-open. It must never become a receipt requirement, execution gate, or synchronous persistence dependency.

### `SiblingToolDependency.ts`

Classifies sibling operations and produces:

* canonical resource claims
* conflict edges
* prerequisite edges
* explicit result-reference edges
* completion barriers
* workspace-wide fences for unknown mutations

The classifier makes previously implicit ordering rules explicit and testable.

### `SiblingToolScheduler.ts`

Provides bounded, task-owned execution with:

* constructor-configurable fan-out; the task path currently passes the default capacity of four
* dependency-aware admission
* cancellation propagation
* deterministic joining
* queue and execution evidence
* dependency-local failure handling
* partial-success preservation

The scheduler does not manufacture concurrency. It permits concurrency where the conservative dependency model finds no earlier edge and capacity is available.

### `ToolInvocationContext.ts`

Provides invocation-local evidence and presentation capture.

The batch path uses invocation-local result storage for all children and captures presentation events for workspace-local queries. Non-query and approval-sensitive children continue to use shared presentation surfaces and corresponding conflict claims.

### `ToolExecutor.ts`

Produces isolated tool outcomes and advances cache generations after qualifying mutations.

Execution evidence remains associated with the invocation that produced it, regardless of completion order.

### `IoRequestCoalescer.ts`

Defines cache and request-coalescing identity through:

* canonical target
* cache generation
* operation type
* result-affecting inputs

Qualifying local mutations replace the task's coalescer with a new task-wide generation. An older in-flight operation may finish for its original caller and populate its old coalescer object, but cannot populate the replacement generation.

### `AttemptCompletionHandler.ts`

Evaluates the canonical completion lifecycle and action guard once per completion attempt, then runs advisory completion diagnostics and audit evaluation before latching the authoritative result.

It is the correctness-bearing completion boundary.

### `completionAudit.ts` and Task Pending-Persistence State

Schedule pending completion-audit persistence after result presentation and roadmap finalization after completion handling reaches its finalization branch.

Those two scheduled operations are off the response path. Optional audit workspace-artifact persistence, completion-message persistence, and checkpoint saving remain synchronous today.

## Measured Evidence

Deterministic scheduler workloads demonstrate lower wall-clock latency for independent operations while preserving required serialization.

| Workload | Sequential estimate | Concurrent wall time | Observed behavior |
| --- | ---: | ---: | --- |
| Four independent reads | 280 ms | 100 ms | Four-way concurrency |
| Two reads and two searches | 290 ms | 100 ms | Four-way concurrency |
| Diagnostic and read-only command | 220 ms | 140 ms | Independent execution lanes overlap |
| Mutation and two disjoint reads | 230 ms | 120 ms | Governed mutation overlaps non-conflicting reads |
| Overlapping mutations | 200 ms | 200 ms | Intentionally serialized |
| One failed sibling and two successes | 190 ms | 100 ms | Successful independent results preserved |

These fixtures validate scheduler behavior and latency accounting. They are deterministic test measurements, not live provider or extension-host benchmarks.

`TaskLatencyTracker.test.ts` verifies the lifecycle evidence surface across:

* task admission
* first model token
* tool recognition
* first visible progress
* dispatch
* first useful I/O
* completion decision
* result projection
* deferred persistence

Task latency snapshots are the implementation's host/provider observation surface; this documentation contains no recorded live-provider benchmark.

Evidence is separated by provenance:

* **Current grounding pass (2026-07-12):** 44 focused dependency, scheduler, batch, cache, latency, and completion-audit tests passed; documentation links and diff whitespace passed.
* **Recorded implementation-pass evidence:** 2,263 passing unit tests, 4 expected pending tests, 5 passing targeted presentation-failure regressions, plus successful TypeScript, lint, and roadmap-audit runs.
* **Not measured:** live model-provider latency, webview latency, real filesystem/subprocess speedup, and production false-blocker frequency.

## Preserved Safety Guarantees

The affected paths continue to invoke the existing correctness-bearing boundaries, including:

* `.dietcodeignore`
* workspace-boundary enforcement
* external-path controls
* protected resources
* credential restrictions
* destructive and manual approvals
* first-mutation checkpoint readiness
* mutation conflict detection
* cancellation
* rollback
* receipt integrity
* external publication controls
* direct validation failures

The sibling classifier does not bypass these checks; each admitted child still executes through `ToolExecutor` and its normal local validation path.

The system is faster because coordination is more precise, not because protection has been removed.

## Intentional Serialization

The following remain serialized because they protect concrete shared resources or protocol decisions:

* shared foreground terminal-process ownership
* interactive approval through a single response channel
* commands that mutate shared environment state
* all sibling mutations under the current task-wide `workspace-mutation` claim, which also avoids concurrent use of shared mutation/presentation machinery
* completion barriers
* unresolved prerequisites and tool-result references

These are architectural constraints, not presentation ceremony.

Future concurrency should be introduced only when a narrower ownership boundary, isolated invocation state, or reversible commit protocol proves that the existing serialization is broader than necessary.

## Evolution Rule

Future optimization work must follow an evidence-driven sequence:

1. Measure the actual critical path.
2. Identify the exact source of contention.
3. Determine whether serialization protects correctness or merely reflects shared implementation state.
4. Narrow coordination to the smallest valid resource boundary.
5. Preserve task ownership and authoritative completion.
6. Verify the change with deterministic correctness and latency evidence.

Do not introduce a new global coordinator, lifecycle gate, synchronization layer, or mandatory receipt without demonstrating a concrete correctness requirement that cannot be enforced more narrowly.

The architecture should evolve through increasingly precise ownership—not increasingly elaborate ceremony.

> **Architectural thesis:** Execution should be constrained by dependencies, resource ownership, and concrete risk—not by presentation order, procedural ceremony, or advisory infrastructure.
