# Active Technical Changelog

This log preserves historical wiki entries and records current LUMI workspace knowledge-layer changes.

## [Transaction-Split Completion Saga and Committed Boundary Migration] — 2026-07-18

- Refactored the task completion flow to execute under a transaction-split completion saga, resolving nested execution permit leaks.
- Replaced monolithic `runCompletionFunnelAttempt` with a clean sibling dispatch model governed by `CompletionSagaCoordinator.ts`.
- Implemented `evidence_dispatching` saga state with atomic compare-and-swap (CAS) transitions to eliminate races between `consume()` and `reconcileForTask()`.
- Replaced raw SQL queries and synchronous getters with narrow asynchronous repository helpers (`loadTerminalExecutionEvent`).
- Added robust unit test suites asserting transactional boundaries, permit release ordering, and crash recovery.

## [Central Completion Funnel Migration] — 2026-07-18

- Replaced competing lifecycle/finalization authorities with one large `CompletionFunnel.ts` authority covering collection through durable CAS and terminal publication.
- Migrated task, subagent, shared-message, resume, and webview consumers to the immutable `CompletionFunnelEvent` contract.
- Deleted the legacy decision engine, lifecycle types/projections, isolated gate/action handlers, receipt validator, and lifecycle UI.
- Demoted `run_finalization` to optional post-completion documentation maintenance with no authority over completion.
- Added monotonic terminal-state, collision, fencing, message-resolution, resume, and UI regression coverage.

## [Subagent Execution and Scoped Cancellation Pass] — 2026-07-15

- Implemented owner-scoped command cancellation in `CommandExecutor` to independently manage and terminate concurrent subprocesses.
- Hardened subagent queue concurrency checking by tracking active execution slots (`running.size`) rather than yielded lifecycles, avoiding queue saturation in a single tick.
- Prefetched parent context asynchronously off the critical subagent startup path.
- Enforced sealed governed receipt validation and checksum integrity checks to prevent unsafe agent reuse during resumes.
- Implemented tool repetition detection and self-correction nudges in `SubagentRunner` to resolve loop blocks and signal toxic hotspots.
- Added atomic, write-behind log flushes to prevent transcript file corruption.

## [Execution Throughput Pass] — 2026-07-12

- Added workspace-local query authority while preserving `.dietcodeignore` and external-path approvals.
- Shifted environment discovery, intent persistence, roadmap admission, environment history, audit persistence, and roadmap completion journaling off critical execution paths where they are advisory.
- Consolidated duplicate roadmap completion readiness evaluation and batched audit evidence writes.
- Added mutation-aware I/O cache invalidation and a fail-open roadmap progress persistence circuit.
- Added `.wiki/agent/` operating memory with focused validation commands and reproduced pitfalls.

## [Sibling Concurrency and Latency Pass] — 2026-07-12

- Added task-local monotonic latency evidence across model, tool, I/O, completion, presentation, and asynchronous persistence boundaries.
- Replaced presenter-driven sibling serialization with a bounded task-owned dependency scheduler and deterministic result projection.
- Isolated tool-call parsing, UI events, and API result blocks per invocation so independent operations may finish out of order safely.
- Added path/generation-aware query coalescing and race tests preventing stale promotion after mutation.
- Added deterministic concurrency workloads plus cancellation, checkpoint, approval, partial-failure, cache, and native-stream regression tests.

## [Agent Continuity Refresh] — 2026-07-09

### Agent Playbook and Living Wiki operating layer

- Added root continuity docs: `AGENT_PLAYBOOK.md`, `WIKI.md`, `TROUBLESHOOTING.md`, `DECISIONS.md`, and `HANDOFF.md`.
- Refreshed `.wiki/index.md` and `.wiki/01-system-overview.md` to point future agents at current LUMI/BroccoliDB operating knowledge.
- Captured current known drift: stale `ROADMAP.md`, provider-count documentation drift, README badge version drift, and sandbox-specific roadmap progress write failures.
- Linked current Agent Playbook finalization work so future agents do not rediscover the same validation commands and failure modes.

## [Canonical MEOW Design Capture] — 2026-07-12

