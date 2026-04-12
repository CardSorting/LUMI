# Changelog (V2)

## [3.88.4] - 2026-03-31

### Changed
- Production VSIX build and version bump.

## [3.88.3] - 2026-03-31

### Fixed
- **Cloudflare API Configuration**: Resolved an issue where the Cloudflare API token was immediately erased after entry by eliminating storage key conflicts and ensuring secret values correctly override regular settings.

## [3.88.2] - 2026-03-31

### Fixed
- **Sovereign Native Stack Hardening**: Resolved "Module not found" errors for `better-sqlite3` and its dependencies (`bindings`, `file-uri-to-path`) by externalizing them in the build process and expanding the packaging whitelist. This ensures consistent loading of native binaries in the production VSIX.

## [3.88.1] - 2026-03-31

### Fixed
- **Packaging & Bindings**: Resolved "Could not locate the bindings file" error for `better-sqlite3` by correctly marking it as an external dependency and including native binaries in the VSIX package.

## [3.88.0] - 2026-03-30

### Added
- **Suggestion Flow Hardening (Rounds 1-3)**: Completed deep audit and production hardening of the suggestion system. Implemented world-class performance optimizations, robust workspace indexing, and high-precision contextual grounding.
- **Cognitive Reliability**: Transitioned to the "Observe-Act-Adjust" model for high-reliability, forward-progress execution loops.

### Fixed
- **Gemini Suggestion Stability**: Resolved "Corrupted thought signature" (400 INVALID_ARGUMENT) error in Gemini 3 models and improved AI-powered suggestion relevance.
- **Biome Linting Compliance**: Achieved 100% compliance with project-wide Biome rules, enhancing type safety and overall code quality.

### Removed
- **Recursive Grounding & MAS**: Fully removed the legacy Grounding infrastructure and Multi-Agent Stream (MAS) orchestration layer to eliminate execution deadlocks and recursive validation loops.

## [3.85.0] - 2026-03-24

### Added
- **Architecture Stabilization Post-Mortem**: Formalized technical findings on Grounding and MAS failure modes in `GROUNDING_MAS_DEPRECATION.md`.
- **Observe-Act-Adjust Model**: Transitioned to a high-reliability, forward-progress execution loop.

### Changed
- **Total Documentation Overhaul**: Rewrote `README.md` with new high-fidelity architecture diagrams and simplified core pillars.
- **Type Safety Hardening**: Replaced over 50 instances of `any` with `unknown` or specific interfaces across core task logic and policies.
- **Biome Linting Compliance**: Achieved 100% compliance with strict project-wide Biome rules for all staged files.

### Removed
- **Legacy Grounding Infrastructure**: Deleted all recursive grounding logic, spec tracking, and associated subagent runners.
- **Multi-Agent System (MAS)**: Removed the orchestration layer, cog-bus, and swarm consensus protocols to resolve execution deadlocks.
- **Onboarding View**: Cleaned up leftover state and types from the deprecated onboarding experience.

## [3.84.1] - 2026-03-24

### Changed
- Production VSIX build and version bump.

## [3.84.0] - 2026-03-23

### Added
- **Round 4: Cognitive & Repository Scalability**:
  - **Bulk Ingestion Accelerator**: Implemented `addKnowledgeBatch` in `GraphService` for parallelized embedding and atomic updates.
  - **Recursive Merkle-Diff Engine**: Added a high-performance O(D * logN) tree comparison system in `Repository.ts`.
  - **Persistent Change-Sets**: Automated pre-calculation and storage of changed file lists in `nodes.changes` for O(1) history analysis.
  - **Batched Reasoning Chains**: Eliminated N+1 query patterns in `ReasoningService` (Contradiction Detection, Pedigree Tracing, Sovereignty Verification) using `getKnowledgeBatch`.
  - **Final Pass Hardening**:
    - **BufferedDbPool Grouping**: Implemented operational batching to group consecutive same-table inserts and upserts into single bulk SQL queries, drastically reducing transaction overhead.
    - **Spider Memory Management**: Implemented aggressive `ts-morph` AST purging to prevent memory leaks in large workspaces.
    - **Reachability Bypass**: Optimized `SpiderEngine` BFS to only recompute reachability when imports actually change.

### Optimized
- **Zero-Overhead Context Discovery**: Refactored `getContextGraph` and `blame` to use persistent change-set metadata, replacing O(N^2) tree scans.
- **MCP Performance**: Drastically improved `broccolidb_visualize_pedigree` tool execution via batch node hydration and Mermaid generation optimizations.
- **BroccoliDB Schema Evolution**: Migrated the `nodes` table to support versioned change-sets for long-term scalability and auditability.

## [3.83.0] - 2026-03-23

