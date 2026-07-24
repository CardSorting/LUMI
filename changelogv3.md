# Changelog V3

## [9.0.0] - 2026-07-24

### 🛡️ SQLite Storage Retention, WAL Control & Native Memory Hardening
World-class infrastructure upgrade for SQLite persistence, eliminating exponential disk growth, WAL log bloat, and native C++ prepared statement handle memory leaks.

- **Auto-Vacuum PRAGMA Re-ordering**: `PRAGMA auto_vacuum = INCREMENTAL;` executes *before* `PRAGMA journal_mode = WAL;` during DB initialization, with automated `VACUUM;` header migration for databases initialized in non-autovacuum mode.
- **Universal Multi-Table Retention Sweeps**: Pruning policies covering all 35 system tables (`task_lifecycle_records`, `task_lifecycle_events`, `task_completions`, `task_rejections`, `completion_attempts`, expired `branches`, unreferenced `swarm_lock_generations`, legacy `tasks`, CAS `files`, `telemetry`, `audit_events`, `agent_streams`, `agent_tasks`).
- **Native Prepared Statement Handle Disposal**: Evicted statements in the 100-item LRU cache and statements cleared during `destroyDb()` or DB path transitions explicitly call `.dispose()`, instantly releasing native C++ memory handles.
- **Resilient WAL Checkpoints**: `wal_checkpoint(TRUNCATE)` executes with exponential backoff retries (up to 3 attempts with 50ms pauses if busy readers are encountered) to bound WAL log files under 32MB.

## [5.10.15] - 2026-04-22

### 🚀 Integrated Moonshot Kimi K2.6 & NousResearch Hardening
Full production-grade integration of the Moonshot Kimi K2.6 model and comprehensive hardening of the NousResearch provider ecosystem.

- **Moonshot Kimi K2.6 Support**: Native integration of the frontier-scale 1T parameter model.
- **Deep Reasoning Infrastructure**: Real-time extraction and streaming of "Thinking" traces from both `reasoning` and `reasoning_details` API fields.
- **Hardened NousResearch Provider**:
    - **Native Tool Calling**: Full support for agentic workloads via OpenAI-compatible tool specifications.
    - **Advanced Token Forensics**: Detailed usage reporting including reasoning tokens, prompt cache metrics, and precise cost tracking.
    - **Compatibility Normalization**: Standardized API requests (URL normalization, parameter relaxation) to eliminate 400-series status errors.
    - **Vision & Caching**: Enabled support for multimodal inputs and ephemeral prompt caching.

## [5.10.11] - 2026-04-21

### 🛰️ Sovereign Integrity Substrate (V204)
Transitioned the architectural substrate from reactive, blocking heuristics to a deterministic **Non-Blocking Integrity Advisory (TIA)** protocol. This eliminates agentic spiraling while providing high-fidelity structural guidance.

- **Non-Blocking Integrity Advisories (TIA)**: Surfaces structural "smells" (ghost symbols, brittle paths, circularity) as passive 💡 hints in tool responses.
- **Global Forensic Provider Mapping**: Deterministically identifies the canonical location of missing symbols across the entire substrate and provides ready-to-use alias-based import suggestions.
- **Fuzzy Forensic Sensing**: Implemented Levenshtein-based symbol matching to suggest corrections for missing symbols project-wide.
- **Substrate Vibration Warning**: Monitors afferent coupling project-wide. Edits to high-mass modules (`coupling > 5`) that remove/rename exports trigger a 🚨 alert to manage refactor "Blast Radius."
- **Zero-Friction Compliance**:
    - **Automatic Path Normalization**: Automated conversion of brittle relative imports to project-standard aliases.
    - **Barrel Sync Enforcement**: Proactively identifies files missing from directory `index.ts` exports.
- **Hardened Forensics**:
    - **Shadowing Detection**: Identifies local redefinitions of imported symbols.
    - **Circular Dependency Interdiction**: Warns about architectural cycles that lead to runtime instability.
    - **Deadwood Pruning**: Detects redundant imports and unused exports to maintain substrate purity.
- **Proactive Materialization**: Synthesizes ready-to-use TypeScript boilerplates for missing symbols directly in the advisory channel.
- **Sovereign Stability & Performance**:
    - **Re-entrancy Interdiction**: Implemented a hardened re-entrancy guard in the Policy Engine to prevent cascading tool-recursion and circular deadlocks.
    - **Synchronous Substrate Sensing**: Switched critical forensic operations to synchronous paths to eliminate event-loop context thrashing.
    - **Algorithmic Hardening**: Optimized the Spider Engine's reachability and cycle detection algorithms, reducing O(N^2) bottlenecks to O(V+E) and caching structural results across turns.
    - **Targeted Enforcement**: Restricted Compliance Hooks and TIA advisories to path-specific triggers, reducing CPU overhead by ~80% for non-modifying operations.