- Added the executive brief, execution philosophy, technical whitepaper, ADR series, and migration/evolution report under `.wiki/`.
- Linked the canonical suite from `.wiki/index.md` and the agent fast-orientation page.
- Captured measured scheduler workloads, latency-event semantics, intentional serialization boundaries, and residual technical debt without changing production architecture.
- Re-audited canonical claims against the implementation: documented the exact sibling-batch eligibility window, task-wide mutation serialization, query-only presentation capture, cooperative cancellation boundary, task-wide cache generation, and synchronous portions that remain in completion.

## [5.10.30] — 2026-04-25

### 🤖 Autonomous Forensic Phase Orchestration
Released version \`5.10.30\` featuring the **Autonomous Forensic Phase**. Task completion is now the trigger for automated architectural documentation.

- **Forensic Sub-Agent Orchestrator**:
  - **AttemptCompletionHandler**: Implemented \`runForensicSubagent()\`. If a task attempt is detected without a corresponding wiki update, the system now automatically spawns a **Forensic Architect** sub-agent.
  - **Contextual Documentation**: The sub-agent is provided with the implementation summary from the completion block to ensure high-fidelity documentation.
- **Sequential Stream Sequencing**:
  - Resolved the "Wiki Bypass" failure mode by ensuring the Forensic Phase is a mandatory, automated extension of the main task stream.
  - Verification is re-run post-subagent to ensure absolute compliance before final relinquishment of control.
- **Architectural Cleanup**:
  - Refined brace alignment and imports in \`AttemptCompletionHandler.ts\`.
  - Confirmed build and packaging integrity for \`5.10.30\`.

## [5.10.29] — 2026-04-25

### 🛡️ Sovereign Forensic Gate Implementation
This release implements the **Sovereign Forensic Gate**, a hard-gate mechanism that prevents task completion if the Knowledge Ledger has not been updated.

- **Forensic Gate Architecture**:
  - **FluidPolicyEngine**: Implemented \`checkForensicCompliance()\` to verify writes to \`.wiki/changelog.md\`.
  - **UniversalGuard**: Exposed forensic compliance as a first-class architectural check.
  - **AttemptCompletionHandler**: Integrated the gate directly into the \`attempt_completion\` tool execution flow.
- **Task Orchestration**:
  - **Sequential Stream Trigger**: Completion is now blocked with a descriptive error if the ledger is stale, forcing the agent into a dedicated **Forensic Phase**.
  - **ToolExecutor**: Updated \`TaskConfig\` to pass the \`UniversalGuard\` to all handlers.
- **Structural Integrity**:
  - **TaskConfig Keys**: Updated validation keys to include \`universalGuard\`.
  - **Version Release**: Bumped to \`5.10.29\`.

## [5.10.28] — 2026-04-25

### 🚀 Forensic Awareness Hardening & Release
Released version \`5.10.28\` featuring the **Forensic Awareness Hardening** pass. This release formally integrates agent awareness of the diagnostic substrate.

- **Forensic Awareness Hardening**:
  - **Prompt Architecture**: Created and registered the \`forensic_tools.ts\` component across all major model variants.
  - **Tool Documentation**: Formally defined Spider Engine commands (\`status\`, \`blast-radius\`, \`deps\`, etc.) within the system prompt.
  - **Persistence Guard**: Hardened \`.gitignore\` against SQLite and BroccoliDB persistence variants.
- **Version Release**:
  - **package.json**: Bumped version from \`5.10.27\` to \`5.10.28\`.
  - **Build Pipeline**: Executed \`npm run protos\`, \`npm run build:webview\`, and \`esbuild\` production build.
  - **Packaging**: Generated \`dietcode-5.10.28.vsix\`.
- **Forensic & Structural Audit**:
  - **Vibration Detection**: Identified a \`SQLITE_CONSTRAINT_FOREIGNKEY\` vibration during the forensic audit phase. Diagnostic accuracy is currently DEGRADED.
  - **Checkpoint Sync**: Verified physical state against git hash \`5c739441\`.
  - **Structural Coherence**: Confirmed zero orphan files in \`.wiki/\`.

**Forensic Tool Calls**:
- \`git rev-parse HEAD\` (Checkpoint Verification)
- \`npx tsx scripts/agent-spider.ts seed\` (Substrate Vibration Detection)
- \`write_to_file\` (Structural Coherence Audit)

## [5.10.27] — 2026-04-25

---
## [5.10.24] — 2026-04-22
*(Previous changes documented in high-level changelog)*