### Added
- **Deep Production Hardening (Phase 2)**:
  - **Tool Parameter Unification**: System-wide unification of file-related tool parameters to consistently use `path`.
  - **Global Normalization Layer**: Implemented a resilient parameter normalization layer in `ToolExecutorCoordinator` to handle `absolutePath` vs `path` inconsistencies automatically.
  - **Suggestion Engine Hardening**: Achieved 100% type safety in `SuggestionService` and introduced **Deep Workspace Discovery** using `README.md` and `package.json` for superior contextual grounding.
  - **Architectural Refinement**: Simplified tool handlers and strengthened type definitions across the core execution and suggestion modules.

## [3.82.8] - 2026-03-23

### Added
- **Oracle Deployment Ready**: Production-grade VSIX build including full Oracle Suggestion Mode enhancements and webview stability fixes.

## [3.82.7] - 2026-03-22

### Added
- **Oracle Mode Evolution**: Transformed suggestions into metadata-rich objects with "Type" (Fix/Design/Learn) and "Structural Impact" scores.
- **Oracle Visual System**: Introduced color-coded "Mode Dots" and structural "Impact Bars" in the UI for instant risk assessment.
- **Architectural Grounding**: The backend calculates risk using `BlastRadius` from SDS, grounded in real project dependency data.

### Fixed
- **Linter & Path Optimization**: Fixed `@shared` import paths in webview and strictly eliminated `any` types in test suites.
- **React Stability**: Resolved unique key warnings in the suggestion ribbon to improve render performance.
- **Polish & Refinement**: Applied global project-wide formatting and logic refinements across all suggesion engine components.

## [3.82.2] - 2026-03-22

### Added
- **Final Perfection Pass**: Replaced all simulated heuristics with production-grade logic for the Suggestion Engine.
- **Hardened Similarity Engine**: Implemented Levenshtein-based similarity filtering to ensure high-diversity user prompts.
- **Jittered Exponential Backoff**: Advanced retry logic for provider resilience.
- **Proactive Workspace Warming**: Background context indexing on file open to minimize latency.
- **Resource Memoization**: Service-level caching of Language Parsers.

## [3.82.1] - 2026-03-22

### Fixed
- **Thought Signature Collision**: Resolved `400 INVALID_ARGUMENT: Corrupted thought signature` in next-gen Gemini models by isolating conversation history from provider-side signature validation.

## [3.82.0] - 2026-03-22

### Added
- **Oracle Grade Suggestion Engine (Rounds 1-6 Hardening)**:
  - Developed a high-precision, architecturally-aware suggestion engine with **8-way Parallelized Context Gathering**.
  - Introduced **Smart Symbol Expansion** (Spider-Powered): Resolving workspace-wide definitions for symbols involved in active diagnostics.
  - Implemented **Project-Wide Consistency Injection**: Automatically extracting and enforcing architectural patterns and design idioms from the AgentContext.
  - Added **Semantic Importance Windowing**: Using BroccoliDB to ground suggestions in the most critical code blocks rather than just file headers.
  - Defined **Oracle Modes** (Fix, Design, Learn) for intent-based diversity in AI-prompted suggestions.
  - Integrated **Granular Telemetry** for monitoring component-level latency (Diagnostics, Broccoli, Tree-Sitter, Git).
  - Full model personalization: Honoring user-selected models across all API providers with modern high-performance fallbacks.

### Fixed
- **Suggestion Latency**: Optimized context pipelines to maintain <2s generation even with deep workspace grounding.
- **Redundant Suggestions**: Implemented a similarity filter and history buffer to prevent repetitive prompt cycles.
- **Dependency Guarding**: Infused system prompts with architectural guardrails to prevent circular dependencies in AI-generated plans.

## [3.81.0] - 2026-03-22
 
### Added
- **Spider Structural Intelligence Engine**:
  - Implemented high-performance structural analysis suite for detecting **Structural Entropy** and enforcing **Architectural Sovereignty**.
  - Introduced **Incremental $O(C)$ Audits** using CAS hashes for near-instantaneous architectural health checks on every commit.
  - Developed the **Four Pillar Model** for quantifying health: Cognitive Depth, Semantic Consistency, Ecological Integrity, and Modular Sovereignty.
  - Added **Blast Radius Intelligence** to predict multi-hop impact of proposed changes.
  - Full documentation suite including `SPIDER.md` (Technical Guide) and `SPIDER_THEORY.md` (Philosophical Foundations).
 
### Fixed
- **Architectural Decay**: Replaced expensive $O(N)$ full-repo scans with optimized incremental logic in `repository.ts`.
- **Type Safety**: Synchronized types and resolved multiple `any` diagnostics across the core reasoning substrate.
- **Biomed Synchronization**: Project-wide alignment with Biome linting rules for structural components.
 
## [3.78.0] - 2026-03-18
 
### Added
- **Production Hardening (MAS):**
  - Replaced placeholder `simulateMerge` logic with true Least Common Ancestor (LCA) semantic conflict resolution in KnowledgeGraph.
  - Replaced `simulateMergeForecast` mockups with dual-branch, multi-hop blast radius intersection engines.
  - Upgraded Grounding validation by replacing "simulated" prompts with real concurrent Sub-Agent Streams for 'Swarm Consensus' and 'Red-Team Critique'.
