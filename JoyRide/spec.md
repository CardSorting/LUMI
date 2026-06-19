Further improve LUMI’s runtime substrate under the name:

JoyRide

JoyRide is LUMI’s bounded high-throughput execution cache for agentic coding hot paths.

It is not a brain.
It is not memory.
It is not a cognition layer.
It is not a UI.
It is not anthropomorphic.
It is not a persistence system.

JoyRide is the execution substrate that makes LUMI feel fast, smooth, coherent, and ergonomic during intense agent/tool/code iteration without allowing memory explosions, stale context buildup, uncontrolled scratch growth, or hidden retained state.

JoyRide should feel like the useful part of the Antigravity-style “brain” concept stripped of mythology and rebuilt as serious runtime infrastructure.

Not a brain.

A cache.

Fast.
Bounded.
Inspectable.
Evictable.
Invalidation-aware.
Pressure-aware.
Secret-safe.
Production-hardened.

========================================
JOYRIDES’S CORE PURPOSE
=======================

JoyRide exists to improve agent ergonomics by making active execution feel smooth.

It should reduce the friction of repeated agentic coding loops:

* inspect file
* modify file
* run command
* inspect failure
* generate patch
* rerun test
* revalidate workspace
* update plan
* inspect diff
* repeat

The system should avoid forcing LUMI to constantly rediscover, regenerate, reload, or recompute hot execution context during active work.

JoyRide should support:

* rapid scratch execution
* hot task-local state
* temporary tool outputs
* short-lived generated files
* repeated command/test cycles
* transient AST or file metadata
* recent diffs
* verification artifacts
* active workspace indexes
* task-local planning residue
* recent grep/search results
* recent command outputs
* workspace drift fingerprints
* temporary patches
* generated scripts
* local investigation artifacts

The goal is hyper-throughput in-memory execution without memory explosions.

========================================
ABSOLUTE DISTINCTION
====================

JoyRide is cache, not memory.

Memory implies:

* identity
* continuity
* recall
* narrative
* persistence
* personal history

Cache implies:

* locality
* speed
* bounded lifetime
* invalidation
* eviction
* pressure handling
* correctness checks
* explicit cleanup

Use cache semantics everywhere.

Do not call anything:

* brain
* thoughts
* memories
* mind
* cognition
* recall
* subconscious
* reflection
* inner state

Use operational names only:

* JoyRide
* execution cache
* hot cache
* task cache
* scratch cache
* verification cache
* workspace index cache
* artifact cache
* cache entry
* execution artifact
* runtime artifact
* cache scope
* cache budget
* cache generation

========================================
AGENT ERGONOMICS GOAL
=====================

JoyRide should make LUMI feel easier to work with.

Not by adding UI.

Not by adding personality.

Not by adding “intelligence theater.”

But by making the execution loop smoother.

Improve:

* tool responsiveness
* task continuation speed
* repeated command latency
* file lookup speed
* verification reuse
* scratch iteration speed
* active context retrieval
* patch/test/debug rhythm
* local execution coherence
* developer confidence
* runtime debuggability

Without increasing:

* stale state risk
* hidden retention
* RAM pressure
* scratch directory growth
* operational ambiguity
* unsafe output reuse
* user confusion
* editor slowdown

JoyRide should make LUMI feel like it has better momentum, not like it has a mind.

========================================
PRIMARY REQUIREMENT
===================

Build a bounded, high-throughput, in-memory execution cache layer for active agent execution.

The runtime must absorb intense agent activity without:

* unbounded RAM growth
* runaway scratch files
* stale context reuse
* duplicated artifacts
* hidden retained outputs
* cache poisoning
* invalid task state
* memory leaks
* retained closures
* degraded editor performance
* blocked UI/event loop behavior
* fake cache layers
* simulated persistence
* unbounded maps
* unbounded arrays
* unbounded logs
* unbounded command output retention

JoyRide should improve speed without weakening correctness.

Fast stale state is worse than slow correct state.

========================================
HOT PATHS TO OPTIMIZE
=====================

Prioritize the highest-frequency paths in agentic coding.

Optimize these first:

