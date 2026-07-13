# MEOW/ACC: Implementation and Operations Guide

This guide describes the operational surfaces, instrumentation, benchmarks, validation protocols, and failure modes of the Model-Efficient Order-aware Workflow Acceleration Profile (**MEOW/ACC**).

---

## 1. Hot Paths

The optimized critical-path operations are concentrated in the following source files:

* **Task Entry & Scheduling:**
  * [src/core/task/index.ts](file:///Users/bozoegg/Downloads/codemarie-new/src/core/task/index.ts): Handles task entry, coordinates the outer loop, manages the lifecycle abort signals, and projects finished results.
  * [src/core/task/tools/siblings/SiblingToolScheduler.ts](file:///Users/bozoegg/Downloads/codemarie-new/src/core/task/tools/siblings/SiblingToolScheduler.ts): Admitted sibling scheduler directing bounded concurrent execution.
  * [src/core/task/tools/siblings/SiblingToolDependency.ts](file:///Users/bozoegg/Downloads/codemarie-new/src/core/task/tools/siblings/SiblingToolDependency.ts): Classifies sibling operations, establishes prerequisite/conflict edges, and manages claims.

* **Cache & Coalescing Layer:**
  * [src/core/task/tools/io/IoRequestCoalescer.ts](file:///Users/bozoegg/Downloads/codemarie-new/src/core/task/tools/io/IoRequestCoalescer.ts): Uses collision-free identities to single-flight and coalesce duplicate in-flight requests.
  * [src/core/task/tools/io/TaskPathAuthorityCache.ts](file:///Users/bozoegg/Downloads/codemarie-new/src/core/task/tools/io/TaskPathAuthorityCache.ts): Singleflights and memoizes path authorities, workspace containment, and ignore policies.
  * [src/core/task/tools/io/TaskIoBackend.ts](file:///Users/bozoegg/Downloads/codemarie-new/src/core/task/tools/io/TaskIoBackend.ts): Orchestrates lookup, class admission, and execution.
  * [src/core/task/tools/io/ParentIoBulkhead.ts](file:///Users/bozoegg/Downloads/codemarie-new/src/core/task/tools/io/ParentIoBulkhead.ts): Enforces class-specific concurrency budgets (metadata/small reads: 4, searches: 2, traversals: 2).

* **I/O & Service Backends:**
  * [src/integrations/misc/extract-file-content.ts](file:///Users/bozoegg/Downloads/codemarie-new/src/integrations/misc/extract-file-content.ts): Optimized single-open, fast-UTF-8, 400KB-bounded file reading.
  * [src/services/glob/list-files.ts](file:///Users/bozoegg/Downloads/codemarie-new/src/services/glob/list-files.ts): Breadth-first workspace glob listing with early first-page streaming.
  * [src/services/ripgrep/index.ts](file:///Users/bozoegg/Downloads/codemarie-new/src/services/ripgrep/index.ts): Incremental parsing of JSON search outputs, bypassing the shell.
  * [src/services/tree-sitter/index.ts](file:///Users/bozoegg/Downloads/codemarie-new/src/services/tree-sitter/index.ts): Memoized treesitter parsers, grammars, and query compilations.

---

## 2. Benchmark Commands

The accelerated I/O paths can be benchmarked deterministically against a local temporary workspace:

```bash
npm run benchmark:meow-io
```

### Script Execution and Mechanics

The benchmark script ([scripts/meow-io-benchmark.ts](file:///Users/bozoegg/Downloads/codemarie-new/scripts/meow-io-benchmark.ts)):
1. Generates a deterministic 577-file temporary fixture under the OS temp directory.
2. Installs an in-memory I/O probe wrapping `node:fs/promises` and `child_process.spawn`.
3. Runs ten distinct test workloads in "Cold" (cleared task cache) and "Warm" (active task cache) conditions.
4. Monitors event-loop delay using `node:perf_hooks.monitorEventLoopDelay`.
5. Prints a tabular comparison of wall times, I/O calls (stats, realpaths, reads), and cache metrics.

---

## 3. Validation Commands

To verify compilation, formatting, and tests before release, execute:

```bash
# Verify TypeScript compilation
npm run check-types

# Verify code formatting and linting (Biome)
npm run lint

# Run unit tests
npm run test:unit

# Run focused tests (alternative fast unit-test loop)
npx cross-env TS_NODE_PROJECT=./tsconfig.unit-test.json mocha --no-config --require ts-node/register --require tsconfig-paths/register --require source-map-support/register --require ./src/test/requires.cjs --timeout 10000 <test-file-path>

# Verify roadmap state
npm run roadmap:audit

# Verify documentation links
npm run docs:check-agent-links

# Verify git diff check
git diff --check
```

---

## 4. Instrumentation Interpretation

The `TaskLatencyTracker` ([src/core/task/latency/TaskLatencyTracker.ts](file:///Users/bozoegg/Downloads/codemarie-new/src/core/task/latency/TaskLatencyTracker.ts)) collects detailed latency metrics:

* **Bounded Buffer:** Advisory events are capped at 1,024 in-memory entries per task.
* **Fail-Open Policy:** Latency tracking is advisory. If buffer capacity is exceeded or tracking fails, the subsystem fails open and execution continues uninterrupted.
* **Trace Stages:** Records timestamps for major phases (e.g., `scheduler_ready`, `parameters_validated`, `cache_lookup`, `backend_started`, `first_useful_result`, `projection_ready`).
* **Counters:** Tracks specific operations like stat calls, process spawns, bytes read, cache hits/misses, and event-loop delays.

---

## 5. Cancellation Ownership

Cancellation semantics under MEOW/ACC are governed by clear boundaries:

* **Task-Owned AbortSignal:** Direct single-tool I/O operations receive a task-owned `AbortSignal` and register themselves to be aborted when a cancel event occurs.
* **CommandExecutor Supremacy:** `CommandExecutor` remains the sole owner of shell timeouts and shell cancellation.
* **No Speculative Retries:** The outer action lane will no longer retry shell commands that timed out but remain active.
* **Resource Cleanup:** Timers, process handles, and open stream readers are cleared inside a `finally` block to prevent leaks.

---

## 6. Common Failure Modes & Troubleshooting

* **Authority Prewarming Delay:** If authority prewarming blocks on an external path, the initial task setup may experience a 1.2ms cold start delay. This is expected and governed by security policy.
* **Coalescing vs Mutating Fences:** In-flight query results coalesce only if no mutating command has rotated the cache generation. If a mutation starts, active queries in the previous generation will complete but cannot populate the new generation's cache.
* **Stream-separated XML tools:** Sibling batches split by stream chunks may fail to batch together if the scheduler does not receive them in the same parser window. They will instead execute as single-tool executions, falling back to sequential scheduling.

---

## 7. Troubleshooting and Diagnostics Guide

This troubleshooting guide aids in diagnosing and recovering from execution bottlenecks and cache coherence issues:

| Symptom | Root Cause | Diagnostics | Recovery Procedure |
| :--- | :--- | :--- | :--- |
| **High Sibling Queue Wait Times** | Bulkhead work-class capacity is fully saturated (e.g. 2 active Searches are already running). | Check `recordIoClassQueued` and `active` counts in `ParentIoBulkhead.ts` traces. | Adjust the work-class limits inside [ParentIoBulkhead.ts](file:///Users/bozoegg/Downloads/codemarie-new/src/core/task/tools/io/ParentIoBulkhead.ts). |
| **Stale Cache Hits on Reads** | A mutating command or custom tool executed without advancing the cache generation, causing subsequent read queries to return stale values. | Verify if the mutating operation was executed via the CLI/MCP lane without triggering cache invalidation. | Ensure mutating tool handlers call `invalidateCache` or that their definition is properly marked as mutating in the sibling classifier. |
| **Active Handle or Process Leak** | A cancelled search or glob listing failed to terminate the child Ripgrep process, leaving orphaned file descriptors. | Observe if `activeHandleDelta` increases after task cancellation. | Ensure the backend handles `AbortSignal` and calls `.kill()` on process close in [ripgrep/index.ts](file:///Users/bozoegg/Downloads/codemarie-new/src/services/ripgrep/index.ts). |
| **Sibling Batch Split** | Contiguous tool calls were split into sequential runs. | Check if tool calls were emitted in separate stream chunks or contain an interleaving mutation block. | Consolidate tool call emissions in the model prompt to ensure contiguity. |

---

## 8. Tuning Configuration Options

Subsystem thresholds can be tuned in code to balance concurrency against host machine load:

1. **Global Concurrency Budget:**  
   Configure `DEFAULT_SIBLING_TOOL_CONCURRENCY = 4` in [SiblingToolScheduler.ts](file:///Users/bozoegg/Downloads/codemarie-new/src/core/task/tools/siblings/SiblingToolScheduler.ts) to restrict the maximum number of simultaneous sibling tasks.
2. **Work-Class Bulkhead Capacities:**  
   Adjust class limits in [ParentIoBulkhead.ts](file:///Users/bozoegg/Downloads/codemarie-new/src/core/task/tools/io/ParentIoBulkhead.ts):
   - `metadata` and `small-read` lanes: `4` slots (high-velocity reads).
   - `search` lanes: `2` slots (CPU-intensive Ripgrep spawns).
   - `traversal` lanes: `2` slots (BFS glob listing).
3. **Latency Tracker Event Buffer:**  
   Adjust `maxEvents = 1024` in [TaskLatencyTracker.ts](file:///Users/bozoegg/Downloads/codemarie-new/src/core/task/latency/TaskLatencyTracker.ts) to control memory overhead during extremely large task flows.

---

## 9. Latency Trace Interpretation

The latency tracker writes a JSON structured event log upon task finalization:

### Sample JSON Structure
```json
{
  "readyToDispatchMs": 0.0048,
  "authorityResolutionMs": 1.3490,
  "readyToBackendStartMs": 2.4257,
  "readyToFirstUsefulResultMs": 2.7360,
  "backendDurationMs": 0.4531,
  "resultProcessingMs": 0.1735,
  "projectionMs": 0.0010
}
```

### Deriving Latency Metrics

* **Preflight Prep Delay:** Sum of `readyToDispatchMs` + `authorityResolutionMs`. Indicates path canonicalization and ignore rule parsing overhead.
* **Handoff Delay:** `readyToBackendStartMs` - `readyToDispatchMs`. Indicates scheduling and queue bulkhead admission delay.
* **First byte response speed:** `readyToFirstUsefulResultMs` - `readyToBackendStartMs`. Indicates raw search/read duration before first output chunk arrives.
* **Projection Overhead:** `projectionMs`. The time taken to reconstruct sequence-correct output from concurrent result envelopes.

