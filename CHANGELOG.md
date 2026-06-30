# Changelog

All notable changes to **LUMI** are documented here.

This project follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Added

- **Completion lifecycle decision engine** (`CompletionLifecycleDecisionEngine`) — a single deterministic authority that owns all completion/finalization eligibility decisions. Receives an immutable snapshot, returns one canonical decision with a binding action contract (`nextAllowedAction`, `forbiddenActions`, `canonicalInstruction`) and a full structured decision trace.
- **Completion action guard** (`CompletionActionGuard`) — enforcement layer at the tool boundary. Validates requested tools against the decision's action contract. Rejected actions never mutate counters, create audit state, or trigger retry loops. The agent receives a command, not prose to interpret.
- **Gate registry** (`gateRegistry.ts`) — active/retired gate tracking. Unknown or retired gates are non-participating (not blocking). Mirrors service registry patterns (Consul, etcd).
- **Circuit breaker half-open probe state** (Hystrix/Envoy pattern) — when the circuit breaker trips and engineering is NOT verified, the agent can make workspace changes to earn one probe attempt. Exactly one probe per checkpoint, tracked via `lastProbeCheckpointHash` on `TaskState`.
- **Workspace-unchanged detection** (`workspace_progress` preflight stage) — blocks retries when the workspace hasn't changed since the last gate block, even if the result text was reworded. Soft block — does not consume circuit-breaker budget.
- **Two-tier duplicate detection** — within cooldown: always suppress; after cooldown: suppress if workspace unchanged. Prevents the infinite retry loop that burned through the block budget.
- Documentation: [Completion lifecycle decision engine](docs/completion-lifecycle-decision-engine.md)
- Per-agent roadmap projection with coordinator-only workspace commits
- Governed swarm operator console fields (accepted/rejected patches, rebase, commit status)
- GitHub community templates (issues, PR, discussions, support)
- CI automation: OpenSSF Scorecard, actionlint, PR size labels, welcome bot, lock-threads
- Composite action `.github/actions/setup-node-monorepo` for cached monorepo installs
- Labels as code (`.github/labels.yml`), Dependabot auto-merge, merge-conflict labeling
- Security advisory issue template, maintainer [RELEASING.md](.github/RELEASING.md) runbook
- Husky `commit-msg` hook for Conventional Commits

### Fixed

- Publish platform-targeted VSIX packages and verify the bundled `better-sqlite3` binary OS/architecture, preventing Linux native modules from being installed on Windows.
- Use a native `protoc` compiler on Apple Silicon packaging hosts instead of requiring Rosetta.
- Keep completion audits authoritative but non-blocking when optional stream-context lookup or durable audit persistence is temporarily unavailable.
- **Audit cache validity** changed from OR logic to strict AND: cache key + graph revision + TTL + gate active must ALL match. A stale audit can no longer be reused when only one dimension holds, eliminating false-positive "passed" audit receipts.
- **Infinite retry loop** eliminated: duplicate submissions after cooldown are now blocked when the workspace hasn't changed, preventing the agent from burning through the block budget until the circuit breaker trips.
- **Circuit breaker deadlock** eliminated: when the circuit breaker trips and engineering is NOT verified, the agent can now make workspace changes to earn a half-open probe attempt, instead of being permanently stuck.
- **`gateLifecycleInvariants.ts`** now imports `MAX_COMPLETION_GATE_BLOCK_COUNT` directly from `gatePolicy.ts` instead of using a fragile local constant that could drift.

### Changed

- Repository renamed to [CardSorting/LUMI](https://github.com/CardSorting/LUMI)
- E2E workflow skips docs-only pull requests (path filter)
- Removed legacy JetBrains and nightly publish automation

## [2.7.0] - 2026-06-27

### Added

- Bundled default roadmap skill (`auto-rolling-roadmap`) — no per-workspace copy
- Skill discovery cache (15s TTL) with explicit invalidation on create/delete/toggle
- Progressive disclosure: execution digest on `use_skill`, full reference via `full_reference`
- Stable bundled skill toggle key (`bundled://auto-rolling-roadmap`)
- Skill pipeline acceptance tests and Open VSX path resolution tests
- Telemetry: `loadMode`, `fullSkillLoadReason`, `skillsDiscoveryCacheHit`

### Changed

- Roadmap skill excluded from SKILLS prompt when ROADMAP_STEERING is active
- Removed `workspace_skill_installed` completion gate (advisory only)
- Subagents respect skill toggles and exclude bundled roadmap from prompt catalog
- Doctor/validate/cockpit defaults to guide/continue-task — no mid-task ritual loops
- Skills UI refresh poll interval: 30s (invalidation on mutations)
- Bundled skill metadata reads 2KB frontmatter head only on discovery

## [2.1.6] - 2026-06-27

### Added

- Receipt authority refactor: coordinator-owned halt decisions, advisory receipts, governance diagnostics (ADR-015)
- Three-tier blocker policy (hard / soft / advisory) and explicit lane state machine
- Parent I/O bulkhead and `IoRequestCoalescer` for parallel safe reads with deduplication
- `CoordinatorExecutionAuthority`, `loadSealReceiptContext`, soft-block retry budgets
- Documentation: [governed execution authority](docs/governed-execution-authority.md)

### Changed

- Subagent parent gate signals are advisory warnings, not lane-blocking `criticalSignals`
- Non-blocking running status emission; parallel seal drain and audit preflight
- Advisory lane timeout degrades to `degraded_complete` instead of failing the swarm
- Lane mutation tools defer post-guard; batched governed receipt reads at seal

## [2.1.4] - 2026-06-27

### Added

- Parent-thread I/O execution authority (`executionAuthority.ts`) — hot/warm/cold tool path for reads and searches
- Documentation: [parent-thread execution authority](docs/parent-thread-execution-authority.md), ADR-014, gate failure catalog

### Changed

- Shift-right parent gates: I/O tools skip full UniversalGuard; deferred post-guard and advisory audits
- Subagent lane completion: sync quality preflight only; hardening audit deferred to seal barrier
- Completion gate cache-aside (5 min TTL), progressive critical-only threshold, soft cooldown/duplicate preflight

## [2.1.3] - 2026-06-26

### Changed

- Hardened `.vscodeignore` for Open VSX pre-publish scanners (exclude shell scripts, dev tooling, SQLite test binaries)
- `lumi-doctor` now verifies Open VSX packaging rules on every VSIX build

## [2.1.2] - 2026-06-26

### Changed

- Version republish after 2.1.1 was already published to marketplaces

## [2.1.1] - 2026-06-26

### Fixed

- actionlint CI workflow: run via official download script (`rhysd/actionlint` is not a GitHub Action)
- CodeQL analysis configuration for JS/TS monorepo

### Changed

- Dependency security updates across monorepo (npm audit fixes)

## [2.1.0] - 2026-06-23

Current extension release (`package.json`). See [changelogv3.md](changelogv3.md) for detailed substrate and provider history from prior product iterations.

### Highlights

- Calm VS Code companion UX (`CardSorting.lumi-vscode` / `CardSorting.lumi`)
- Plan/Act modes with approval-gated tools
- Governed subagent swarms with merge gate and durable receipts
- BroccoliDB-backed cognitive memory integration

---

Older detailed entries: [changelogv3.md](changelogv3.md)