1. command execution result lookup
2. test/build/lint revalidation
3. file metadata lookup
4. recent diff lookup
5. workspace drift checks
6. grep/search result reuse
7. temporary artifact access
8. active task state lookup
9. tool output reuse
10. verification artifact lookup
11. dependency fingerprint lookup
12. recently touched file lookup
13. changed file set lookup
14. generated script reuse
15. scratch patch cleanup

Hot path rules:

* low allocation
* low clone
* low serialization
* low lock contention
* low event-loop pressure
* bounded by default
* invalidation-aware
* cheap to inspect
* cheap to evict
* safe under repeated access

Avoid storing large raw blobs in hot memory unless explicitly admitted by policy.

Prefer:

* metadata over full content
* hashes over duplicated strings
* references over copies where safe
* bounded summaries over raw output
* compact structs over nested object graphs
* streaming writes over retained buffers
* stable cache keys over fuzzy lookup
* generation counters over expensive full scans
* explicit invalidation over implicit trust

========================================
JOYRIDE CACHE ARCHITECTURE
==========================

Create a layered cache architecture with explicit responsibilities.

---

1. Hot Execution Cache

---

Purpose:
Keep extremely short-lived execution artifacts available during active tool/code loops.

Stores:

* active tool outputs
* command result metadata
* small intermediate generated content
* temporary execution artifacts
* active patch candidates
* recent operation receipts
* short-lived command summaries
* recent failure summaries

Rules:

* shortest TTL
* strict size cap
* aggressive LRU eviction
* no large blobs by default
* invalidated on task boundary change
* invalidated on approval boundary change
* invalidated on workspace drift
* must drop entries under pressure instead of growing

---

2. Task-Local Cache

---

Purpose:
Hold artifacts scoped only to the current task.

Stores:

* plan fragments
* recent diffs
* file summaries
* verification outputs
* temporary scripts
* task-local investigation notes
* task-specific file fingerprints
* recent task decisions
* active patch metadata
* command attempt history

Rules:

* ownerTaskId required
* flushed on task completion
* flushed on task cancellation
* invalidated on task scope change
* bounded per task
* no cross-task reuse unless explicitly promoted by safe policy
* no unapproved mutation plans may be cached as reusable state

---

3. Workspace Index Cache

---

Purpose:
Accelerate repeated workspace lookup and revalidation.

Stores:

* file metadata
* changed file sets
* grep result metadata
* dependency hints
* import graph fragments
* recently touched symbols
* lightweight AST summaries
* package/dependency fingerprints
* git HEAD fingerprint
* lockfile fingerprint
* workspace generation counter

Rules:

* keyed by workspace fingerprint
* invalidated on file hash change
* invalidated on git HEAD change
* invalidated on dependency/lockfile change
* invalidated on workspace drift
* invalidated on relevant config change
* never silently reuses stale index entries
* avoids full-file content storage unless explicitly configured

---

4. Verification Cache

---

Purpose:
Reuse recent verification results only when they are provably still valid.

Stores:

* test output summaries
* build output summaries
* lint output summaries
* typecheck summaries
* command exit codes
* verification receipts
* relevant file hash sets
* dependency fingerprints
* environment fingerprints

Verification keys must include:

* command
* working directory
* relevant file hashes
* dependency fingerprint
* package lock fingerprint
* environment fingerprint
* git HEAD or workspace revision
* tool/runtime version where relevant
* approval boundary marker where relevant

Rules:

* no reuse without validation
* stale verification must be marked stale, not silently deleted
* verification cache reuse must be observable
* failed verification may be cached as diagnostic evidence, not proof of correctness
* approval boundaries must invalidate unsafe verification reuse
* command environment changes must invalidate cached results

---

5. Scratch Artifact Cache

---

Purpose:
Manage throwaway scripts, generated snippets, temporary patches, and investigation outputs.

Stores:

* temporary scripts
* generated snippets
* scratch patches
* investigation outputs
* throwaway transformed files
* local-only experiment artifacts
* short-lived generated fixtures

Rules:

* strict artifact count cap
* strict artifact size cap
* TTL required
* cleanup handler required
* no permanent persistence unless explicitly configured
* no unbounded scratch directories
* no hidden retained files
* every artifact must be deletable by cache cleanup
* scratch artifacts must never silently become project state

