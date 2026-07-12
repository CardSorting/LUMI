# MEOW-009: Latency Instrumentation

**Status:** Accepted  
**Implementation:** `src/core/task/latency/TaskLatencyTracker.ts`

## Context and problem

Serialization and presentation delay were suspected but not attributable to a concrete stage.

## Decision

Record bounded, monotonic, task-local lifecycle events from admission through asynchronous persistence. Expose snapshots for tests and development diagnostics. Instrumentation is fail-open and never a receipt or gate.

## Alternatives and tradeoffs

Full tracing infrastructure would add operational complexity. No instrumentation leaves optimization speculative. The lightweight tracker provides stage evidence with negligible critical-path work.

## Consequences and future considerations

Host/provider benchmarks can consume snapshots. New critical-path waits should add an event rather than a new blocking state.