========================================
CACHE ENTRY MODEL
=================

Every JoyRide cache entry must include:

* key
* value
* cacheKind
* scope
* ownerTaskId
* createdAt
* lastAccessedAt
* ttl
* estimatedBytes
* fingerprint
* workspaceFingerprint
* approvalBoundaryId
* durability
* invalidationReason
* cleanupHandler
* admissionReason
* staleReason
* accessCount
* generation
* safetyClassification

Every cache entry must be able to answer:

* What owns me?
* Why am I valid?
* When do I expire?
* How large am I?
* What invalidates me?
* Can I be evicted?
* What cleanup is required?
* Am I safe to reuse?
* Am I allowed to persist?
* Which task created me?
* Which workspace generation created me?
* Which approval boundary am I tied to?

If an entry cannot answer these questions, it should not be admitted.

========================================
CACHE KEY DESIGN
================

Do not use weak keys.

No anonymous cache entries.
No unscoped string keys.
No “latest result” global buckets.
No object identity keys unless safe and intentional.
No cache entries without task/workspace ownership.

Keys must be stable, typed, scoped, and fingerprinted.

Examples:

Command result key:

* command
* cwd
* env fingerprint
* relevant file hashes
* dependency fingerprint
* git HEAD
* runtime/tool version

Grep result key:

* query
* include globs
* exclude globs
* workspace fingerprint
* changed file generation

File metadata key:

* absolute path
* file hash
* mtime generation
* workspace fingerprint

Verification key:

* command
* cwd
* dependency fingerprint
* relevant file hash set
* environment fingerprint
* approval boundary marker

Diff key:

* base hash
* target hash
* file path
* task ID

Scratch artifact key:

* task ID
* artifact kind
* content hash
* generation
* cleanup policy

========================================
ADMISSION CONTROL
=================

JoyRide must not cache everything.

Before insertion, every object must pass admission control.

Reject or summarize entries that are:

* too large
* unsafe
* secret-bearing
* unscoped
* unkeyed
* missing TTL
* missing owner
* missing invalidation rules
* low reuse probability
* expensive to clean up
* likely to become stale immediately
* attached to an invalid task
* attached to an obsolete workspace generation

Admission policy should prefer:

* small repeated values
* expensive-to-recompute metadata
* recent verification artifacts
* active task-local artifacts
* compact fingerprints
* bounded summaries
* reusable command metadata
* recently touched workspace metadata
* tool outputs likely to be reused within the current task

Admission policy should reject:

* huge terminal logs
* raw dependency folders
* full build outputs
* binary blobs
* secrets
* credentials
* API keys
* private tokens
* unapproved mutation plans
* sensitive terminal output unless explicitly allowed
* entire file trees
* large generated archives
* unresolved placeholder artifacts

========================================
EVICTION AND BOUNDS
===================

Add strict bounds.

Required policies:

* max total memory budget
* max per-cache memory budget
* max per-task memory budget
* max artifact count
* max artifact size
* max entry size
* TTL expiration
* LRU eviction
* generation-based invalidation
* task-completion eviction
* task-cancellation eviction
* workspace-change invalidation
* approval-boundary invalidation
* manual flush
* pressure-based trimming
* emergency drop mode

Under memory pressure, JoyRide must degrade gracefully.

If budget is exceeded:

1. reject new low-priority entries
2. evict expired entries
3. evict cold entries
4. evict largest low-value entries
5. compact optional summaries
6. spill safe artifacts to disk only if explicitly configured
7. preserve only minimal active task state
8. never crash the session
9. never freeze the editor
10. never silently retain unsafe artifacts

JoyRide should drop cache entries before it threatens the runtime.

The cache should protect the session, not consume it.

========================================
INVALIDATION RULES
==================

JoyRide must invalidate entries when:

* file hash changes
* git HEAD changes
* dependency files change
* package lock changes
* command environment changes
* task scope changes
* task owner changes
* approval boundary changes
* verification becomes stale
* workspace drift is detected
* runtime version changes
* tool version changes
* relevant config changes
* security policy changes
* workspace closes
* task completes
* task is cancelled

Do not reuse stale cache entries silently.

Every cached object must know why it is still valid.

If validity cannot be proven, treat the entry as stale.

Stale entries may remain temporarily for diagnostics, but they must not be used as active truth.

========================================
MEMORY PRESSURE HANDLING
========================

Implement real memory pressure behavior.

Required:

* conservative size estimation
* periodic budget checks
* trimToBudget()
* emergencyTrim()
* per-task pressure accounting
* total pressure accounting
* entry count accounting
* artifact count accounting
* cleanup on task completion
* cleanup on task cancellation
* cleanup on workspace close
* cleanup on extension shutdown

Avoid:

* retained closures
* hidden arrays
* duplicate buffers
* repeated JSON serialization
* long-lived references to tool output
* global maps without caps
* event listeners that retain task state
* scratch files without cleanup ownership
* stale promises retaining large values
* orphaned temp directories
* unbounded diagnostic buffers

Memory pressure must be observable and testable.

========================================
NO HIDDEN PERSISTENCE
=====================

Do not hide persistence behind vague naming.

Durability must be explicit.

Allowed durability modes:

* memoryOnly
* spillable
* persistedDiagnostic
* persistedReceipt

Default durability must be:

* memoryOnly

Spilling to disk must be opt-in and policy-controlled.

No cache should secretly become storage.

No scratch artifact should secretly become project state.

No verification result should secretly become durable proof unless explicitly recorded as a receipt.

JoyRide is allowed to be fast.

It is not allowed to become mysterious.

========================================
API DESIGN
==========

Expose a small internal JoyRide API.

Required operations:

* get(key)
* set(key, value, metadata)
* has(key)
* invalidate(scope | predicate)
* flush(scope)
* flushTask(taskId)
* flushWorkspace(workspaceId)
* estimateSize()
* trimToBudget()
* emergencyTrim(reason)
* getStats()
* markStale(key, reason)
* validate(entry, fingerprint)
* touch(key)
* dispose(entry)
* explain(key)

Cache metadata must be mandatory.

Do not allow:

* set(key, value) without metadata
* unscoped writes
* immortal entries
* entries without size estimates
* entries without owner
* entries without invalidation policy
* entries without cleanup behavior where cleanup is required

The explain(key) operation should answer:

* why this entry exists
* who owns it
* why it is valid
* when it expires
* what invalidates it
* whether it can be reused
* whether it can be evicted

This supports debugging without building UI.

========================================
SAFETY RULES
============

Never cache:

* secrets
* credentials
* API keys
* private tokens
* auth headers
* SSH keys
* npm tokens
* cloud credentials
* unapproved mutation plans
* sensitive terminal output unless explicitly allowed
* user-private content beyond the active task scope

Redact or reject unsafe values before admission.

Secret scanning should run before cache insertion for:

* strings
* command outputs
* generated files
* scratch artifacts
* tool outputs
* temporary scripts

Unsafe entries should be rejected with a clear diagnostic reason.

========================================
OBSERVABILITY
=============

Add developer-facing runtime observability.

Required metrics:

* hit rate
* miss rate
* eviction count
* stale invalidation count
* memory usage estimate
* per-cache memory estimate
* per-task memory estimate
* artifact count
* verification cache reuse count
* pressure trim events
* emergency trim events
* rejected admission count
* rejected unsafe entry count
* average entry age
* largest entries
* hottest keys
* stale reuse prevention count
* task cleanup count
* scratch cleanup count
* spill count, if spilling is enabled
* cache validation failure count

Do not build UI for this.

Use:

* logs
* diagnostics
* command output
* structured traces
* developer telemetry
* test assertions

JoyRide must be inspectable during development.

No invisible magic.

========================================
PRODUCTION HARDENING PASS
=========================

Deeply audit and revise the runtime implementation in its entirety.

Resolve all:

* placeholders
* TODOs
* mocks
* fake cache layers
* simulated persistence
* simulated cleanup
* unbounded maps
* unbounded arrays
* leaked references
* retained closures
* duplicate artifact storage
* stale command outputs
* unkeyed cache entries
* weak invalidation logic
* missing TTLs
* missing owners
* missing cleanup handlers
* missing memory pressure handling
* missing tests
* unclear cleanup behavior
* unsafe cache admission
* stale verification reuse
* hidden scratch accumulation
* editor-blocking cache operations
* fake diagnostics
* pretend observability
* “in a real app” comments
* non-functional stubs

Replace all placeholder behavior with real, working, production-ready implementation.

Every cache should be:

* real
* bounded
* measurable
* invalidation-aware
* safe
* tested
* explainable
* cleanup-owned
* pressure-aware

No simulated substrate.

No mythology.

No fake brain.

========================================
INDUSTRY-STANDARD DIRECTION
===========================

JoyRide should mirror serious runtime and build-system patterns, not chatbot metaphors.

Use the engineering spirit of:

* OS page caches
* browser memory caches
* LSP symbol/index caches
* incremental build caches
* test result caches
* compiler artifact caches
* bounded worker queues
* task-local execution stores
* content-addressed artifact stores
* pressure-aware runtime caches

The design should feel closer to:

* Bazel-style correctness through keys and fingerprints
* LSP-style fast workspace metadata
* browser-style cache eviction and pressure handling
* compiler-style artifact reuse
* runtime-style bounded hot-path optimization

Not like:

* long-term agent memory
* vague synthetic cognition
* hidden reflection systems
* anthropomorphic planning state
* unbounded scratchpads
* “the agent remembers”

JoyRide is infrastructure.

========================================
TESTING REQUIREMENTS
====================

Add tests for:

* cache insertion with required metadata
* rejection of unscoped entries
* rejection of oversized entries
* rejection of unsafe/secret-bearing entries
* TTL expiration
* LRU eviction
* per-task budget enforcement
* total budget enforcement
* per-cache budget enforcement
* task completion cleanup
* task cancellation cleanup
* workspace drift invalidation
* git HEAD invalidation
* file hash invalidation
* dependency lockfile invalidation
* approval boundary invalidation
* verification cache key correctness
* stale verification prevention
* scratch artifact cleanup
* memory pressure trimming
* emergency trimming
* duplicate artifact deduplication
* stats accuracy
* explain(key) accuracy
* no retained task references after flush
* no retained scratch artifacts after cleanup
* no stale verification reuse after file change
* no cache reuse across invalid approval boundary

Add stress tests for:

* many rapid tool calls
* repeated command/test loops
* large terminal outputs
* many scratch artifacts
* frequent file changes
* multiple tasks created and completed
* cache pressure during active execution
* rapid workspace drift
* repeated verification attempts
* extension shutdown cleanup

JoyRide should fail closed.

If unsure whether an entry is valid, do not reuse it.

========================================
BENCHMARK TARGETS
=================

Add lightweight benchmarks or diagnostics for hot paths.

Measure:

* repeated command lookup latency
* repeated verification lookup latency
* file metadata lookup latency
* grep/index reuse latency
* cache insertion overhead
* eviction overhead
* trimToBudget overhead
* emergencyTrim overhead
* task cleanup time
* scratch cleanup time
* memory estimate accuracy
* throughput under rapid tool execution
* editor responsiveness under cache pressure

Compare before and after where possible.

The goal is not theoretical architecture.

The goal is faster active execution without correctness loss or memory growth.

========================================
FINAL QUALITY BAR
=================

The completed implementation should make LUMI feel smoother, faster, and more ergonomic during intense agentic coding loops.

JoyRide should deliver:

* high-throughput execution
* in-memory hot-path acceleration
* bounded task-local state
* fast verification reuse
* safe scratch artifact handling
* explicit invalidation
* strict memory budgets
* pressure-aware trimming
* secret-safe admission
* developer-facing observability
* real cleanup behavior
* production-grade tests
* no placeholders
* no mocks
* no simulated cache behavior
* no hidden persistence
* no anthropomorphic naming

JoyRide is the runtime layer that lets LUMI move fast without becoming incoherent.

Not a brain.

Not memory.

Not mythology.

A cache substrate for agent throughput that does not explode.
